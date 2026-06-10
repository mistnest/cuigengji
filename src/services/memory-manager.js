/**
 * Novel AI Editor — Memory Manager
 *
 * 参考 Claude Code 的 5 层记忆架构，映射到小说创作：
 *
 *   CC Layer         →  Novel Editor
 *   ─────────────────────────────────
 *   L1 CLAUDE.md     →  novel.json (项目设定)
 *   L2 File Storage  →  data/ 目录 (世界书/角色卡/章节)
 *   L3 Auto-extract  →  从正文自动提取新角色/世界观/摘要
 *   L4 Smart Retrieval→  关键词匹配 + 角色名检测 + 语义关联
 *   L5 Context Inject →  Prompt 组装注入
 */

import { estimateTokens } from './context-manager.js';

// ==================== Memory Types ====================

export const MEMORY_TYPE = {
    WORLD_ENTRY: 'world_entry',       // 世界书条目
    CHARACTER: 'character',           // 角色信息
    OUTLINE: 'outline',               // 大纲节点
    CHAPTER_SUMMARY: 'chapter_summary', // 前文章节摘要
    STYLE_GUIDE: 'style_guide',       // 文风指南
    WRITING_RULE: 'writing_rule',     // 写作规则 (来自 Prompt 模板)
    EXTRACTED_NOTE: 'extracted_note', // AI 自动提取的笔记
};

// ==================== Memory Item ====================

/**
 * @typedef {object} MemoryItem
 * @property {string} id
 * @property {string} type - from MEMORY_TYPE
 * @property {string} label - display name
 * @property {string} content - text to inject
 * @property {number} weight - importance weight (higher = more important)
 * @property {string[]} triggers - keywords that activate this memory
 * @property {number} estimatedTokens
 * @property {object} source - original source reference
 */

// ==================== Memory Manager ====================

export class MemoryManager {
    /**
     * @param {object} options
     * @param {object} options.worldBook - {entries: {...}}
     * @param {object[]} options.characters - character card list
     * @param {object[]} options.outline - outline nodes
     * @param {string} options.styleGuide - 文风指南
     * @param {string[]} options.writingRules - 写作规则
     * @param {object[]} options.chapterSummaries - 前文章节摘要 [{title, summary}]
     * @param {object[]} options.customMemories - 用户自定义记忆笔记
     * @param {number} options.maxTokens - 记忆总 token 预算
     */
    constructor(options = {}) {
        this.worldBook = options.worldBook || { entries: {} };
        this.characters = options.characters || [];
        this.outline = options.outline || [];
        this.styleGuide = options.styleGuide || '';
        this.writingRules = options.writingRules || [];
        this.chapterSummaries = options.chapterSummaries || [];
        this.customMemories = options.customMemories || [];
        this.maxTokens = options.maxTokens || 3000; // Memory budget
        this.caseSensitive = options.caseSensitive || false;
    }

    // ==================== Layer 4: Smart Retrieval ====================

    /**
     * 扫描文本，返回所有激活的记忆条目
     * 这是核心检索方法 — 每次 AI 调用前都会调用
     *
     * @param {string} text - 当前正文 (用于关键词匹配)
     * @param {object} [options]
     * @param {number} [options.maxScanDepth] - 扫描最近多少字符
     * @returns {MemoryItem[]} 激活的记忆，按权重降序排列
     */
    retrieve(text, options = {}) {
        const scanText = text ? text.slice(-(options.maxScanDepth || 4000)) : '';
        const memories = [];

        // 1. World book entries — keyword matching (核心)
        memories.push(...this._retrieveWorldEntries(scanText));

        // 2. Characters — name matching
        memories.push(...this._retrieveCharacters(scanText));

        // 3. Outline — always include incomplete nodes
        memories.push(...this._retrieveOutline());

        // 4. Chapter summaries — recent context
        memories.push(...this._retrieveChapterSummaries());

        // 5. Style guide — always include
        if (this.styleGuide) {
            memories.push({
                id: 'style_guide',
                type: MEMORY_TYPE.STYLE_GUIDE,
                label: '文风指南',
                content: this.styleGuide,
                weight: 100,
                triggers: [],
                estimatedTokens: estimateTokens(this.styleGuide),
                source: { type: 'config' },
            });
        }

        // 6. Writing rules
        this.writingRules.forEach((rule, i) => {
            memories.push({
                id: `rule_${i}`,
                type: MEMORY_TYPE.WRITING_RULE,
                label: `写作规则 ${i + 1}`,
                content: rule,
                weight: 90,
                triggers: [],
                estimatedTokens: estimateTokens(rule),
                source: { type: 'config' },
            });
        });

        // 7. Custom extracted memories
        memories.push(...this.customMemories);

        // Sort by weight descending, then trim to budget
        memories.sort((a, b) => b.weight - a.weight);

        // Apply token budget
        return this._trimToBudget(memories);
    }

    /**
     * 将记忆注入为 prompt 文本
     * @param {MemoryItem[]} memories
     * @returns {string} 格式化的 prompt 注入文本
     */
    formatForPrompt(memories) {
        if (!memories.length) return '';

        const groups = {};
        for (const m of memories) {
            if (!groups[m.type]) groups[m.type] = [];
            groups[m.type].push(m);
        }

        const sections = [];

        // World entries first
        if (groups[MEMORY_TYPE.WORLD_ENTRY]?.length) {
            sections.push('【世界观设定】');
            groups[MEMORY_TYPE.WORLD_ENTRY].forEach(m => {
                sections.push(`◇ ${m.label}：${m.content}`);
            });
        }

        // Characters
        if (groups[MEMORY_TYPE.CHARACTER]?.length) {
            sections.push('\n【出场角色】');
            groups[MEMORY_TYPE.CHARACTER].forEach(m => {
                sections.push(`◇ ${m.label}`);
                if (m.content) sections.push(`  ${m.content}`);
            });
        }

        // Outline
        if (groups[MEMORY_TYPE.OUTLINE]?.length) {
            sections.push('\n【大纲要求】');
            groups[MEMORY_TYPE.OUTLINE].forEach(m => {
                sections.push(`◇ ${m.label}`);
            });
        }

        // Chapter summaries
        if (groups[MEMORY_TYPE.CHAPTER_SUMMARY]?.length) {
            sections.push('\n【前情提要】');
            groups[MEMORY_TYPE.CHAPTER_SUMMARY].forEach(m => {
                sections.push(`◇ ${m.label}：${m.content}`);
            });
        }

        // Style guide
        if (groups[MEMORY_TYPE.STYLE_GUIDE]?.length) {
            sections.push('\n【文风要求】');
            sections.push(groups[MEMORY_TYPE.STYLE_GUIDE][0].content);
        }

        // Writing rules
        if (groups[MEMORY_TYPE.WRITING_RULE]?.length) {
            sections.push('\n【写作规范】');
            groups[MEMORY_TYPE.WRITING_RULE].forEach((m, i) => {
                sections.push(`${i + 1}. ${m.content}`);
            });
        }

        // Custom extracted
        if (groups[MEMORY_TYPE.EXTRACTED_NOTE]?.length) {
            sections.push('\n【创作笔记】');
            groups[MEMORY_TYPE.EXTRACTED_NOTE].forEach(m => {
                sections.push(`- ${m.label}：${m.content}`);
            });
        }

        return sections.join('\n');
    }

    // ==================== Layer 3: Auto-extraction ====================

    /**
     * 从 AI 生成的内容中自动提取新记忆
     * 这个在每次 AI 生成后调用
     *
     * @param {string} generatedText - AI 刚生成的文本
     * @param {string} context - 上下文
     * @returns {object} { newCharacters, newWorldEntries, summary }
     */
    autoExtract(generatedText, context) {
        const extracted = {
            newCharacters: [],
            newWorldEntries: [],
            summary: '',
            suggestions: [],
        };

        // Detect new character names (Chinese name patterns: 2-4 chars with surname)
        const namePattern = /([一-鿿]{1,2}(?:[一-鿿]{1,2}))/g;
        const existingNames = this.characters.map(c =>
            c.data?.name || c.name || ''
        ).filter(Boolean);

        const foundNames = new Set();
        let match;
        while ((match = namePattern.exec(generatedText)) !== null) {
            const name = match[1];
            // Filter: not in existing, looks like a name (no common verbs)
            if (!existingNames.includes(name) &&
                !this._isCommonWord(name) &&
                name.length >= 2 && name.length <= 4) {
                foundNames.add(name);
            }
        }

        // Generate extraction suggestions
        if (foundNames.size > 0) {
            extracted.suggestions.push({
                type: 'new_characters',
                names: Array.from(foundNames).slice(0, 5),
                message: `检测到新角色名: ${Array.from(foundNames).slice(0, 5).join('、')}`,
            });
        }

        // Detect new world elements (places, items, concepts)
        const worldPatterns = [
            /([一-鿿]{2,4}(?:山|城|国|殿|门|剑|刀|枪|丹|术|功|法|阵|族|派|门|谷|海|林|峰|塔|府|宫|界|域|道|诀))/g,
        ];

        worldPatterns.forEach(pattern => {
            while ((match = pattern.exec(generatedText)) !== null) {
                const element = match[1];
                const existingKeys = Object.values(this.worldBook.entries)
                    .flatMap(e => e.key || []);
                if (!existingKeys.includes(element) && element.length >= 2) {
                    extracted.suggestions.push({
                        type: 'new_world_element',
                        element,
                        message: `检测到新世界观元素: ${element}`,
                    });
                }
            }
        });

        return extracted;
    }

    /**
     * AI 生成章节摘要（需要外部 AI 调用，这里只返回 prompt）
     * @param {string} chapterContent
     * @returns {string} prompt for AI
     */
    buildSummaryExtractionPrompt(chapterContent) {
        return `请为以下章节生成简洁摘要（200字内），包含：主要情节进展、关键角色行为、重要伏笔。

${chapterContent.slice(-3000)}

只输出摘要：`;
    }

    // ==================== Private Retrieval Methods ====================

    _retrieveWorldEntries(text) {
        const entries = Object.values(this.worldBook.entries)
            .filter(e => !e.disable);

        const active = [];

        for (const entry of entries) {
            // Constant entries always active
            if (entry.constant) {
                active.push(this._entryToMemory(entry, 50));
                continue;
            }

            // Selective by keyword
            if (entry.selective && entry.key?.length > 0) {
                const matched = entry.key.some(kw => {
                    if (!kw.trim()) return false;
                    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    try {
                        const flags = entry.caseSensitive ? 'g' : 'gi';
                        return new RegExp(escaped, flags).test(text);
                    } catch {
                        const source = entry.caseSensitive ? text : text.toLowerCase();
                        return source.includes(entry.caseSensitive ? kw : kw.toLowerCase());
                    }
                });

                if (matched) {
                    active.push(this._entryToMemory(entry, 80));
                }
            }
        }

        return active;
    }

    _entryToMemory(entry, baseWeight) {
        return {
            id: `wb_${entry.uid}`,
            type: MEMORY_TYPE.WORLD_ENTRY,
            label: entry.comment || entry.key?.[0] || `条目${entry.uid}`,
            content: entry.content || '',
            weight: baseWeight + (entry.order || 100) / 10,
            triggers: entry.key || [],
            estimatedTokens: estimateTokens(entry.content || ''),
            source: { type: 'world_book', uid: entry.uid },
        };
    }

    _retrieveCharacters(text) {
        const active = [];

        for (const ch of this.characters) {
            const name = ch.data?.name || ch.name || '';
            if (!name) continue;

            // Check if character name appears in text
            if (text && text.includes(name)) {
                const desc = ch.data?.description || ch.description || '';
                const personality = ch.data?.personality || ch.personality || '';
                const scenario = ch.data?.scenario || ch.scenario || '';

                const parts = [];
                if (desc) parts.push(`描述：${desc}`);
                if (personality) parts.push(`性格：${personality}`);
                if (scenario) parts.push(`背景：${scenario}`);

                // Also inject character's embedded world book
                const charBook = ch.data?.character_book;
                if (charBook?.entries) {
                    const bookEntries = Object.values(charBook.entries)
                        .filter(e => !e.disable);
                    if (bookEntries.length > 0) {
                        parts.push(`相关设定：${bookEntries.map(e => e.content).join('；')}`);
                    }
                }

                active.push({
                    id: `char_${name}`,
                    type: MEMORY_TYPE.CHARACTER,
                    label: name,
                    content: parts.join('\n'),
                    weight: 85 + Math.min(text.match(new RegExp(name, 'g'))?.length || 0, 5) * 2,
                    triggers: [name],
                    estimatedTokens: estimateTokens(parts.join('\n')),
                    source: { type: 'character', name },
                });
            }
        }

        return active;
    }

    _retrieveOutline() {
        // Return incomplete outline nodes
        return this.outline
            .filter(n => !n.completed)
            .map(n => ({
                id: `outline_${n.id}`,
                type: MEMORY_TYPE.OUTLINE,
                label: n.title + (n.description ? ` — ${n.description}` : ''),
                content: n.description || '',
                weight: 70,
                triggers: [],
                estimatedTokens: estimateTokens(n.title + (n.description || '')),
                source: { type: 'outline', id: n.id },
            }))
            .slice(0, 10);
    }

    _retrieveChapterSummaries() {
        // Return last 3 chapter summaries for context
        return this.chapterSummaries.slice(-3).map((s, i) => ({
            id: `summary_${i}`,
            type: MEMORY_TYPE.CHAPTER_SUMMARY,
            label: s.title || `第${i + 1}章`,
            content: s.summary || s.content || '',
            weight: 60 - i * 10, // Less weight for older
            triggers: [],
            estimatedTokens: estimateTokens(s.summary || s.content || ''),
            source: { type: 'chapter_summary', index: i },
        }));
    }

    // ==================== Budget Management ====================

    _trimToBudget(memories) {
        const result = [];
        let used = 0;

        for (const m of memories) {
            const tokens = m.estimatedTokens || 0;
            if (used + tokens <= this.maxTokens) {
                result.push(m);
                used += tokens;
            }
        }

        return result;
    }

    // ==================== Stats ====================

    /**
     * 返回记忆使用统计
     */
    getStats(activeMemories) {
        const totalTokens = activeMemories.reduce((sum, m) => sum + (m.estimatedTokens || 0), 0);
        const byType = {};
        for (const m of activeMemories) {
            byType[m.type] = (byType[m.type] || 0) + 1;
        }

        return {
            totalEntries: activeMemories.length,
            totalTokens,
            budget: this.maxTokens,
            usagePercent: Math.round((totalTokens / this.maxTokens) * 100),
            byType,
        };
    }

    // ==================== Utils ====================

    _isCommonWord(word) {
        const commonWords = [
            '就是', '可以', '不是', '什么', '怎么', '一个', '这个', '那个',
            '我们', '他们', '自己', '已经', '没有', '还是', '不过', '但是',
            '因为', '所以', '如果', '虽然', '然而', '于是', '然后', '接着',
            '说道', '看着', '听到', '觉得', '知道', '起来', '下来', '过来',
        ];
        return commonWords.includes(word);
    }

    /**
     * 添加自定义记忆笔记（用户手动或 AI 自动提取）
     */
    addCustomMemory(label, content, triggers = []) {
        const item = {
            id: `custom_${Date.now()}`,
            type: MEMORY_TYPE.EXTRACTED_NOTE,
            label,
            content,
            weight: 40,
            triggers,
            estimatedTokens: estimateTokens(content),
            source: { type: 'custom' },
        };
        this.customMemories.push(item);
        return item;
    }

    /**
     * 清除自动提取的记忆
     */
    clearExtracted() {
        this.customMemories = [];
    }
}

// ==================== Factory ====================

/**
 * 从编辑器 state 构建 MemoryManager
 * @param {object} editorState
 * @returns {MemoryManager}
 */
export function createMemoryManager(editorState = {}) {
    return new MemoryManager({
        worldBook: editorState.worldBook || { entries: {} },
        characters: editorState.characters || [],
        outline: editorState.outline || [],
        styleGuide: editorState.styleGuide || editorState.currentNovel?.styleGuide || '',
        writingRules: getActiveWritingRules(editorState),
        chapterSummaries: editorState.chapterSummaries || [],
    });
}

function getActiveWritingRules(editorState) {
    const rules = [];
    // Extract from enabled prompt templates
    if (editorState.promptTemplates && editorState.enabledTemplates) {
        for (const t of editorState.promptTemplates) {
            if (t.content?.trim() && t.isSystemPrompt && !t.isMarker &&
                editorState.enabledTemplates[t.identifier] !== false) {
                rules.push(t.content);
            }
        }
    }
    return rules;
}
