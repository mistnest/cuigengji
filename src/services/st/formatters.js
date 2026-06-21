/**
 * 催更姬 — ST 兼容路线 · 格式化函数
 *
 * 对齐真实 SillyTavern 的上下文注入方式：
 * - 世界书条目通过关键词匹配激活，按 position 分 before/after 两组，注入原文内容
 * - 角色卡按 description/personality/scenario/dialogue 分字段注入原文
 */

import { WorldBookEngine } from '../worldbook-engine.js';
import {
    isWorldBookEntryDisabled,
    isCharacterDisabled,
    getWorldBookFolder,
    isWorldInfoBeforePosition,
    isWorldInfoAfterPosition,
    worldBookEntryPromptText,
    characterPromptDescription,
    ST_DEFAULT_HEADER,
} from './utils.js';

/**
 * 关键词匹配世界书条目，按 position 拆分为 before/after。
 * 对齐真实 ST 的 checkWorldInfo → WIBeforeEntries/WIAfterEntries。
 *
 * @param {object} worldBook — worldBook with .entries
 * @param {string} scanText — chat text to scan for keywords
 * @returns {{ before: string, after: string }}
 */
export function buildStWorldInfo(worldBook, scanText) {
    const engine = new WorldBookEngine(worldBook);
    const activated = engine.scan(scanText);

    const beforeEntries = [];
    const afterEntries = [];

    for (const entry of activated) {
        if (isWorldInfoBeforePosition(entry.position)) {
            beforeEntries.push(entry);
        } else if (isWorldInfoAfterPosition(entry.position)) {
            afterEntries.push(entry);
        }
    }

    const formatEntries = (entries) => {
        if (!entries.length) return '';
        // Real ST format: each entry's raw content, joined by newlines
        const body = entries.map(e => e.content || '').filter(Boolean).join('\n');
        return body ? ST_DEFAULT_HEADER + '\n' + body : '';
    };

    return {
        before: formatEntries(beforeEntries),
        after: formatEntries(afterEntries),
    };
}

/**
 * 从角色列表构建 ST 模式的角色字段。对齐真实 ST 的 preparePromptsForChatCompletion。
 * ST 注入完整原文，不使用 compactReference。
 *
 * @param {object[]} characters
 * @param {string} field — 'description' | 'personality' | 'scenario' | 'dialogue'
 * @returns {string}
 */
export function buildStCharField(characters = [], field = 'description') {
    const active = (characters || []).filter(c => !isCharacterDisabled(c));
    if (!active.length) return '';

    switch (field) {
        case 'description': {
            const parts = active
                .map(c => {
                    const data = c.data || c;
                    return data.description || c.description || '';
                })
                .filter(Boolean);
            return parts.length ? parts.join('\n') : '';
        }
        case 'personality': {
            const parts = active
                .map(c => {
                    const data = c.data || c;
                    return data.personality || '';
                })
                .filter(Boolean);
            return parts.length ? parts.join('\n') : '';
        }
        case 'scenario': {
            const parts = active
                .map(c => {
                    const data = c.data || c;
                    return data.scenario || '';
                })
                .filter(Boolean);
            return parts.length ? parts.join('\n') : '';
        }
        case 'dialogue': {
            const parts = active
                .filter(c => {
                    const data = c.data || c;
                    return data.first_mes || data.mes_example;
                })
                .map(c => {
                    const data = c.data || c;
                    return [data.first_mes, data.mes_example].filter(Boolean).join('\n');
                })
                .filter(Boolean);
            return parts.length ? ST_DEFAULT_HEADER + '\n' + parts.join('\n\n') : '';
        }
        default:
            return '';
    }
}
