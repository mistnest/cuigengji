/**
 * 催更姬 — Native 路线 · 世界书注入层
 *
 * 负责将用户启用的世界书条目展平为简略摘要注入 prompt，
 * 同时列出禁用条目供模型参考（但不使用）。
 *
 * 本模块仅在 Native/智能摘要路线下使用，ST 路线走 st/formatters.js。
 */

import { getWorldBookEntrySummary } from '../reference-summaries.js';
import {
    isWorldBookEntryDisabled,
    isCharacterDisabled,
    worldBookEntryPromptText,
    trimToTokenBudget,
    layerDebug,
} from './utils.js';

// ==================== Entry classification ====================

/**
 * 将条目按用户三维意图分类。
 * @param {object[]} allEntries — 原始世界书条目列表
 * @param {object} reference — 标准化后的 writingReference
 */
export function classifyWorldEntries(allEntries = [], reference = {}) {
    const wanted = [];
    const excluded = [];
    const disabled = [];

    for (const entry of allEntries) {
        if (isWorldBookEntryDisabled(entry)) {
            disabled.push(entry);
            continue;
        }

        const folder = getFolder(entry);
        const included =
            reference.worldbookMode === 'off' ? false :
            reference.worldbookMode === 'selected' ? (!!folder && reference.selectedWorldbookGroups?.includes(folder)) :
            true; // 'all' mode

        if (included) wanted.push(entry);
        else excluded.push(entry);
    }

    return { wanted, excluded, disabled };
}

function getFolder(entry = {}) {
    return String(entry.folder || entry._folder || entry._source || entry.group || '').trim();
}

/**
 * 按同样的三维逻辑分类角色。
 */
export function classifyCharacters(allCharacters = [], reference = {}) {
    const wanted = [];
    const excluded = [];
    const disabled = [];

    for (const ch of allCharacters) {
        if (isCharacterDisabled(ch)) {
            disabled.push(ch);
            continue;
        }

        const data = ch.data || ch;
        const name = data.name || ch.name || '';
        if (!name) continue;

        const included =
            reference.characterMode === 'off' ? false :
            reference.characterMode === 'selected' ? reference.selectedCharacters?.includes(name) :
            true; // 'auto' or unknown

        if (included) wanted.push(ch);
        else excluded.push(ch);
    }

    return { wanted, excluded, disabled };
}

// ==================== Prompt layer builder ====================

/**
 * 构建 Native 路线的世界书注入内容。
 * 调用方（context-orchestrator）负责提供 fullContext，
 * 其中 worldBookEntries 和 disabledWorldBookEntries 已预先分类。
 */
export function buildWorldSettingLayer(ctx = {}, budget = 0) {
    const parts = [];

    // ── Wanted entries (active for this session) ──
    const entries = (ctx.worldBookEntries || []).slice(0, 15);
    const activeContent = entries
        .map(e => `- ${e.name || '未命名设定'}: ${e.summary || e.content || ''}`)
        .join('\n');
    if (activeContent) {
        const activeBudget = Math.floor(budget * 0.85);
        parts.push('## 本次写作启用的设定\n以下是简略摘要。如需完整内容请用 get_reference_detail 工具查询。\n\n' +
            trimToTokenBudget(activeContent, activeBudget));
    }

    // ── Excluded entries (filtered by reference mode but NOT disabled) ──
    const excluded = ctx.excludedWorldBookEntries || [];
    if (excluded.length) {
        const lines = excluded
            .slice(0, 10)
            .map(e => `- ${e.name}${e.summary ? '：' + e.summary : e.content ? '：' + (e.content || '').substring(0, 120) : ''}`)
            .join('\n');
        parts.push('## 本次写作排除的设定\n以下条目本次未启用。如果你认为某条对当前剧情很重要，先调用 get_reference_detail 确认，然后使用 [SUGGEST_ENABLE:条目类型:条目名称:理由] 标记向作者建议启用。\n\n' + lines);
    }

    // ── Disabled entries (explicitly disabled) ──
    const disabled = ctx.disabledWorldBookEntries || [];
    if (disabled.length) {
        // Separate character-profile entries from pure world-setting entries
        const charLike = disabled.filter(e => /基础信息|性格|调色盘|二次解释|角色/.test(e.name));
        const worldLike = disabled.filter(e => !charLike.includes(e));
        const lines = [];
        if (worldLike.length) {
            lines.push('（世界观/规则条目）');
            worldLike.slice(0, 12).forEach(e => lines.push(`- ${e.name}`));
        }
        if (charLike.length) {
            lines.push('');
            lines.push('（角色设定条目——注意：禁用的是设定资料，不是角色本身。角色仍可在正文中出场和说话）');
            charLike.slice(0, 8).forEach(e => lines.push(`- ${e.name}（设定条目）`));
        }
        parts.push('## 已禁用的设定\n以下设定条目的详细资料已被禁用。如果写作需要某条目的详细设定，请使用 [SUGGEST_ENABLE:条目类型:条目名称:理由] 标记建议启用。\n\n' + lines.join('\n'));
    }

    const content = parts.join('\n\n');
    return layerDebug('worldSetting', content, budget);
}

// ==================== Entry flatteners ====================

/**
 * 将世界书条目展平为前端可消费的简略格式。
 * 只取 enable 的条目；disable 的条目应由 collectDisabledWorldBookBriefs 单独收集。
 */
export function flattenWorldBookEntries(worldBook = {}, compactReference = false) {
    return Object.values(worldBook.entries || {})
        .filter(e => !isWorldBookEntryDisabled(e))
        .map(e => ({
            name: e.comment || e.key?.[0] || `Entry ${e.uid ?? ''}`,
            content: worldBookEntryPromptText(e, compactReference),
            summary: compactReference ? getWorldBookEntrySummary(e) : '',
            key: e.key || [],
            constant: Boolean(e.constant),
        }));
}

/**
 * 收集禁用条目的简要信息，供模型参考但不使用。
 */
export function collectDisabledWorldBookBriefs(worldBook = {}, compactReference = false) {
    return Object.values(worldBook.entries || {})
        .filter(e => isWorldBookEntryDisabled(e))
        .map(e => ({
            name: e.comment || e.key?.[0] || `Entry ${e.uid ?? ''}`,
            brief: compactReference
                ? (e.content || '').substring(0, 120)
                : (e.content || '').substring(0, 200),
        }))
        .filter(e => e.name);
}

/**
 * 收集禁用角色名称列表。
 */
export function collectDisabledCharacterNames(allCharacters = [], reference = {}) {
    return (allCharacters || [])
        .filter(ch => isCharacterDisabled(ch))
        .map(ch => {
            const data = ch.data || ch;
            return data.name || ch.name || '';
        })
        .filter(Boolean);
}
