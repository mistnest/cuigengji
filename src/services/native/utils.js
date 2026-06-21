/**
 * 催更姬 — Shared Setting Utilities
 *
 * 世界书/角色卡相关的低层工具函数，供 Native 路线、ST 路线和 context-orchestrator 共同使用。
 * 单独抽出来是为了避免 native/ 和 st/ 与 context-orchestrator 产生循环 import。
 */

import { getCharacterSummary, getWorldBookEntrySummary } from '../reference-summaries.js';

// ==================== Entry filtering ====================

export function isAutomationWorldBookEntry(entry = {}) {
    const comment = String(entry.comment || entry.name || '').toLowerCase();
    const content = String(entry.content || '').trim();
    return comment.includes('ejs')
        || content.startsWith('@@generate_before')
        || content.startsWith('@@generate_after')
        || content.startsWith('<%_')
        || content.startsWith('<%');
}

export function isWorldBookEntryDisabled(entry = {}) {
    return entry.disable === true
        || entry.disabled === true
        || entry.enabled === false
        || isAutomationWorldBookEntry(entry);
}

export function isCharacterDisabled(character = {}) {
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

// ==================== Position helpers ====================

export function isWorldInfoBeforePosition(position) {
    if (position === undefined || position === null || position === '') return true;
    const normalized = String(position).toLowerCase();
    return normalized === '0'
        || normalized === 'before'
        || normalized === 'before_char'
        || normalized === 'beforechar'
        || normalized === 'before_characters';
}

export function isWorldInfoAfterPosition(position) {
    const normalized = String(position ?? '').toLowerCase();
    return normalized === '1'
        || normalized === 'after'
        || normalized === 'after_char'
        || normalized === 'afterchar'
        || normalized === 'after_characters';
}

// ==================== World book formatting ====================

export function worldBookEntryPromptText(entry = {}, compactReference = false) {
    if (!compactReference) return entry.content || '';
    const name = entry.comment || entry.name || entry.key?.[0] || `世界书条目 ${entry.uid ?? ''}`.trim();
    // Native track: use user-written or AI-generated summary. No auto-truncation.
    const summary = entry.summary || getWorldBookEntrySummary(entry);
    return summary ? `[worldbook:${entry.uid ?? safeReferenceName(name)}] ${name}: ${summary}` : '';
}

export function getWorldBookFolder(entry = {}) {
    return String(entry.folder || entry._folder || entry._source || entry.group || '').trim();
}

export function setWorldBookFolder(entry = {}, folder = '') {
    const value = String(folder || '').trim();
    entry.folder = value;
    entry._folder = value;
    if (entry._source || value) entry._source = value;
    return entry;
}

// ==================== Character formatting ====================

export function characterPromptDescription(character = {}, compactReference = false) {
    if (compactReference) return compactCharacterReference(character);
    return character.data?.description || character.description || '';
}

export function compactCharacterReference(character = {}) {
    const data = character.data || character;
    const name = data.name || character.name || '未命名角色';
    // Native track: use user-written or AI-generated summary. No auto-truncation.
    const summary = data.summary || normalizeCompactSummary(getCharacterSummary(character), name);
    return summary ? `[character:${safeReferenceName(name)}] ${name}: ${summary}` : '';
}

// ==================== Text utilities ====================

export function normalizeCompactSummary(summary = '', name = '') {
    const text = String(summary || '').trim();
    if (!text) return '';
    const bareName = String(name || '').trim();
    if (text === bareName || text === `Name: ${bareName}` || text === `姓名：${bareName}`) return '';
    return text
        .replace(new RegExp(`^Name:\\s*${escapeRegExp(bareName)}\\s*Description:\\s*`, 'i'), '')
        .replace(new RegExp(`^姓名：\\s*${escapeRegExp(bareName)}\\s*描述：\\s*`, 'i'), '')
        .trim();
}

export function trimPlainText(text = '', maxChars = 240) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, maxChars)}...`;
}

export function cleanSceneText(text = '') {
    return String(text || '')
        .split(/\r?\n/)
        .filter(line => !isImportedNoiseLine(line))
        .join('\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
}

export function isImportedNoiseLine(line = '') {
    const text = String(line || '').trim();
    if (!text) return false;
    if (/^={6,}$/.test(text) || /^-{6,}$/.test(text)) return true;
    return /知轩藏书|更多精校小说|zxcs8\.com|www\.zxcs8\.com|下载[:：]?http|精校小说尽在/i.test(text);
}

// ==================== Token estimation & budget ====================

export function estimateTextTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[㐀-鿿]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 3.5);
}

export function trimToTokenBudget(text, budget) {
    if (!text) return '';
    const tokens = estimateTextTokens(text);
    if (tokens <= budget) return text;
    const keepChars = Math.max(500, Math.floor(text.length * (budget / tokens) * 0.9));
    return `[前文因预算裁剪]\n${text.slice(-keepChars)}`;
}

export function layerDebug(name, content, budget, memories = []) {
    return {
        name, content, budget,
        tokens: estimateTextTokens(content),
        chars: (content || '').length,
        included: Boolean(content?.trim()),
        memoryCount: memories.length,
        selected: memories.slice(0, 20).map(m => ({
            id: m.id, type: m.type, label: m.label, weight: m.weight,
            tokens: m.estimatedTokens, source: m.source,
        })),
    };
}

// ==================== String helpers ====================

export function normalizeTitle(value = '') {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
}

export function safeReferenceName(value = '') {
    return String(value || 'ref').replace(/[\s:;；,[\]]+/g, '_').slice(0, 48) || 'ref';
}

export function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// ==================== Prompt formatting ====================

export function formatMemoryItems(items = []) {
    return items
        .filter(item => item.content || item.label)
        .map(item => `- ${item.label || item.id}: ${item.content || ''}`)
        .join('\n');
}

export function formatChapterSummaryLine(summary = {}) {
    const title = summary.title || summary.chapterTitle || summary.name || '';
    const content = summary.summary || summary.content || '';
    if (!title && !content) return '';
    return `- ${title}${content ? `：${content}` : ''}`;
}
