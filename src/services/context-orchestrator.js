import { createMemoryManager, MEMORY_TYPE } from './memory-manager.js';
import { getAuthorProfile } from './author-profile.js';
import { NovelMemory } from './novel-memory.js';
import {
    buildFallbackWriteSystemPrompt,
    buildWritePromptFromPreset,
} from './preset-orchestrator.js';
import { getModelContext } from './context-manager.js';
import { loadProjectContext } from './project-data.js';
import { getCharacterSummary, getWorldBookEntrySummary } from './reference-summaries.js';
import { MEMORY_IMPORT_LABELS, buildPlatformWritePrompt, formatMemoryItem } from './memory-prompts.js';
import { getReferenceToolDefinitions } from './ai-tools/reference/index.js';
import { shouldEnableReferenceTools } from './reference-tool-policy.js';

const COMPACT_REFERENCE_MODES = new Set(['tool', 'tools', 'compact', 'reference_tools', 'novel_tools']);

const DEFAULT_LAYER_PCT = {
    platform: 0.06,
    author: 0.03,
    worldSetting: 0.14,
    characterState: 0.16,
    plotHistory: 0.16,
    recentPlot: 0.24,
};

export async function buildWritingContext({
    message = '',
    history = [],
    context = {},
    config = {},
    promptTemplates = [],
    promptOrder = [],
} = {}) {
    const modelContext = getModelContext(config.model);
    const totalInputBudget = Math.max(4096, modelContext.total - (config.maxTokens || modelContext.output || 4096) - 2048);
    const layerBudgets = buildLayerBudgets(totalInputBudget, config.memoryBudget);
    const compactReference = shouldUseCompactReference(config, context);
    const referenceTools = buildReferenceToolContext(config, context, compactReference);

    const reference = normalizeWritingReference(context.writingReference);
    const project = await loadProjectContext(context.novelId || 'default', context);
    const retrievalText = [
        context.currentText || '',
        message || '',
        context.chapterTitle || '',
    ].filter(Boolean).join('\n\n');
    const scopedWorldBook = applyWorldBookReference(project.worldBook, reference);
    const projectCharacters = project.characters.length ? project.characters : (context.characters || []);
    const scopedCharacters = applyCharacterReference(projectCharacters, reference, retrievalText);
    const fullContext = {
        ...context,
        worldBookEntries: flattenWorldBookEntries(scopedWorldBook, compactReference),
        characters: scopedCharacters,
        currentModel: config.model || '',
        plotMemory: project.plotMemory,
        projectSources: project.sources,
        compactReference,
    };

    const memory = createMemoryManager({
        worldBook: scopedWorldBook,
        characters: buildCharactersForMemory(fullContext.characters),
        outline: fullContext.outline || [],
        chapterSummaries: project.plotMemory.chapterSummaries,
        compactReference,
    }, {
        memoryBudgetPct: config.memoryBudget || 15,
        modelContextSize: modelContext.total,
    });
    const activeMemories = memory.retrieve(retrievalText, { maxScanDepth: 6000 });

    const authorContext = trimToTokenBudget(
        getAuthorProfile().formatForPrompt(true, layerBudgets.author),
        layerBudgets.author,
    );

    const novelMemoryText = buildNovelMemoryText(fullContext.novelId);
    const worldSetting = buildWorldSettingLayer(activeMemories, fullContext, layerBudgets.worldSetting);
    const characterState = buildCharacterStateLayer(activeMemories, fullContext, layerBudgets.characterState);
    const chapterScope = splitChapterSummaries(fullContext);
    const plotHistory = buildPlotHistoryLayer(activeMemories, novelMemoryText, fullContext, layerBudgets.plotHistory, chapterScope.distant);
    const recentPlot = buildRecentPlotLayer(fullContext, layerBudgets.recentPlot, chapterScope.recent);

    // Build ST-compatible granular imports for marker-based injection
    // Each marker gets only its specific portion of data, matching ST behavior
    const worldEntries = (scopedWorldBook?.entries ? Object.values(scopedWorldBook.entries) : [])
        .filter(e => !isWorldBookEntryDisabled(e));

    const charactersForMemory = buildCharactersForMemory(scopedCharacters || []);

    const imports = {
        // --- World book by position (ST: pure content, no prefix) ---
        worldInfoBefore: {
            label: MEMORY_IMPORT_LABELS.worldInfoBefore,
            content: worldEntries.filter(e => (e.position ?? 0) === 0)
                .map(e => worldBookEntryPromptText(e, compactReference))
                .filter(Boolean)
                .join('\n'),
        },
        worldInfoAfter: {
            label: MEMORY_IMPORT_LABELS.worldInfoAfter,
            content: worldEntries.filter(e => (e.position ?? 0) === 1)
                .map(e => worldBookEntryPromptText(e, compactReference))
                .filter(Boolean)
                .join('\n'),
        },

        // --- Characters split by field (ST: raw values, no name prefix) ---
        charDescription: {
            label: MEMORY_IMPORT_LABELS.charDescription,
            content: (scopedCharacters || [])
                .map(character => characterPromptDescription(character, compactReference))
                .filter(Boolean)
                .join('\n'),
        },
        charPersonality: {
            label: MEMORY_IMPORT_LABELS.charPersonality,
            content: charactersForMemory
                .filter(c => c.data?.personality)
                .map(c => c.data.personality)
                .join('\n'),
        },
        scenario: {
            label: MEMORY_IMPORT_LABELS.scenario,
            content: charactersForMemory
                .filter(c => c.data?.scenario)
                .map(c => c.data.scenario)
                .join('\n'),
        },
        dialogueExamples: {
            label: MEMORY_IMPORT_LABELS.dialogueExamples,
            content: compactReference ? '' : charactersForMemory
                .filter(c => c.data?.first_mes || c.data?.mes_example)
                .map(c => [c.data.first_mes, c.data.mes_example].filter(Boolean).join('\n'))
                .filter(Boolean)
                .join('\n\n'),
        },

        // --- Other layers (full content, used only if no marker covers them) ---
        worldSetting: {
            label: MEMORY_IMPORT_LABELS.worldSetting,
            content: worldSetting.content,
        },
        characterState: {
            label: MEMORY_IMPORT_LABELS.characterState,
            content: characterState.content,
        },
        plotHistory: {
            label: MEMORY_IMPORT_LABELS.plotHistory,
            content: plotHistory.content,
        },
        recentPlot: {
            label: MEMORY_IMPORT_LABELS.recentPlot,
            content: recentPlot.content,
        },
        authorPreference: {
            label: MEMORY_IMPORT_LABELS.authorPreference,
            content: authorContext,
        },
    };

    const platformPrompt = trimToTokenBudget(
        buildPlatformWritePrompt(context, { referenceToolsEnabled: referenceTools.enabled }),
        layerBudgets.platform,
    );
    const fallbackSystemPrompt = buildFallbackWriteSystemPrompt(context);
    const built = buildWritePromptFromPreset({
        context: fullContext,
        templates: promptTemplates,
        promptOrder,
        platformPrompt,
        authorContext,
        imports,
        fallbackSystemPrompt,
        history,
        currentMessage: message,
    });

    return {
        systemPrompt: built.systemPrompt,
        messages: built.messages,
        tools: referenceTools.definitions,
        referenceTools,
        debug: {
            modelContext: modelContext.total,
            inputBudget: totalInputBudget,
            layerBudgets,
            preset: built.debug,
            layers: {
                platform: layerDebug('platform', platformPrompt, layerBudgets.platform),
                author: layerDebug('author', authorContext, layerBudgets.author),
                worldSetting,
                characterState,
                plotHistory,
                recentPlot,
            },
            chapterScope,
            projectSources: project.sources,
            writingReference: reference,
            referencedCounts: {
                worldBookEntries: Object.keys(scopedWorldBook.entries || {}).length,
                characters: scopedCharacters.length,
            },
            activeMemoryStats: memory.getStats(activeMemories),
            compactReference,
            tools: {
                enabled: referenceTools.enabled,
                available: referenceTools.available,
                compactReference,
            },
        },
    };
}

export function shouldUseCompactReference(config = {}, context = {}) {
    if (config.compactReference === false || context.compactReference === false) return false;
    if (config.referenceTools === true || config.enableReferenceTools === true) return true;
    if (config.compactReference === true || context.compactReference === true) return true;
    const mode = String(
        config.referenceMode ||
        config.contextMode ||
        context.referenceMode ||
        context.contextMode ||
        context.writingReference?.mode ||
        ''
    ).toLowerCase();
    return COMPACT_REFERENCE_MODES.has(mode);
}

function buildReferenceToolContext(config = {}, context = {}, compactReference = false) {
    const enabled = shouldEnableReferenceTools(config, context, compactReference);
    const definitions = enabled ? getReferenceToolDefinitions() : [];
    return {
        enabled,
        definitions,
        available: definitions.map(tool => tool.function?.name).filter(Boolean),
        compactReference,
    };
}

function normalizeWritingReference(reference = {}) {
    reference = reference || {};
    return {
        worldbookMode: ['all', 'selected', 'off'].includes(reference.worldbookMode) ? reference.worldbookMode : 'all',
        selectedWorldbookGroups: Array.isArray(reference.selectedWorldbookGroups) ? reference.selectedWorldbookGroups : [],
        characterMode: ['auto', 'selected', 'off'].includes(reference.characterMode) ? reference.characterMode : 'auto',
        selectedCharacters: Array.isArray(reference.selectedCharacters) ? reference.selectedCharacters : [],
    };
}

function applyWorldBookReference(worldBook = {}, reference) {
    if (reference.worldbookMode === 'off') return { ...(worldBook || {}), entries: {} };
    const entries = Object.entries(worldBook.entries || {}).filter(([, entry]) => {
        if (isWorldBookEntryDisabled(entry)) return false;
        if (reference.worldbookMode !== 'selected') return true;
        return !!entry.group && reference.selectedWorldbookGroups.includes(entry.group);
    });
    return { ...(worldBook || {}), entries: Object.fromEntries(entries) };
}

function applyCharacterReference(characters = [], reference, scanText = '') {
    if (reference.characterMode === 'off') return [];
    return (characters || []).filter(character => {
        if (isCharacterDisabled(character)) return false;
        const data = character.data || character;
        const name = data.name || character.name || '';
        if (!name) return false;
        if (reference.characterMode === 'selected') return reference.selectedCharacters.includes(name);
        return scanText.includes(name);
    });
}

function isCharacterDisabled(character = {}) {
    const data = character.data || character;
    return character.disable === true
        || character.disabled === true
        || character.enabled === false
        || data.disable === true
        || data.disabled === true
        || data.enabled === false
        || data.extensions?.novel_ai_editor?.disabled === true;
}

function isWorldBookEntryDisabled(entry = {}) {
    return entry.disable === true
        || entry.disabled === true
        || entry.enabled === false
        || isAutomationWorldBookEntry(entry);
}

function isAutomationWorldBookEntry(entry = {}) {
    const comment = String(entry.comment || entry.name || '').toLowerCase();
    const content = String(entry.content || '').trim();
    return comment.includes('ejs')
        || content.startsWith('@@generate_before')
        || content.startsWith('@@generate_after')
        || content.startsWith('<%_')
        || content.startsWith('<%');
}

function buildLayerBudgets(totalInputBudget, userMemoryBudgetPct) {
    const scale = typeof userMemoryBudgetPct === 'number'
        ? Math.max(0.5, Math.min(2, userMemoryBudgetPct / 15))
        : 1;
    const budgets = {};
    for (const [key, pct] of Object.entries(DEFAULT_LAYER_PCT)) {
        const adjustedPct = ['worldSetting', 'characterState', 'plotHistory'].includes(key) ? pct * scale : pct;
        budgets[key] = Math.max(256, Math.round(totalInputBudget * adjustedPct));
    }
    return budgets;
}

function buildCharactersForMemory(characters = []) {
    return (characters || []).map(character => ({
        data: {
            name: character.name || character.data?.name || '',
            description: character.description || character.data?.description || '',
            personality: character.personality || character.data?.personality || '',
            scenario: character.scenario || character.data?.scenario || '',
            mes_example: character.mes_example || character.data?.mes_example || '',
            first_mes: character.first_mes || character.data?.first_mes || '',
        },
    }));
}

function buildNovelMemoryText(novelId) {
    if (!novelId) return '';
    try {
        return new NovelMemory(novelId).formatForPrompt();
    } catch {
        return '';
    }
}

function buildWorldSettingLayer(memories, ctx, budget) {
    const selected = memories.filter(memory => memory.type === MEMORY_TYPE.WORLD_ENTRY);
    let content = formatMemoryItems(selected);
    if (!content && ctx.worldBookEntries?.length) {
        content = (ctx.worldBookEntries || [])
            .slice(0, 12)
            .map(entry => `- ${entry.name || '未命名设定'}: ${entry.summary || entry.content || ''}`)
            .join('\n');
    }
    content = trimToTokenBudget(content, budget);
    return layerDebug('worldSetting', content, budget, selected);
}

function buildCharacterStateLayer(memories, ctx, budget) {
    const selected = memories.filter(memory => memory.type === MEMORY_TYPE.CHARACTER);
    const inferred = inferCharacterState(ctx.characters || [], ctx.currentText || '', ctx.compactReference);
    const selectedText = formatMemoryItems(selected);
    const activeText = ctx.compactReference && selectedText
        ? formatActiveCharacters(ctx.characters || [], ctx.currentText || '')
        : inferred;
    let content = [selectedText, activeText].filter(Boolean).join('\n');
    if (!content && ctx.characters?.length) content = inferred;
    content = trimToTokenBudget(content, budget);
    return layerDebug('characterState', content, budget, selected);
}

function buildPlotHistoryLayer(memories, novelMemoryText, ctx, budget, distantChapterSummaries = []) {
    const distantTitles = new Set(distantChapterSummaries
        .map(summary => summary.title || summary.chapterTitle || summary.name || '')
        .filter(Boolean));
    const selected = memories.filter(memory =>
        memory.type === MEMORY_TYPE.OUTLINE ||
        (memory.type === MEMORY_TYPE.CHAPTER_SUMMARY && distantTitles.has(memory.label)) ||
        memory.type === MEMORY_TYPE.EXTRACTED_NOTE,
    );
    const parts = [];
    if (novelMemoryText) parts.push(novelMemoryText);
    const selectedText = formatMemoryItems(selected);
    if (selectedText) parts.push(selectedText);
    if (distantChapterSummaries.length) {
        parts.push('远期章节摘要（只用于承接长期因果，不要逐字复述）：\n' + distantChapterSummaries
            .map(formatChapterSummaryLine)
            .filter(Boolean)
            .join('\n'));
    }
    if (!selectedText && ctx.outline?.length) {
        parts.push((ctx.outline || [])
            .filter(node => !node.completed)
            .slice(0, 10)
            .map(node => `- ${node.title}${node.description ? `: ${node.description}` : ''}`)
            .join('\n'));
    }
    if (ctx.plotMemory?.keyEvents?.length) {
        parts.push('Key events:\n' + ctx.plotMemory.keyEvents.slice(-20)
            .map(event => `- ${event.title}: ${event.content}`)
            .join('\n'));
    }
    if (ctx.plotMemory?.openOutline?.length) {
        parts.push('Open outline:\n' + ctx.plotMemory.openOutline.slice(0, 12)
            .map(node => `- ${node.title}${node.content ? `: ${node.content}` : ''}`)
            .join('\n'));
    }
    const content = trimToTokenBudget(parts.filter(Boolean).join('\n\n'), budget);
    return layerDebug('plotHistory', content, budget, selected);
}

function buildRecentPlotLayer(ctx, budget, recentChapterSummaries = []) {
    const parts = [];
    if (ctx.novelTitle) parts.push(`当前小说：${ctx.novelTitle}`);
    if (ctx.chapterTitle) parts.push(`当前章节：${ctx.chapterTitle}`);
    if (recentChapterSummaries.length) {
        parts.push('近期章节摘要（优先保持连续性）：\n' + recentChapterSummaries
            .map(formatChapterSummaryLine)
            .filter(Boolean)
            .join('\n'));
    }
    if (ctx.currentText) parts.push(`当前正文结尾：\n${ctx.currentText}`);
    const content = trimToTokenBudget(parts.join('\n'), budget);
    return layerDebug('recentPlot', content, budget);
}

function splitChapterSummaries(ctx = {}) {
    const summaries = Array.isArray(ctx.plotMemory?.chapterSummaries)
        ? ctx.plotMemory.chapterSummaries.filter(Boolean)
        : [];
    if (!summaries.length) return { recent: [], distant: [] };

    const currentTitle = normalizeTitle(ctx.chapterTitle || '');
    let currentIndex = summaries.findIndex(summary => normalizeTitle(summary.title || summary.chapterTitle || summary.name || '') === currentTitle);
    if (currentIndex < 0) currentIndex = summaries.length - 1;

    const start = Math.max(0, currentIndex - 2);
    const end = Math.min(summaries.length, currentIndex + 1);
    const recent = summaries.slice(start, end);
    const recentSet = new Set(recent);
    const distant = summaries.filter(summary => !recentSet.has(summary));
    return { recent, distant };
}

function formatChapterSummaryLine(summary = {}) {
    const title = summary.title || summary.chapterTitle || summary.name || `章节 ${summary.index ?? ''}`.trim();
    const text = summary.summary || summary.content || summary.text || summary.digest || '';
    const keyEvents = Array.isArray(summary.keyEvents) ? summary.keyEvents.filter(Boolean).slice(-5).join('；') : '';
    const detail = [text, keyEvents ? `关键事件：${keyEvents}` : ''].filter(Boolean).join('；');
    return detail ? `- ${title}: ${detail}` : '';
}

function formatMemoryItems(items = []) {
    return items
        .filter(item => item.content || item.label)
        .map(item => formatMemoryItem(item))
        .join('\n');
}

function flattenWorldBookEntries(worldBook = {}, compactReference = false) {
    return Object.values(worldBook.entries || {})
        .filter(entry => !isWorldBookEntryDisabled(entry))
        .map(entry => ({
            name: entry.comment || entry.key?.[0] || `Entry ${entry.uid ?? ''}`,
            content: worldBookEntryPromptText(entry, compactReference),
            summary: compactReference ? getWorldBookEntrySummary(entry) : '',
            key: entry.key || [],
            constant: Boolean(entry.constant),
        }));
}

function inferCharacterState(characters, currentText, compactReference = false) {
    const scanText = currentText || '';
    return (characters || [])
        .map(character => {
            const data = character.data || character;
            const name = data.name || character.name || '';
            if (!name) return '';
            const appears = scanText.includes(name);
            const description = characterPromptDescription(character, compactReference);
            const fields = [
                description ? `${compactReference ? 'summary' : 'description'}: ${description}` : '',
                data.personality ? `personality: ${data.personality}` : '',
                data.scenario ? `scenario: ${data.scenario}` : '',
                !compactReference && data.first_mes ? `first message: ${data.first_mes}` : '',
            ].filter(Boolean);
            const state = [];
            if (appears) state.push('currently active in recent text');
            const dynamic = data.extensions?.novel_editor_state || data.novel_editor_state || {};
            for (const [key, value] of Object.entries(dynamic)) {
                if (value) state.push(`${key}: ${String(value)}`);
            }
            if (!fields.length && !state.length) return '';
            return `- ${name}${state.length ? ` (${state.join('; ')})` : ''}: ${fields.join(' / ')}`;
        })
        .filter(Boolean)
        .slice(0, 16)
        .join('\n');
}

function formatActiveCharacters(characters = [], currentText = '') {
    const names = (characters || [])
        .map(character => {
            const data = character.data || character;
            return data.name || character.name || '';
        })
        .filter(name => name && currentText.includes(name));
    return names.length ? `当前出场：${[...new Set(names)].join('、')}` : '';
}

function worldBookEntryPromptText(entry = {}, compactReference = false) {
    if (!compactReference) return entry.content || '';
    const name = entry.comment || entry.name || entry.key?.[0] || `世界书条目 ${entry.uid ?? ''}`.trim();
    const summary = getWorldBookEntrySummary(entry) || trimPlainText(entry.content || '', 220);
    return summary ? `[worldbook:${entry.uid ?? safeReferenceName(name)}] ${name}: ${summary}` : '';
}

function characterPromptDescription(character = {}, compactReference = false) {
    if (compactReference) return compactCharacterReference(character);
    return character.data?.description || character.description || '';
}

function compactCharacterReference(character = {}) {
    const data = character.data || character;
    const name = data.name || character.name || '未命名角色';
    const summary = normalizeCompactSummary(getCharacterSummary(character), name);
    const fallback = [
        data.description || character.description || '',
        data.personality ? `性格：${data.personality}` : '',
        data.scenario ? `场景：${data.scenario}` : '',
    ].filter(Boolean).join('；');
    const content = summary || trimPlainText(fallback, 260);
    return content ? `[character:${safeReferenceName(name)}] ${name}: ${content}` : '';
}

function normalizeCompactSummary(summary = '', name = '') {
    const text = String(summary || '').trim();
    if (!text) return '';
    const bareName = String(name || '').trim();
    if (text === bareName || text === `Name: ${bareName}` || text === `姓名：${bareName}`) return '';
    return text
        .replace(new RegExp(`^Name:\\s*${escapeRegExp(bareName)}\\s*Description:\\s*`, 'i'), '')
        .replace(new RegExp(`^姓名：\\s*${escapeRegExp(bareName)}\\s*描述：\\s*`, 'i'), '')
        .trim();
}

function trimPlainText(text = '', maxChars = 240) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, maxChars)}...`;
}

function normalizeTitle(value = '') {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function safeReferenceName(value = '') {
    return String(value || 'ref').replace(/[\s:：\[\]]+/g, '_').slice(0, 48) || 'ref';
}

function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimToTokenBudget(text, budget) {
    if (!text) return '';
    const tokens = estimateTextTokens(text);
    if (tokens <= budget) return text;
    const keepChars = Math.max(500, Math.floor(text.length * (budget / tokens) * 0.9));
    return `[Earlier content trimmed]\n${text.slice(-keepChars)}`;
}

function layerDebug(name, content, budget, memories = []) {
    return {
        name,
        content,
        budget,
        tokens: estimateTextTokens(content),
        chars: (content || '').length,
        included: Boolean(content?.trim()),
        memoryCount: memories.length,
        selected: memories.slice(0, 20).map(memory => ({
            id: memory.id,
            type: memory.type,
            label: memory.label,
            weight: memory.weight,
            tokens: memory.estimatedTokens,
            source: memory.source,
        })),
    };
}

function estimateTextTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 3.5);
}
