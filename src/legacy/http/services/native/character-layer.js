/**
 * 催更姬 — Native 路线 · 角色状态层
 *
 * 根据文本出场推断和用户引用设置，注入角色状态摘要。
 * 本模块仅在 Native/智能摘要路线下使用。
 */

import { characterPromptDescription, trimToTokenBudget, layerDebug, safeReferenceName } from './utils.js';

// ==================== Prompt layer builder ====================

/**
 * 构建 Native 路线的角色状态注入内容。
 * 调用方负责提供已通过 applyCharacterReference 筛选过的角色列表。
 */
export function buildCharacterStateLayer(ctx = {}, budget = 0) {
    const parts = [];

    const content = inferCharacterState(ctx.characters || [], ctx.currentText || '', ctx.compactReference);
    if (content) {
        const activeBudget = Math.floor(budget * 0.85);
        parts.push('## 本次写作启用的角色\n以下是简略摘要。如需完整角色卡请用 get_reference_detail 工具查询。\n\n'
            + trimToTokenBudget(content, activeBudget));
    }

    const excluded = ctx.excludedCharacters || [];
    if (excluded.length) {
        const names = excluded.map(c => {
            const d = c.data || c;
            return d.name || c.name || '';
        }).filter(Boolean).slice(0, 20).join('、');
        if (names) {
            parts.push('## 本次未注入的角色卡\n' + names);
        }
    }

    const disabledNames = ctx.disabledCharacters || [];
    if (disabledNames.length) {
        parts.push('## 已禁用的角色卡\n' + disabledNames.slice(0, 20).join('、'));
    }

    const final = parts.join('\n\n');
    return layerDebug('characterState', trimToTokenBudget(final, budget), budget);
}

// ==================== Character state inference ====================

function inferCharacterState(characters = [], currentText = '', compactReference = false) {
    return (characters || [])
        .map(ch => {
            const data = ch.data || ch;
            const name = data.name || ch.name || '';
            if (!name) return '';
            const appears = currentText.includes(name);
            const description = characterPromptDescription(ch, compactReference);
            const summary = data.summary || description;
            const state = [];
            if (appears) state.push('当前正文中出场');
            const dynamic = data.extensions?.novel_editor_state || data.novel_editor_state || {};
            for (const [key, value] of Object.entries(dynamic)) {
                if (value) state.push(`${key}: ${String(value)}`);
            }
            const id = `character:${safeReferenceName(name)}`;
            const pieces = [
                `[${id}] ${name}`,
                summary ? `summary: ${summary}` : '',
                state.length ? `state: ${state.join('；')}` : '',
            ].filter(Boolean);
            return pieces.length > 1 ? `- ${pieces.join(' | ')}` : '';
        })
        .filter(Boolean)
        .join('\n');
}

export function formatActiveCharacters(characters = [], currentText = '') {
    return (characters || [])
        .filter(ch => currentText.includes((ch.data?.name || ch.name || '')))
        .map(ch => {
            const name = ch.data?.name || ch.name || '';
            return `- ${name}${safeReferenceName(name) ? ' [character:' + safeReferenceName(name) + ']' : ''}`;
        })
        .join('\n');
}
