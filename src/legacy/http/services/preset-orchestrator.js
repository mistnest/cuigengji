import {
    CANONICAL_IMPORT_ORDER,
    isCanonicalImportBeforePreset,
    sortCanonicalImportMessages,
} from './context-chains/canonical-writing-chain.js';
import { stripReasoningBlocks } from './writing-output-guard.js';

const VALID_TEMPLATE_ROLES = new Set(['system', 'developer', 'user', 'assistant']);

const IMPORT_META = {
    worldSetting: { name: 'world_setting_import', label: '这个世界的规则书' },
    characterState: { name: 'character_state_import', label: '崽崽们的近况' },
    plotHistory: { name: 'plot_history_import', label: '很久很久以前（的前情提要）' },
    recentPlot: { name: 'recent_plot_import', label: '刚才发生了什么' },
};

const LEGACY_CONTEXT_MARKERS = new Set([
    'worldInfoBefore',
    'worldInfoAfter',
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'dialogueExamples',
    'chatHistory',
    'cgj-import-worldSetting',
    'cgj-import-characterState',
    'cgj-import-plotHistory',
    'cgj-import-recentPlot',
]);

export function normalizePresetTemplates(templates = [], promptOrder = []) {
    const normalized = (templates || [])
        .filter(Boolean)
        .map((template, index) => {
            const identifier = String(template.identifier || template.name || `template_${index}`);
            const markerId = template.markerId || template.marker || (template.isMarker ? identifier : '');
            const isStructuralMarker = Boolean(template.isMarker || template.marker || markerId)
                || LEGACY_CONTEXT_MARKERS.has(identifier);
            return {
                ...template,
                identifier,
                name: template.name || identifier,
                role: normalizeTemplateRole(template.role),
                content: template.content || '',
                isSystemPrompt: Boolean(template.isSystemPrompt || template.system_prompt),
                isMarker: isStructuralMarker,
                markerId: markerId || (isStructuralMarker ? identifier : ''),
                _sourceIndex: index,
            };
        })
        // Marker records are import-format metadata, not writing policy.  They
        // are intentionally discarded even if an imported preset attaches
        // content to them; project data has one fixed injection envelope.
        .filter(template => !template.isMarker && template.content.trim());

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
    const importMessages = [];
    const importedSlots = [];
    const queueImport = (importKey) => {
        const message = buildImportMessage(importKey, imports[importKey]);
        if (!message) return;
        importMessages.push(message);
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
            });
        }
    }

    for (const importKey of CANONICAL_IMPORT_ORDER) {
        if (!imports[importKey]?.content) continue;
        queueImport(importKey);
    }

    const presetReferenceMessage = presetReferenceParts.length ? {
        role: 'user',
        content: section('预设参考', presetReferenceParts.join('\n\n')),
    } : null;

    const canonicalImports = sortCanonicalImportMessages(importMessages, IMPORT_META);
    messages.push(...canonicalImports.filter(message => isCanonicalImportBeforePreset(message, IMPORT_META)));
    if (presetReferenceMessage) messages.push(presetReferenceMessage);
    messages.push(...canonicalImports.filter(message => !isCanonicalImportBeforePreset(message, IMPORT_META)));

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
            injectionPolicy: 'cuigenji-canonical-v1',
            importedSlots,
            orderedTemplateIds: orderedTemplates.map(template => template.identifier),
            systemSections: systemParts.length,
            developerSections: developerParts.length,
            presetReferenceSections: presetReferenceParts.length,
        },
    };
}

export function buildFallbackWriteSystemPrompt() {
    const p = [];
    p.push('你是中文网文创作助手。');
    p.push('请根据作者当前要求和已导入的设定资料进行续写或草稿创作。');
    p.push('保持人物行为、剧情因果和叙事风格一致。');
    p.push('除非作者明确要求解释，否则只输出本轮需要的小说内容。');
    p.push('默认使用中文。');
    // 当前小说/章节名已移除——每次调用都变，破坏 prompt cache
    return p.join('\n');
}

function addTemplateContent({ template, systemParts, developerParts, presetReferenceParts }) {
    const content = normalizePresetPolicyText(template.content);
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

function buildImportMessage(importKey, payload) {
    const content = payload.content || '';
    if (!content.trim()) return null;
    const label = IMPORT_META[importKey]?.label || `${importKey} import`;
    const name = IMPORT_META[importKey]?.name || `${importKey}_import`;
    return {
        role: 'system',
        content: section(`📋 ${label}`, content),
        name,
    };
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

function normalizePresetPolicyText(content = '') {
    const simpleLabels = {
        user: '作者',
        char: '当前角色',
        model: '当前模型',
    };
    return String(content || '').replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/gu, (_match, key) => (
        simpleLabels[key]
        || (key === 'original' ? '' : `[${key} 由催更姬统一上下文提供]`)
    ));
}

function section(title, content) {
    if (!content) return '';
    return `## ${title}\n${content}`;
}
