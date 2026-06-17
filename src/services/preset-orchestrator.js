const VALID_TEMPLATE_ROLES = new Set(['system', 'developer', 'user', 'assistant']);

const MARKER_TO_IMPORT = {
    worldInfoBefore: 'worldInfoBefore',
    worldInfoAfter: 'worldInfoAfter',
    charDescription: 'charDescription',
    charPersonality: 'charPersonality',
    scenario: 'scenario',
    personaDescription: 'authorPreference',
    dialogueExamples: 'dialogueExamples',
    chatHistory: 'recentPlot',
};

const IMPORT_META = {
    worldInfoBefore: { name: 'world_info_before_import', label: 'World info before char' },
    worldInfoAfter: { name: 'world_info_after_import', label: 'World info after char' },
    charDescription: { name: 'char_description_import', label: 'Character descriptions' },
    charPersonality: { name: 'char_personality_import', label: 'Character personalities' },
    scenario: { name: 'scenario_import', label: 'Character scenarios' },
    dialogueExamples: { name: 'dialogue_examples_import', label: 'Dialogue examples' },
    worldSetting: { name: 'world_setting_import', label: 'World setting import' },
    characterState: { name: 'character_state_import', label: 'Character state import' },
    plotHistory: { name: 'plot_history_import', label: 'Plot history import' },
    recentPlot: { name: 'recent_plot_import', label: 'Recent plot import' },
    authorPreference: { name: 'author_preference_import', label: 'Author preference import' },
};

export function normalizePresetTemplates(templates = [], promptOrder = []) {
    const normalized = (templates || [])
        .filter(Boolean)
        .map((template, index) => {
            const identifier = String(template.identifier || template.name || `template_${index}`);
            return {
                ...template,
                identifier,
                name: template.name || identifier,
                role: normalizeTemplateRole(template.role),
                content: template.content || '',
                isSystemPrompt: Boolean(template.isSystemPrompt || template.system_prompt),
                isMarker: Boolean(template.isMarker || template.marker),
                markerId: template.markerId || template.marker || (template.isMarker ? identifier : ''),
                _sourceIndex: index,
            };
        })
        .filter(template => template.content.trim() || template.isMarker);

    const order = extractPromptOrder(promptOrder);
    if (!order.length) return normalized;

    const byIdentifier = new Map(normalized.map(template => [template.identifier, template]));
    const ordered = [];

    for (const item of order) {
        const template = byIdentifier.get(item.identifier);
        if (!template) continue;
        if (item.enabled === false) continue;
        ordered.push(template);
        byIdentifier.delete(item.identifier);
    }

    const rest = [...byIdentifier.values()].sort((a, b) => a._sourceIndex - b._sourceIndex);
    return [...ordered, ...rest];
}

export function buildWritePromptFromPreset({
    context = {},
    templates = [],
    promptOrder = [],
    platformPrompt = '',
    authorContext = '',
    imports = {},
    fallbackSystemPrompt = '',
    history = [],
    currentMessage = '',
} = {}) {
    const orderedTemplates = normalizePresetTemplates(templates, promptOrder);
    const systemParts = [];
    const developerParts = [];
    const presetReferenceParts = [];
    const messages = [];

    // Build macro context for ST template compatibility
    const macroCtx = {
        firstCharName: (context.characters || [])[0]?.data?.name || (context.characters || [])[0]?.name || '',
        charDescriptions: (context.characters || []).map(c => c.data?.description || c.description || '').filter(Boolean),
        charPersonalities: (context.characters || []).map(c => c.data?.personality || c.personality || '').filter(Boolean),
        charScenarios: (context.characters || []).map(c => c.data?.scenario || c.scenario || '').filter(Boolean),
        dialogueExamples: (context.characters || []).flatMap(c => [c.data?.first_mes, c.data?.mes_example].filter(Boolean)),
        authorPersona: authorContext || '',
        modelName: context.currentModel || '',
        charSystemPrompts: (context.characters || []).map(c => c.data?.system_prompt || '').filter(Boolean),
        charPostHistory: (context.characters || []).map(c => c.data?.post_history_instructions || '').filter(Boolean),
        charFirstMessages: (context.characters || []).map(c => c.data?.first_mes || '').filter(Boolean),
        charVersions: (context.characters || []).map(c => c.data?.char_version || c.data?.spec_version || '').filter(Boolean),
        charCreatorNotes: (context.characters || []).map(c => c.data?.creator_notes || '').filter(Boolean),
        mesExamplesRaw: (context.characters || []).map(c => c.data?.mes_example || '').filter(Boolean),
        _firstCall: true,
    };
    const importedSlots = [];

    if (platformPrompt) systemParts.push(section('Platform rules', platformPrompt));
    if (authorContext) developerParts.push(section('Author preference', authorContext));

    if (!orderedTemplates.length && fallbackSystemPrompt) {
        systemParts.push(fallbackSystemPrompt);
    }

    for (const template of orderedTemplates) {
        if (template.content.trim()) {
            addTemplateContent({
                template,
                systemParts,
                developerParts,
                presetReferenceParts,
                macroCtx,
            });
        }

        if (template.isMarker) {
            const importKey = MARKER_TO_IMPORT[template.markerId || template.identifier];
            // Only inject each import once, even if multiple markers point to it
            if (importKey && imports[importKey]?.content && !importedSlots.includes(importKey)) {
                pushImport(messages, importKey, imports[importKey]);
                importedSlots.push(importKey);
            }
        }
    }

    if (presetReferenceParts.length) {
        messages.push({
            role: 'user',
            content: section('Preset reference', presetReferenceParts.join('\n\n')),
        });
    }

    // Fallback: inject full layers only if no granular marker already covered them
    for (const importKey of ['worldSetting', 'characterState', 'plotHistory', 'recentPlot']) {
        if (importedSlots.includes(importKey)) continue;
        // If granular markers already injected parts of this layer, skip the full version
        const coveredBy = {
            worldSetting: ['worldInfoBefore', 'worldInfoAfter'],
            characterState: ['charDescription', 'charPersonality', 'dialogueExamples'],
        };
        if ((coveredBy[importKey] || []).some(k => importedSlots.includes(k))) continue;
        if (!imports[importKey]?.content) continue;
        pushImport(messages, importKey, imports[importKey]);
        importedSlots.push(importKey);
    }

    messages.push(...buildConversationMessages(history, currentMessage, context));

    const systemPrompt = [
        ...systemParts,
        developerParts.length ? section('Developer guidance', developerParts.join('\n\n')) : '',
    ].filter(Boolean).join('\n\n');

    return {
        systemPrompt,
        messages,
        debug: {
            templateCount: orderedTemplates.length,
            importedSlots,
            orderedTemplateIds: orderedTemplates.map(template => template.identifier),
            systemSections: systemParts.length,
            developerSections: developerParts.length,
            presetReferenceSections: presetReferenceParts.length,
        },
    };
}

export function buildFallbackWriteSystemPrompt(ctx = {}) {
    const p = [];
    p.push('You are a collaborative Chinese web-novel writing assistant.');
    p.push('Continue or draft prose according to the author request and imported setting material.');
    p.push('Keep character behavior, plot causality, and narrative style consistent.');
    p.push('Output only the requested novel prose unless the author explicitly asks otherwise.');
    p.push('Write in Chinese.');
    if (ctx.novelTitle) p.push(`Novel: ${ctx.novelTitle}`);
    if (ctx.chapterTitle) p.push(`Current chapter: ${ctx.chapterTitle}`);
    return p.join('\n');
}

function addTemplateContent({ template, systemParts, developerParts, presetReferenceParts, macroCtx }) {
    const content = replaceStMacros(template.content, macroCtx);
    if (!content.trim()) return;

    if (template.role === 'system' || template.isSystemPrompt) {
        systemParts.push(section(template.name, content));
        return;
    }

    if (template.role === 'developer') {
        developerParts.push(section(template.name, content));
        return;
    }

    if (template.role === 'assistant') {
        presetReferenceParts.push(section(`${template.name} (assistant example)`, content));
        return;
    }

    presetReferenceParts.push(section(template.name, content));
}

function pushImport(messages, importKey, payload) {
    const content = payload.content || '';
    if (!content.trim()) return;
    const meta = IMPORT_META[importKey] || { name: `${safeName(importKey)}_import`, label: `${importKey} import` };
    messages.push({
        role: 'system',
        content: content,
        name: meta.name,
    });
}

function buildConversationMessages(history = [], currentMsg = '') {
    const messages = [];
    const sourceHistory = [...(history || [])];
    const last = sourceHistory[sourceHistory.length - 1];
    if (last?.role === 'user' && String(last.content || '').trim() === String(currentMsg || '').trim()) {
        sourceHistory.pop();
    }

    for (const msg of sourceHistory.slice(-20)) {
        if (!['user', 'assistant'].includes(msg.role)) continue;
        messages.push({ role: msg.role, content: msg.content || '' });
    }

    const content = currentMsg || '';
    messages.push({
        role: 'user',
        content: section('Current author request', content),
    });

    return messages;
}

function normalizeTemplateRole(role) {
    const normalized = String(role || 'system').toLowerCase();
    return VALID_TEMPLATE_ROLES.has(normalized) ? normalized : 'system';
}

function extractPromptOrder(promptOrder) {
    if (!Array.isArray(promptOrder)) return [];

    const result = [];
    const visit = (item) => {
        if (!item) return;
        if (typeof item === 'string') {
            result.push({ identifier: item, enabled: true });
            return;
        }
        if (Array.isArray(item)) {
            item.forEach(visit);
            return;
        }
        if (Array.isArray(item.order)) {
            item.order.forEach(visit);
            return;
        }
        const identifier = item.identifier || item.id || item.name;
        if (identifier) {
            result.push({
                identifier: String(identifier),
                enabled: item.enabled !== false,
            });
        }
    };

    promptOrder.forEach(visit);
    return result;
}

function replaceStMacros(content, ctx = {}) {
    const firstChar = ctx.firstCharName || 'AI作家';
    const charDescs = (ctx.charDescriptions || []).join('\n');
    const charPersonalities = (ctx.charPersonalities || []).join('\n');
    const charScenarios = (ctx.charScenarios || []).join('\n');
    const dialogueExamples = (ctx.dialogueExamples || []).join('\n\n');
    const authorPersona = ctx.authorPersona || '';
    const modelName = ctx.modelName || '';

    let result = String(content || '')
        .replace(/\{\{char\}\}/gi, firstChar)
        .replace(/\{\{user\}\}/gi, '作者')
        .replace(/\{\{description\}\}/gi, charDescs)
        .replace(/\{\{personality\}\}/gi, charPersonalities)
        .replace(/\{\{scenario\}\}/gi, charScenarios)
        .replace(/\{\{mesExamples\}\}/gi, dialogueExamples)
        .replace(/\{\{persona\}\}/gi, authorPersona)
        .replace(/\{\{model\}\}/gi, modelName)
        .replace(/\{\{original\}\}/gi, ctx._firstCall ? content : '')
        .replace(/\{\{charPrompt\}\}/gi, (ctx.charSystemPrompts || []).join('\n'))
        .replace(/\{\{charInstruction\}\}/gi, (ctx.charPostHistory || []).join('\n'))
        .replace(/\{\{charFirstMessage\}\}/gi, (ctx.charFirstMessages || []).join('\n'))
        .replace(/\{\{greeting\}\}/gi, (ctx.charFirstMessages || []).join('\n'))
        .replace(/\{\{charVersion\}\}/gi, (ctx.charVersions || []).join('\n'))
        .replace(/\{\{charCreatorNotes\}\}/gi, (ctx.charCreatorNotes || []).join('\n'))
        .replace(/\{\{creatorNotes\}\}/gi, (ctx.charCreatorNotes || []).join('\n'))
        .replace(/\{\{mesExamplesRaw\}\}/gi, (ctx.mesExamplesRaw || []).join('\n'));

    // Mark that {{original}} has been consumed for this template
    if (ctx._firstCall && content.includes('{{original}}')) {
        ctx._firstCall = false;
    }

    return result;
}

function section(title, content) {
    if (!content) return '';
    return `## ${title}\n${content}`;
}

function safeName(value) {
    return String(value || 'setting_import')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'setting_import';
}
