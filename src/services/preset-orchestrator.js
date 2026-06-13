const VALID_TEMPLATE_ROLES = new Set(['system', 'developer', 'user', 'assistant']);

const MARKER_TO_IMPORT = {
    worldInfoBefore: 'worldSetting',
    worldInfoAfter: 'worldSetting',
    charDescription: 'characterState',
    charPersonality: 'characterState',
    scenario: 'plotHistory',
    personaDescription: 'authorPreference',
    dialogueExamples: 'characterState',
    chatHistory: 'recentPlot',
};

const IMPORT_META = {
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
                markerId: template.markerId || (template.isMarker || template.marker ? identifier : ''),
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
            });
        }

        if (template.isMarker) {
            const importKey = MARKER_TO_IMPORT[template.markerId || template.identifier];
            if (importKey && imports[importKey]?.content) {
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

    for (const importKey of ['worldSetting', 'characterState', 'plotHistory', 'recentPlot']) {
        if (importedSlots.includes(importKey)) continue;
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

function addTemplateContent({ template, systemParts, developerParts, presetReferenceParts }) {
    const content = replaceStMacros(template.content);
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
    const meta = IMPORT_META[importKey] || {
        name: `${safeName(importKey)}_import`,
        label: `${importKey} import`,
    };
    const name = payload.name || meta.name;
    const label = payload.label || meta.label;
    const content = payload.content || '';
    if (!content.trim()) return;

    const toolCallId = `call_${safeName(name).slice(0, 48)}`;
    messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
            id: toolCallId,
            type: 'function',
            function: { name, arguments: JSON.stringify({ label }) },
        }],
    });
    messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        name,
        content: section(label, content),
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

function replaceStMacros(content) {
    return String(content || '')
        .replace(/\{\{char\}\}/g, 'AI author')
        .replace(/\{\{user\}\}/g, 'author');
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
