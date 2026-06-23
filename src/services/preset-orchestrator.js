import {
    NATIVE_IMPORT_MARKERS,
    getNativeImportKey,
    isNativeImportBeforePreset,
    isNativeMarkerIdentifier,
    isNativeReferenceMode,
    sortNativeImportMessages,
} from './context-chains/native-writing-chain.js';
import {
    ST_IMPORT_MARKERS,
    getStImportKey,
    isStMarkerIdentifier,
    isStSpecialMarker,
} from './context-chains/st-compatible-chain.js';
import { stripReasoningBlocks } from './writing-output-guard.js';

const VALID_TEMPLATE_ROLES = new Set(['system', 'developer', 'user', 'assistant']);

const IMPORT_META = {
    worldInfoBefore: { name: 'world_info_before_import', label: '世界观小抄（前置版）' },
    worldInfoAfter: { name: 'world_info_after_import', label: '世界观小抄（后置版）' },
    charDescription: { name: 'char_description_import', label: '崽崽们的档案' },
    charPersonality: { name: 'char_personality_import', label: '崽崽们的脾气' },
    scenario: { name: 'scenario_import', label: '崽崽们现在在哪儿' },
    dialogueExamples: { name: 'dialogue_examples_import', label: '崽崽们怎么说话' },
    worldSetting: { name: 'world_setting_import', label: '这个世界的规则书' },
    characterState: { name: 'character_state_import', label: '崽崽们的近况' },
    plotHistory: { name: 'plot_history_import', label: '很久很久以前（的前情提要）' },
    recentPlot: { name: 'recent_plot_import', label: '刚才发生了什么' },
    authorPreference: { name: 'author_preference_import', label: '作者大人的小癖好' },
};

const VOLATILE_IMPORTS = new Set(['recentPlot']);
// plotHistory（远期章节摘要）只在写新章后变化，同章内多次调用稳定 → 放入 stable 区利用缓存

export function normalizePresetTemplates(templates = [], promptOrder = []) {
    const normalized = (templates || [])
        .filter(Boolean)
        .map((template, index) => {
            const identifier = String(template.identifier || template.name || `template_${index}`);
            const markerId = template.markerId || template.marker || (template.isMarker ? identifier : '');
            const isNativeImportMarker = isNativeMarkerIdentifier(identifier);
            const isStImportMarker = isStMarkerIdentifier(identifier);
            return {
                ...template,
                identifier,
                name: template.name || identifier,
                role: normalizeTemplateRole(template.role),
                content: template.content || '',
                isSystemPrompt: Boolean(template.isSystemPrompt || template.system_prompt),
                isMarker: Boolean(template.isMarker || template.marker || isNativeImportMarker || isStImportMarker),
                markerId: markerId || (isNativeImportMarker || isStImportMarker ? identifier : ''),
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
        byIdentifier.delete(item.identifier);
        if (item.enabled === false) continue;
        ordered.push(template);
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
    const stableImportMessages = [];
    const volatileImportMessages = [];
    const compactReference = Boolean(context.compactReference);
    const nativeReference = isNativeReferenceMode(context);

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
    const importConfig = context.importConfig || null;
    const queueImport = (importKey) => {
        const message = buildImportMessage(importKey, imports[importKey], importConfig);
        if (!message) return;
        const target = VOLATILE_IMPORTS.has(importKey) ? volatileImportMessages : stableImportMessages;
        target.push(message);
        importedSlots.push(importKey);
    };

    if (platformPrompt) systemParts.push(section('平台规则', platformPrompt));
    if (authorContext) developerParts.push(section('作者偏好', authorContext));

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
            const markerId = template.markerId || template.identifier;
            if (!nativeReference && isStSpecialMarker(markerId)) continue;
            const importKey = nativeReference ? getNativeImportKey(markerId) : getStImportKey(markerId);
            if (nativeReference && ST_IMPORT_MARKERS.has(importKey)) continue;
            if (!nativeReference && NATIVE_IMPORT_MARKERS.has(importKey)) continue;
            // Only inject each import once, even if multiple markers point to it
            if (importKey && imports[importKey]?.content && !importedSlots.includes(importKey)) {
                queueImport(importKey);
            }
        }
    }

    // Native fallback: official layers are injected even if the preset omitted native markers.
    // ST compatibility deliberately does not fallback to native layers.
    for (const importKey of nativeReference ? ['worldSetting', 'characterState', 'plotHistory', 'recentPlot'] : []) {
        if (importedSlots.includes(importKey)) continue;
        // If granular ST markers already injected parts of this layer, skip the full version.
        // Native/reference-tool mode keeps the official 催更姬 layers separate from ST slots.
        const coveredBy = nativeReference ? {} : compactReference
            ? {
                worldSetting: ['worldInfoBefore', 'worldInfoAfter'],
                characterState: ['charDescription', 'charPersonality'],
            }
            : {
                worldSetting: ['worldInfoBefore', 'worldInfoAfter'],
                characterState: ['charDescription', 'charPersonality', 'dialogueExamples'],
            };
        if ((coveredBy[importKey] || []).some(k => importedSlots.includes(k) && hasUsefulImportContent(imports[k]?.content))) continue;
        if (!imports[importKey]?.content) continue;
        queueImport(importKey);
    }

    const presetReferenceMessage = presetReferenceParts.length ? {
        role: 'user',
        content: section('预设参考', presetReferenceParts.join('\n\n')),
    } : null;

    if (nativeReference) {
        const nativeImportMessages = sortNativeImportMessages([...stableImportMessages, ...volatileImportMessages], IMPORT_META);
        messages.push(...nativeImportMessages.filter(message => isNativeImportBeforePreset(message, IMPORT_META)));
        if (presetReferenceMessage) messages.push(presetReferenceMessage);
        messages.push(...nativeImportMessages.filter(message => !isNativeImportBeforePreset(message, IMPORT_META)));
    } else {
        messages.push(...stableImportMessages);
        if (presetReferenceMessage) messages.push(presetReferenceMessage);
        messages.push(...volatileImportMessages);
    }

    messages.push(...buildConversationMessages(history, currentMessage, context));

    const systemPrompt = [
        ...systemParts,
        developerParts.length ? section('开发者指引', developerParts.join('\n\n')) : '',
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
    p.push('你是中文网文创作助手。');
    p.push('请根据作者当前要求和已导入的设定资料进行续写或草稿创作。');
    p.push('保持人物行为、剧情因果和叙事风格一致。');
    p.push('除非作者明确要求解释，否则只输出本轮需要的小说内容。');
    p.push('默认使用中文。');
    // 当前小说/章节名已移除——每次调用都变，破坏 prompt cache
    return p.join('\n');
}

function addTemplateContent({ template, systemParts, developerParts, presetReferenceParts, macroCtx }) {
    const content = replaceStMacros(template.content, macroCtx);
    if (!content.trim()) return;

    // ST compatibility: only system_prompt templates go to system prompt (no headers)
    if (template.isSystemPrompt) {
        systemParts.push(content);
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

    // Regular system/user templates go to preset reference (user-role messages)
    presetReferenceParts.push(section(template.name, content));
}

function buildImportMessage(importKey, payload, importConfig = null) {
    const content = payload.content || '';
    if (!content.trim()) return null;
    // 预设可自定义标签名和注入提示词，未配置则用默认
    const cfg = importConfig || {};
    const label = (cfg.labels && cfg.labels[importKey]) || IMPORT_META[importKey]?.label || `${importKey} import`;
    const name = IMPORT_META[importKey]?.name || `${safeName(importKey)}_import`;
    const header = pickImportHeader(importKey, cfg);
    const body = [header, content].filter(Boolean).join('\n');
    return {
        role: 'system',
        content: section(`📋 ${label}`, body),
        name,
    };
}

function pickImportHeader(importKey, cfg = {}) {
    // 预设明确指定了该 key 的 header → 直接用（包括空字符串，表示不需要额外 header）
    if (cfg.headers && importKey in cfg.headers) return cfg.headers[importKey];
    if (cfg.header !== undefined) return cfg.header;
    return '';
}

function buildConversationMessages(history = [], currentMsg = '', context = {}) {
    const messages = [];
    const sourceHistory = sanitizeConversationHistory(history || []);
    const last = sourceHistory[sourceHistory.length - 1];
    if (last?.role === 'user' && String(last.content || '').trim() === String(currentMsg || '').trim()) {
        sourceHistory.pop();
    }

    // Assign round numbers to legacy messages (those created before round tracking was added)
    assignLegacyRoundNumbers(sourceHistory);

    // Determine current round number: prefer explicit context, else derive from history
    const currentRound = context.roundNumber
        || Math.max(0, ...sourceHistory.filter(m => m.role === 'user').map(m => m.roundNumber || 0)) + 1;

    for (const msg of sourceHistory) {
        if (!['user', 'assistant'].includes(msg.role)) continue;
        if (msg.role === 'user' && msg.roundNumber) {
            // Use the same header format as the current round so that when this
            // message is replayed as history, the prefix stays byte-identical
            // and the provider cache continues unbroken into the next turn.
            messages.push({
                role: 'user',
                content: section(`第 ${msg.roundNumber} 轮 · 作者要求`, msg.content || ''),
            });
        } else {
            messages.push({ role: msg.role, content: msg.content || '' });
        }
    }

    // Current turn: provide only the live editor text. Historical snapshots stay
    // in local chat records for debug/replay, but are not injected into the model.
    const parts = [];
    if (context.currentSceneText) {
        messages.push({
            role: 'user',
            content: section(`第 ${currentRound} 轮 · 正文快照`, formatCurrentTextSnapshot(context.currentSceneText, context.chapterTitle)),
        });
    }
    parts.push(section(`第 ${currentRound} 轮 · 作者要求`, currentMsg || ''));
    messages.push({
        role: 'user',
        content: parts.join('\n\n'),
    });

    return messages;
}

function sanitizeConversationHistory(history = []) {
    const cleaned = [];
    for (const msg of history || []) {
        if (!['user', 'assistant'].includes(msg?.role)) continue;
        // Defensive: strip headers that may have leaked into stored content
        let content = String(msg.content || '').trim();
        content = content.replace(/^## 当前作者要求\n+/g, '');
        content = content.replace(/^## 第 \d+ 轮(?: · 作者要求)?\n+/g, '');
        if (msg.role === 'assistant') {
            content = stripReasoningBlocks(content);
        }
        if (!content) continue;
        if (msg.role === 'assistant' && isAssistantErrorContent(content)) continue;

        const last = cleaned[cleaned.length - 1];
        if (last?.role === msg.role && String(last.content || '').trim() === content) continue;
        if (
            last?.role === 'user' &&
            msg.role === 'user' &&
            String(last.content || '').trim() === content
        ) continue;

        cleaned.push({
            role: msg.role,
            content,
            currentTextSnapshot: msg.role === 'user' ? (msg.currentTextSnapshot || msg.currentSceneText || msg.currentText || '') : '',
            chapterTitle: msg.chapterTitle || '',
            roundNumber: msg.roundNumber || 0,
        });
    }
    return cleaned;
}

/**
 * Assign sequential round numbers to legacy messages that were created before
 * roundNumber tracking was added. Messages that already have a roundNumber > 0
 * are left unchanged; the counter skips past them.
 */
function assignLegacyRoundNumbers(messages = []) {
    let nextRound = 1;
    for (const msg of messages) {
        if (msg.role !== 'user') continue;
        if (msg.roundNumber > 0) {
            nextRound = msg.roundNumber + 1;
        } else {
            msg.roundNumber = nextRound++;
        }
    }
}

function formatCurrentTextSnapshot(text = '', chapterTitle = '') {
    const title = String(chapterTitle || '').trim();
    const body = String(text || '').trim();
    return [title ? `章节：${title}` : '', body].filter(Boolean).join('\n\n');
}

function isAssistantErrorContent(content = '') {
    const text = String(content || '');
    return text.startsWith('❌')
        || text.includes('API key required')
        || text.includes('请先配置 API Key')
        || text.includes('Stream error')
        || text.includes('HTTP 4')
        || text.includes('HTTP 5');
}

function hasUsefulImportContent(content = '') {
    const text = String(content || '').trim();
    if (!text) return false;
    const compact = text.replace(/\s+/g, ' ');
    if (/^(?:Name|姓名)[:：]\s*[^：:\s]+$/i.test(compact)) return false;
    if (/^\[character:[^\]]+\]\s*[^：:]+[:：]\s*$/.test(compact)) return false;
    return compact.length >= 24;
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
