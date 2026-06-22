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
import { ASSIST_TOOLS } from './chat-tools.js';

// ── Native + ST track modules (renamed to avoid shadowing local functions) ──
import { buildWorldSettingLayer as _nativeWorldLayer } from './native/world-layer.js';
import { buildCharacterStateLayer as _nativeCharLayer } from './native/character-layer.js';
import { classifyWorldEntries as _classifyWb, classifyCharacters as _classifyCh } from './native/world-layer.js';
import { buildStWorldInfo as _stWorldInfo, buildStCharField as _stCharField } from './st/formatters.js';

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
        cleanSceneText(context.currentText || ''),
        message || '',
        context.chapterTitle || '',
    ].filter(Boolean).join('\n\n');
    const scopedWorldBook = applyWorldBookReference(project.worldBook, reference);
    const projectCharacters = project.characters.length ? project.characters : (context.characters || []);
    const scopedCharacters = applyCharacterReference(projectCharacters, reference, retrievalText);
    const currentSceneText = cleanSceneText(context.currentText || '');
    // Classify entries by user intent (wanted / excluded / disabled)
    const _wbAll = Object.values((project.worldBook || {}).entries || {});
    const _wbClass = _classifyWb(_wbAll, reference);
    const _chClass = _classifyCh(projectCharacters, reference);

    const fullContext = {
        ...context,
        worldBookEntries: flattenWorldBookEntries(scopedWorldBook, compactReference),
        excludedWorldBookEntries: _wbClass.excluded.map(e => ({
            name: e.comment || e.key?.[0] || '',
            summary: compactReference ? (e.content || '').substring(0, 120) : '',
            content: compactReference ? '' : (e.content || '').substring(0, 200),
        })).filter(e => e.name),
        disabledWorldBookEntries: collectDisabledWorldBookBriefs(project.worldBook, compactReference),
        characters: scopedCharacters,
        excludedCharacters: _chClass.excluded,
        disabledCharacters: collectDisabledCharacterNames(projectCharacters, reference),
        currentModel: config.model || '',
        plotMemory: project.plotMemory,
        projectSources: project.sources,
        compactReference,
        referenceMode: config.referenceMode || context.referenceMode || '',
        referenceTools: config.referenceTools ?? context.referenceTools,
        enableReferenceTools: config.enableReferenceTools ?? context.enableReferenceTools,
        nativeReference: compactReference || ['tool', 'tools', 'compact', 'reference_tools', 'novel_tools', 'native'].includes(String(config.referenceMode || context.referenceMode || '').toLowerCase()),
        currentSceneText,
    };

    const memory = createMemoryManager({
        worldBook: scopedWorldBook,
        characters: buildCharactersForMemory(fullContext.characters),
        outline: fullContext.outline || [],
        // Chapter summaries are split into recent/distant below, so avoid
        // MemoryManager's generic "last 3" injection from polluting early chapters.
        chapterSummaries: [],
        compactReference,
    }, {
        memoryBudgetPct: config.memoryBudget || 15,
        modelContextSize: modelContext.total,
    });
    const activeMemories = memory.retrieve(retrievalText, { maxScanDepth: 6000 });

    // 作者档案暂时屏蔽——自动识别功能未完成，保留接口。
    // TODO: 等作者文风自动识别上线后恢复注入。
    const authorContext = ''; // trimToTokenBudget(getAuthorProfile().formatForPrompt(true, layerBudgets.author), layerBudgets.author);

    const novelMemoryText = buildNovelMemoryText(fullContext.novelId);
    const worldSetting = _nativeWorldLayer(fullContext, layerBudgets.worldSetting);
    const characterState = _nativeCharLayer(fullContext, layerBudgets.characterState);
    const chapterScope = splitChapterSummariesByAnchor(fullContext);
    const plotHistory = buildPlotHistoryLayer(activeMemories, novelMemoryText, fullContext, layerBudgets.plotHistory, chapterScope.distant);
    // 近期章节用全文（窗口锚定后稳定可缓存），当前正文移到 user 消息
    const recentFullChapters = resolveRecentChapters(project.chapters, chapterScope.recent, chapterScope.current);
    const recentPlot = buildRecentPlotLayer(fullContext, layerBudgets.recentPlot, recentFullChapters);

    const charactersForMemory = buildCharactersForMemory(scopedCharacters || []);

    // ── ST-compatible imports ──
    // Follow real SillyTavern: keyword-match world entries, split by position,
    // inject raw content (no compactReference truncation, no prefix).
    const stWorldInfo = _stWorldInfo(scopedWorldBook, retrievalText);
    const imports = {
        worldInfoBefore: {
            label: MEMORY_IMPORT_LABELS.worldInfoBefore,
            content: stWorldInfo.before,
        },
        worldInfoAfter: {
            label: MEMORY_IMPORT_LABELS.worldInfoAfter,
            content: stWorldInfo.after,
        },
        // Character fields — full content, ST format
        charDescription: {
            label: MEMORY_IMPORT_LABELS.charDescription,
            content: _stCharField(scopedCharacters, 'description'),
        },
        charPersonality: {
            label: MEMORY_IMPORT_LABELS.charPersonality,
            content: _stCharField(scopedCharacters, 'personality'),
        },
        scenario: {
            label: MEMORY_IMPORT_LABELS.scenario,
            content: _stCharField(scopedCharacters, 'scenario'),
        },
        dialogueExamples: {
            label: MEMORY_IMPORT_LABELS.dialogueExamples,
            content: _stCharField(scopedCharacters, 'dialogue'),
        },
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

    // 自适应上下文压缩：三层策略，80% 阈值触发
    const compression = compressMessages(
        built.systemPrompt,
        built.messages,
        modelContext.total,
        config.maxTokens || modelContext.output || 4096,
        {
            compressThreshold: context.compressThreshold ?? 0.80,
            recentRounds: context.recentRounds ?? 5,
        },
    );

    return {
        systemPrompt: compression.systemPrompt,
        messages: compression.messages,
        tools: referenceTools.definitions,
        referenceTools,
        debug: {
            modelContext: modelContext.total,
            inputBudget: totalInputBudget,
            layerBudgets,
            preset: built.debug,
            compression,
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
    const refDefs = enabled ? getReferenceToolDefinitions() : [];
    // Always include import_data so users can create characters/worldbooks from write mode
    const definitions = [...refDefs, ...ASSIST_TOOLS];
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
        const folder = getWorldBookFolder(entry);
        return !!folder && reference.selectedWorldbookGroups.includes(folder);
    });
    return { ...(worldBook || {}), entries: Object.fromEntries(entries) };
}

function getWorldBookFolder(entry = {}) {
    return String(entry.folder || entry._folder || entry._source || entry.group || '').trim();
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
        || data.extensions?.cuigengji?.disabled === true
        || data.extensions?.novel_ai_editor?.disabled === true;
}

function isWorldBookEntryDisabled(entry = {}) {
    return entry.disable === true
        || entry.disabled === true
        || entry.enabled === false
        || isAutomationWorldBookEntry(entry);
}

function isWorldInfoBeforePosition(position) {
    if (position === undefined || position === null || position === '') return true;
    const normalized = String(position).toLowerCase();
    return normalized === '0'
        || normalized === 'before'
        || normalized === 'before_char'
        || normalized === 'beforechar'
        || normalized === 'before_characters';
}

function isWorldInfoAfterPosition(position) {
    const normalized = String(position ?? '').toLowerCase();
    return normalized === '1'
        || normalized === 'after'
        || normalized === 'after_char'
        || normalized === 'afterchar'
        || normalized === 'after_characters';
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
            summary: character.summary || character.data?.summary || '',
            aiSummary: character.aiSummary || character.data?.aiSummary,
            summaryGenerator: character.summaryGenerator || character.data?.summaryGenerator,
            summarySourceHash: character.summarySourceHash || character.data?.summarySourceHash,
            aiSummarySourceHash: character.aiSummarySourceHash || character.data?.aiSummarySourceHash,
            extensions: character.extensions || character.data?.extensions,
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

function buildWorldSettingLayer(_memories, ctx, budget) {
    // Native track: inject all scoped entries as compact summaries.
    // Keyword matching (ST legacy) is skipped; user controls scope via
    // "本次写作使用" (all / selected groups / off), already applied by
    // applyWorldBookReference before we get here.

    // Active entries — trimmed to 85% budget so the disabled section fits
    const activeBudget = Math.floor(budget * 0.85);
    const entries = (ctx.worldBookEntries || []).slice(0, 15);
    const activeContent = entries
        .map(entry => `- ${entry.name || '未命名设定'}: ${entry.summary || entry.content || ''}`)
        .join('\n');
    const parts = [trimToTokenBudget(activeContent, activeBudget)].filter(Boolean);

    // Disabled entries: inform the model but instruct it not to use them
    const disabled = ctx.disabledWorldBookEntries || [];
    if (disabled.length) {
        const disabledLines = disabled
            .slice(0, 10)
            .map(e => `- ${e.name}${e.brief ? '：' + e.brief : ''}`)
            .join('\n');
        parts.push('以下条目已被用户禁用，你可以简单了解这些设定，但不要在正文中出现相关内容：\n' + disabledLines);
    }

    // Disabled character cards
    const disabledChars = ctx.disabledCharacters || [];
    if (disabledChars.length) {
        parts.push('以下角色的角色卡资料已被用户禁用：' + disabledChars.join('、') +
            '。这只表示不要读取、继承或引用这些角色卡里的详细设定；不表示故事中的同名人物不能出场。若该人物已经在当前正文、前情或作者要求中出现，可以基于已知正文事实正常写作。若剧情必须依赖其角色卡专属设定，请输出 [SUGGEST_ENABLE:character:角色名:理由]。');
    }

    const content = parts.join('\n\n');
    return layerDebug('worldSetting', content, budget);
}

function buildCharacterStateLayer(_memories, ctx, budget) {
    // Native track: use reference-scoped characters with text-appearance
    // inference (auto mode) or manual selection (selected mode).
    // The scope is already applied by applyCharacterReference.
    const content = inferCharacterState(ctx.characters || [], ctx.currentText || '', ctx.compactReference);
    return layerDebug('characterState', trimToTokenBudget(content, budget), budget);
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
        parts.push('未完成大纲：\n' + (ctx.outline || [])
            .filter(node => !node.completed)
            .slice(0, 10)
            .map(node => `- ${node.title}${node.description ? `: ${node.description}` : ''}`)
            .join('\n'));
    }
    if (ctx.plotMemory?.keyEvents?.length) {
        parts.push('关键事件：\n' + ctx.plotMemory.keyEvents.slice(-20)
            .map(event => `- ${event.title}: ${event.content}`)
            .join('\n'));
    }
    if (ctx.plotMemory?.openOutline?.length) {
        parts.push('开放大纲：\n' + ctx.plotMemory.openOutline.slice(0, 12)
            .map(node => `- ${node.title}${node.content ? `: ${node.content}` : ''}`)
            .join('\n'));
    }
    return layerDebug('plotHistory', trimToTokenBudget(parts.filter(Boolean).join('\n\n'), budget), budget, selected);
}

function buildRecentPlotLayer(ctx, budget, recentChapters = []) {
    const parts = [];
    // 近期章节输入全文（非摘要），窗口锚定后稳定可缓存。
    // 当前正文和作者即时要求不放在这里；它们由动态层的正文快照和作者要求显式提供。
    for (const ch of recentChapters) {
        const title = ch.title || '';
        const content = cleanSceneText(ch.content || '');
        if (content) parts.push(`\n${title}全文：\n${content}`);
    }
    return layerDebug('recentPlot', trimToTokenBudget(parts.join('\n'), budget), budget);
}

function resolveRecentChapters(allChapters = [], recentSummaries = [], currentSummary = null) {
    if (!allChapters.length || !recentSummaries.length) return [];
    const recentTitles = new Set(recentSummaries.map(s => normalizeTitle(s.title || s.chapterTitle || s.name || '')));
    const current = chapterSummaryPointer(currentSummary, -1);
    const currentId = String(current?.id || '');
    const currentTitle = normalizeTitle(current?.title || '');
    const currentOrder = current?.order;
    return allChapters
        .filter(ch => recentTitles.has(normalizeTitle(ch.title || '')))
        .filter(ch => {
            if (currentId && String(ch.id || '') === currentId) return false;
            if (currentTitle && normalizeTitle(ch.title || '') === currentTitle) return false;
            if (currentOrder !== undefined && currentOrder !== null && Number(ch.order ?? ch.index) === Number(currentOrder)) return false;
            return true;
        })
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function splitChapterSummaries(ctx = {}) {
    const summaries = Array.isArray(ctx.plotMemory?.chapterSummaries)
        ? ctx.plotMemory.chapterSummaries.filter(Boolean)
        : [];
    if (!summaries.length) return { recent: [], distant: [] };

    // chapterWindowBase 允许前端锁定章节窗口，避免每新写一章就破坏缓存。
    // 仅在首次聊天或用户显式刷新时才更新此锚点。
    const anchorTitle = ctx.chapterWindowBase || ctx.chapterTitle || '';
    const currentTitle = normalizeTitle(anchorTitle);
    let currentIndex = summaries.findIndex(summary => normalizeTitle(summary.title || summary.chapterTitle || summary.name || '') === currentTitle);
    if (currentIndex < 0) currentIndex = summaries.length - 1;

    // recent 窗口大小：默认3章，可通过 recentChapterCount 放大来提升缓存稳定性
    const windowSize = Math.max(2, Number(ctx.recentChapterCount) || 3);
    const visible = ctx.includeFutureChapters === true
        ? summaries
        : summaries.slice(0, currentIndex + 1);
    const visibleCurrentIndex = ctx.includeFutureChapters === true
        ? currentIndex
        : visible.length - 1;
    const start = Math.max(0, visibleCurrentIndex - (windowSize - 1));
    const end = Math.min(visible.length, visibleCurrentIndex + 1);
    const recent = visible.slice(start, end);
    const distant = visible.slice(0, start);
    return {
        recent,
        distant,
        windowBase: anchorTitle,
        windowSize,
        futureExcluded: ctx.includeFutureChapters === true ? 0 : Math.max(0, summaries.length - visible.length),
    };
}

function splitChapterSummariesByAnchor(ctx = {}) {
    const summaries = Array.isArray(ctx.plotMemory?.chapterSummaries)
        ? ctx.plotMemory.chapterSummaries.filter(Boolean)
        : [];
    if (!summaries.length) return { recent: [], distant: [], anchor: null };

    const currentIndex = resolveChapterSummaryIndex(summaries, {
        id: ctx.chapterId,
        title: ctx.chapterTitle,
        order: ctx.chapterOrder,
    }, summaries.length - 1);
    const visible = ctx.includeFutureChapters === true
        ? summaries
        : summaries.slice(0, currentIndex + 1);
    const visibleCurrentIndex = ctx.includeFutureChapters === true
        ? currentIndex
        : visible.length - 1;
    const fallbackAnchorIndex = Math.max(0, visibleCurrentIndex - 5);
    const anchorInput = normalizeChapterAnchor(ctx.chapterWindowAnchor || ctx.memoryAnchor || {
        id: ctx.chapterWindowBaseId,
        title: ctx.chapterWindowBase || ctx.memoryAnchorChapterTitle,
        order: ctx.chapterWindowBaseOrder || ctx.memoryAnchorChapterOrder,
    });
    let anchorIndex = resolveChapterSummaryIndex(visible, anchorInput, fallbackAnchorIndex);
    anchorIndex = clamp(anchorIndex, 0, Math.max(0, visibleCurrentIndex));

    const recent = visible.slice(anchorIndex, visibleCurrentIndex + 1);
    const distant = visible.slice(0, anchorIndex);
    const anchorSummary = visible[anchorIndex] || null;
    const currentSummary = visible[visibleCurrentIndex] || null;

    return {
        recent,
        distant,
        anchor: chapterSummaryPointer(anchorSummary, anchorIndex),
        current: chapterSummaryPointer(currentSummary, visibleCurrentIndex),
        windowBase: anchorSummary?.title || anchorSummary?.chapterTitle || anchorSummary?.name || '',
        windowSize: recent.length,
        anchorPolicy: 'fixed-until-new-session-or-context-pack',
        futureExcluded: ctx.includeFutureChapters === true ? 0 : Math.max(0, summaries.length - visible.length),
    };
}

function normalizeChapterAnchor(anchor = {}) {
    if (typeof anchor === 'string') return { title: anchor };
    if (!anchor || typeof anchor !== 'object') return {};
    return {
        id: anchor.id || anchor.chapterId || '',
        title: anchor.title || anchor.chapterTitle || anchor.name || '',
        order: anchor.order ?? anchor.chapterOrder ?? anchor.index,
    };
}

function resolveChapterSummaryIndex(summaries = [], target = {}, fallbackIndex = 0) {
    const anchor = normalizeChapterAnchor(target);
    if (anchor.id) {
        const byId = summaries.findIndex(summary => String(summary.id || summary.chapterId || '') === String(anchor.id));
        if (byId >= 0) return byId;
    }
    if (anchor.title) {
        const title = normalizeTitle(anchor.title);
        const byTitle = summaries.findIndex(summary =>
            normalizeTitle(summary.title || summary.chapterTitle || summary.name || '') === title);
        if (byTitle >= 0) return byTitle;
    }
    if (anchor.order !== undefined && anchor.order !== null && anchor.order !== '') {
        const order = Number(anchor.order);
        if (Number.isFinite(order)) {
            const byOrder = summaries.findIndex(summary => Number(summary.order ?? summary.index) === order);
            if (byOrder >= 0) return byOrder;
        }
    }
    return clamp(Number(fallbackIndex) || 0, 0, Math.max(0, summaries.length - 1));
}

function chapterSummaryPointer(summary, index) {
    if (!summary) return null;
    return {
        id: summary.id || summary.chapterId || '',
        title: summary.title || summary.chapterTitle || summary.name || '',
        order: summary.order ?? summary.index ?? index,
        index,
    };
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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

function collectDisabledWorldBookBriefs(worldBook = {}, compactReference = false) {
    return Object.values(worldBook.entries || {})
        .filter(entry => isWorldBookEntryDisabled(entry))
        .map(entry => ({
            name: entry.comment || entry.key?.[0] || `Entry ${entry.uid ?? ''}`,
            brief: compactReference
                ? (entry.content || '').substring(0, 120)
                : (entry.content || '').substring(0, 200),
        }))
        .filter(e => e.name);
}

function collectDisabledCharacterNames(allCharacters = [], reference) {
    const ref = reference || {};
    return (allCharacters || [])
        .filter(ch => isCharacterDisabled(ch))
        .map(ch => {
            const data = ch.data || ch;
            return data.name || ch.name || '';
        })
        .filter(Boolean);
}

function inferCharacterState(characters, currentText, compactReference = false) {
    return (characters || [])
        .map(character => {
            const data = character.data || character;
            const name = data.name || character.name || '';
            if (!name) return '';
            const appears = currentText.includes(name);
            const description = characterPromptDescription(character, compactReference);
            const fields = [
                description ? `${compactReference ? '摘要' : '描述'}：${description}` : '',
                data.personality ? `性格：${data.personality}` : '',
                data.scenario ? `场景：${data.scenario}` : '',
                !compactReference && data.first_mes ? `首条消息：${data.first_mes}` : '',
            ].filter(Boolean);
            const state = [];
            if (appears) state.push('当前正文中出场');
            const dynamic = data.extensions?.novel_editor_state || data.novel_editor_state || {};
            for (const [key, value] of Object.entries(dynamic)) {
                if (value) state.push(`${key}: ${String(value)}`);
            }
            if (!fields.length && !state.length) return '';
            return `- ${name}${state.length ? `（${state.join('；')}）` : ''}: ${fields.join(' / ')}`;
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

function cleanSceneText(text = '') {
    return String(text || '')
        .split(/\r?\n/)
        .filter(line => !isImportedNoiseLine(line))
        .join('\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
}

function isImportedNoiseLine(line = '') {
    const text = String(line || '').trim();
    if (!text) return false;
    if (/^={6,}$/.test(text) || /^-{6,}$/.test(text)) return true;
    return /知轩藏书|更多精校小说|zxcs8\.com|www\.zxcs8\.com|下载[:：]?http|精校小说尽在/i.test(text);
}

function normalizeTitle(value = '') {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function safeReferenceName(value = '') {
    return String(value || 'ref').replace(/[\s:;；,[\]]+/g, '_').slice(0, 48) || 'ref';
}

function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimToTokenBudget(text, budget) {
    if (!text) return '';
    const tokens = estimateTextTokens(text);
    if (tokens <= budget) return text;
    const keepChars = Math.max(500, Math.floor(text.length * (budget / tokens) * 0.9));
    return `[前文因预算裁剪]\n${text.slice(-keepChars)}`;
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

/**
 * \u81ea\u9002\u5e94\u4e0a\u4e0b\u6587\u538b\u7f29 \u2014 \u4e09\u5c42\u7b56\u7565\uff1a
 *   \u2460 \u6c38\u4e0d\u538b\u7f29: system \u6d88\u606f\uff08\u5e73\u53f0/\u4e16\u754c\u4e66/\u89d2\u8272\uff09\u2014 \u4e0d\u52a8
 *   \u2461 \u7a97\u53e3\u63a7\u5236: \u8fdc\u671f\u7ae0\u8282\u6458\u8981 + \u8fd1\u671f\u7ae0\u8282\u5168\u6587 \u2014 \u968f chapterWindowBase \u79fb\u52a8
 *   \u2462 \u8ddd\u79bb\u8870\u51cf: \u5bf9\u8bdd\u5386\u53f2 \u2014 \u6700\u8fd1 N \u8f6e\u4fdd\u7559\u539f\u6587\uff0c\u4ee5\u5916\u5408\u5e76\u4e3a\u6458\u8981
 *
 * \u89e6\u53d1\u6761\u4ef6: totalTokens > modelWindow \u00d7 threshold\uff08\u9ed8\u8ba4 80%\uff09
 * \u8fd4\u56de\u538b\u7f29\u540e\u7684 messages + \u7edf\u8ba1\u4fe1\u606f\u4f9b\u524d\u7aef\u5c55\u793a\u3002
 */
function compressMessages(systemPrompt, messages, modelContextSize, maxOutputTokens, opts = {}) {
    const threshold = opts.compressThreshold ?? 0.80;
    const recentRounds = opts.recentRounds ?? 5;
    const effectiveLimit = Math.max(4096, modelContextSize - (maxOutputTokens || 4096) - 1024);
    const triggerAt = Math.floor(effectiveLimit * threshold);

    // \u5206\u7c7b\u6d88\u606f
    const systemMsgs = [];
    const historyMsgs = [];   // user + assistant pairs
    const lastUserMsg = { idx: -1, msg: null };

    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === 'system') {
            systemMsgs.push({ idx: i, msg: m, tokens: estimateTextTokens(m.content || '') });
        } else if (m.role === 'user') {
            lastUserMsg.idx = i;
            lastUserMsg.msg = m;
            historyMsgs.push({ idx: i, role: 'user', msg: m, tokens: estimateTextTokens(m.content || '') });
        } else if (m.role === 'assistant') {
            historyMsgs.push({ idx: i, role: 'assistant', msg: m, tokens: estimateTextTokens(m.content || '') });
        }
    }

    const systemTokens = estimateTextTokens(systemPrompt) + systemMsgs.reduce((s, m) => s + m.tokens, 0);
    const historyTokens = historyMsgs.reduce((s, m) => s + m.tokens, 0);
    const totalTokens = systemTokens + historyTokens;
    const usagePct = totalTokens / effectiveLimit;

    // \u672a\u8d85\u9608\u503c \u2192 \u4e0d\u538b\u7f29
    if (totalTokens <= triggerAt) {
        return {
            messages,
            systemPrompt,
            systemTokens,
            historyTokens,
            totalTokens,
            effectiveLimit,
            triggerAt,
            usagePct: Math.round(usagePct * 10000) / 10000,
            compressedRounds: 0,
            keptRounds: recentRounds,
            windowUpdateNeeded: false,
        };
    }

    // \u89e6\u53d1\u538b\u7f29\uff1a\u627e\u51fa\u300c\u6700\u8fd1 N \u8f6e\u300d\u7684\u8fb9\u754c
    // \u8f6e\u6b21 = user-role \u6d88\u606f\uff08\u56e0\u4e3a\u6bcf\u8f6e\u5f00\u5934\u662f\u7528\u6237\u6d88\u606f\uff1a\u6b63\u6587+\u8981\u6c42\uff09
    const userIndices = historyMsgs
        .map((h, i) => h.role === 'user' ? i : -1)
        .filter(i => i >= 0);
    const recentStart = userIndices.length > recentRounds
        ? userIndices[userIndices.length - recentRounds]
        : 0;

    // \u5206\u9694\uff1arecentStart \u4e4b\u524d \u2192 \u6458\u8981\uff0c\u4e4b\u540e \u2192 \u4fdd\u7559\u539f\u6587
    const distantHistory = historyMsgs.slice(0, recentStart);
    const recentHistory = historyMsgs.slice(recentStart);

    // \u751f\u6210\u8fdc\u671f\u5bf9\u8bdd\u6458\u8981
    let summaryText = '';
    if (distantHistory.length) {
        summaryText = buildConversationSummary(distantHistory);
    }

    // \u7ec4\u88c5\u538b\u7f29\u540e\u7684\u6d88\u606f
    const compressed = [];

    // \u6240\u6709 system \u6d88\u606f\u4fdd\u6301\u4e0d\u53d8
    for (const { msg } of systemMsgs) {
        compressed.push(msg);
    }

    // \u8fdc\u671f\u5bf9\u8bdd\u6458\u8981
    if (summaryText) {
        compressed.push({
            role: 'system',
            content: '## \ud83d\udccb \u66f4\u65e9\u7684\u5bf9\u8bdd\u6458\u8981\n' + summaryText,
        });
    }

    // \u6700\u8fd1 N \u8f6e\u539f\u6587
    for (const { msg } of recentHistory) {
        compressed.push(msg);
    }

    // \u786e\u4fdd\u6700\u540e\u4e00\u6761 user \u6d88\u606f\uff08\u5f53\u524d\u8bf7\u6c42\uff09\u672a\u88ab\u88c1\u6389
    if (lastUserMsg.msg && !recentHistory.some(h => h.idx === lastUserMsg.idx)) {
        compressed.push(lastUserMsg.msg);
    }

    const compressedTokens = systemTokens +
        (summaryText ? estimateTextTokens(summaryText) + 50 : 0) +
        recentHistory.reduce((s, h) => s + h.tokens, 0);

    const stillOverThreshold = compressedTokens > triggerAt;

    return {
        messages: compressed,
        systemPrompt,
        systemTokens,
        historyTokens: compressedTokens - systemTokens,
        totalTokens: compressedTokens,
        effectiveLimit,
        triggerAt,
        usagePct: Math.round((compressedTokens / effectiveLimit) * 10000) / 10000,
        compressedRounds: Math.floor(distantHistory.length / 2),
        keptRounds: Math.floor(recentHistory.length / 2),
        windowUpdateNeeded: stillOverThreshold,
    };
}

/**
 * \u5c06\u8fdc\u671f\u5bf9\u8bdd\u5386\u53f2\u5408\u5e76\u4e3a\u4e00\u6bb5\u7b80\u8981\u6458\u8981
 */
function buildConversationSummary(historyMsgs = []) {
    if (!historyMsgs.length) return '';
    const userMsgs = historyMsgs.filter(h => h.role === 'user');
    if (!userMsgs.length) return `\u5171 ${Math.floor(historyMsgs.length / 2)} \u8f6e\u5bf9\u8bdd\u5df2\u7701\u7565\u3002`;

    // \u4ece\u7528\u6237\u6d88\u606f\u4e2d\u63d0\u53d6\u7ae0\u8282\u53f7\u548c\u5173\u952e\u52a8\u4f5c
    const chapters = new Set();
    const actions = [];
    for (const h of userMsgs) {
        const text = h.msg.content || '';
        const chMatch = text.match(/\u7b2c(\d+)/g);
        if (chMatch) chMatch.forEach(c => chapters.add(c));
        if (/\u4fee\u6539|\u8c03\u6574|\u6539|\u91cd\u5199|\u5220/.test(text)) actions.push('\u8c03\u6574');
        else if (/\u7ee7\u7eed|\u7eed\u5199|\u5199/.test(text)) actions.push('\u7eed\u5199');
        else if (/\u8865\u5199|\u63d2\u5165/.test(text)) actions.push('\u8865\u5199');
    }

    const chapterList = [...chapters].sort((a, b) => parseInt(a) - parseInt(b));
    const chapterRange = chapterList.length
        ? `\u6d89\u53ca\u7ae0\u8282\uff1a${chapterList.join('\u3001')}`
        : '';

    const actionCounts = {};
    for (const a of actions) { actionCounts[a] = (actionCounts[a] || 0) + 1; }
    const actionSummary = Object.entries(actionCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}\u00d7${v}`)
        .join('\u3001');

    const roundCount = Math.floor(historyMsgs.length / 2);
    return [
        `\u524d\u9762 ${roundCount} \u8f6e\u5bf9\u8bdd\u7684\u6458\u8981\uff08\u7528\u6237\u5bf9\u65e7\u7248\u672c\u7684\u624b\u52a8\u4fee\u6539\u8bf7\u636e\u6b64\u63a8\u65ad\uff09\uff1a`,
        chapterRange,
        actionSummary ? `\u4e3b\u8981\u64cd\u4f5c\uff1a${actionSummary}` : '',
        userMsgs.length > 1 ? `\u9996\u8f6e\u8981\u6c42\uff1a${(userMsgs[0].msg.content || '').slice(0, 80)}...` : '',
        userMsgs.length > 1 ? `\u672b\u8f6e\u8981\u6c42\uff1a${(userMsgs[userMsgs.length - 1].msg.content || '').slice(0, 80)}...` : '',
    ].filter(Boolean).join('\uff1b');
}
