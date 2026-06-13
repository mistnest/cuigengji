/**
 * Novel AI Editor — Memory Manager
 *
 * 记忆系统的检索 & 注入引擎，服务 context-orchestrator 的 7 层架构：
 *
 *   Layer               →  说明
 *   ────────────────────────────────────────────────
 *   1. platform         →  平台规则 (任务描述/语言/书名)
 *   2. author           →  作者偏好 (L1 AuthorProfile + 记忆文件)
 *   3. worldSetting     →  世界设定 (世界书条目匹配 + 全局设定注入)
 *   4. characterState   →  人物状态 (角色卡 + 出场检测 + 状态推断)
 *   5. plotHistory      →  前情资料 (NovelMemory + 大纲 + 章节摘要)
 *   6. recentPlot       →  近期情节 (当前正文 + 章节标题)
 *   7. userMessage      →  用户输入 (聊天框消息 / 续写请求)
 *
 * 本模块负责 L3+L4+L5 子管线：
 *   L3 Auto-extract  →  从 AI 输出文本中提取新角色/世界观/摘要
 *   L4 Smart Retrieval →  关键词匹配 + 角色名检测 + 二级关键词逻辑
 *   L5 Context Inject  →  按 position 分组组装 Prompt + Token 预算裁剪
 *
 * 入口：context-orchestrator.buildWritingContext() 调用 createMemoryManager()
 *      → retrieve() 检索激活的记忆 → formatForPrompt() 注入 Prompt
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
        this.memoryBudgetPct = options.memoryBudgetPct || 15; // Percentage of model context
        this.modelContextSize = options.modelContextSize || 128000; // Will be updated from backend
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
        const fullText = text || '';
        const scanDepth = Number(options.maxScanDepth) || 0;
        const scanText = scanDepth > 0 ? fullText.slice(-scanDepth) : fullText;
        const memories = [];

        // 1. World book entries — keyword matching (核心)
        memories.push(...this._retrieveWorldEntries(fullText));

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

        // Group world entries by position, other types by their own groups
        const positionGroups = { 0: [], 1: [], 2: [], 3: [] };
        const otherGroups = {};

        for (const m of memories) {
            if (m.type === MEMORY_TYPE.WORLD_ENTRY) {
                const pos = m.source?.position ?? m._position ?? 0;
                positionGroups[pos] = positionGroups[pos] || [];
                positionGroups[pos].push(m);
            } else {
                if (!otherGroups[m.type]) otherGroups[m.type] = [];
                otherGroups[m.type].push(m);
            }
        }

        const sections = [];

        // Layer 0: 全局设定 (position=0 + constant entries)
        if (positionGroups[0]?.length) {
            sections.push('【全局设定】');
            positionGroups[0].forEach(m => {
                sections.push(`◇ ${m.label}：${m.content}`);
            });
        }

        // Characters
        if (otherGroups[MEMORY_TYPE.CHARACTER]?.length) {
            sections.push('\n【出场角色】');
            otherGroups[MEMORY_TYPE.CHARACTER].forEach(m => {
                sections.push(`◇ ${m.label}`);
                if (m.content) sections.push(`  ${m.content}`);
            });
        }

        // Layer 1: 物品/角色相关设定 (position=1)
        if (positionGroups[1]?.length) {
            sections.push('\n【相关设定】');
            positionGroups[1].forEach(m => {
                sections.push(`◇ ${m.label}：${m.content}`);
            });
        }

        // Layer 2: 当前场景设定 (position=2)
        if (positionGroups[2]?.length) {
            sections.push('\n【当前场景】');
            positionGroups[2].forEach(m => {
                sections.push(`◇ ${m.label}：${m.content}`);
            });
        }

        // Layer 3: 指定深度 (position=3)
        if (positionGroups[3]?.length) {
            sections.push('\n【深度设定】');
            positionGroups[3].forEach(m => {
                sections.push(`◇ ${m.label}：${m.content}`);
            });
        }

        // Outline
        if (otherGroups[MEMORY_TYPE.OUTLINE]?.length) {
            sections.push('\n【大纲要求】');
            otherGroups[MEMORY_TYPE.OUTLINE].forEach(m => {
                sections.push(`◇ ${m.label}`);
            });
        }

        // Chapter summaries
        if (otherGroups[MEMORY_TYPE.CHAPTER_SUMMARY]?.length) {
            sections.push('\n【前情提要】');
            otherGroups[MEMORY_TYPE.CHAPTER_SUMMARY].forEach(m => {
                sections.push(`◇ ${m.label}：${m.content}`);
            });
        }

        // Style guide + writing rules
        if (otherGroups[MEMORY_TYPE.STYLE_GUIDE]?.length) {
            sections.push('\n【文风要求】');
            sections.push(otherGroups[MEMORY_TYPE.STYLE_GUIDE][0].content);
        }
        if (otherGroups[MEMORY_TYPE.WRITING_RULE]?.length) {
            sections.push('\n【写作规范】');
            otherGroups[MEMORY_TYPE.WRITING_RULE].forEach((m, i) => {
                sections.push(`${i + 1}. ${m.content}`);
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

            // Selective by keyword — each entry scans its own depth
            if (entry.selective && entry.key?.length > 0) {
                // Per-entry scan depth (in characters): depth=0 means full text
                // Per-entry scan depth in characters: 0 = full text, otherwise scan last N chars
                const entryDepth = entry.scanDepth ?? entry.depth ?? 1000;
                const scanRange = entryDepth > 0 ? text.slice(-entryDepth) : text;

                // Step 1: Primary keyword match
                const primaryMatched = entry.key.some(kw => {
                    if (typeof kw !== 'string' || !kw.trim()) return false;
                    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    let pattern = escaped;
                    if (entry.matchWholeWords) pattern = `(?<![\\p{Script=Han}a-zA-Z0-9])${escaped}(?![\\p{Script=Han}a-zA-Z0-9])`;
                    try {
                        return new RegExp(pattern, entry.caseSensitive ? 'gu' : 'giu').test(scanRange);
                    } catch {
                        const source = entry.caseSensitive ? scanRange : scanRange.toLowerCase();
                        return source.includes(entry.caseSensitive ? kw : kw.toLowerCase());
                    }
                });

                if (!primaryMatched) continue;

                // Step 2: Secondary keyword logic
                const hasSecondary = Array.isArray(entry.keysecondary) && entry.keysecondary.length > 0;
                if (hasSecondary) {
                    const logic = entry.selectiveLogic ?? 0; // default AND_ANY
                    let hasAny = false, hasAll = true;
                    for (const skw of entry.keysecondary) {
                        if (typeof skw !== 'string' || !skw.trim()) continue;
                        const sMatched = this._matchSingleKW(skw, text, entry);
                        if (sMatched) hasAny = true; else hasAll = false;
                        if (logic === 0 && sMatched) break;        // AND_ANY: short-circuit
                        if (logic === 1 && !sMatched) break;       // NOT_ALL: short-circuit
                    }
                    const secondaryPassed =
                        logic === 0 ? hasAny :                    // AND_ANY
                        logic === 1 ? !hasAll :                   // NOT_ALL
                        logic === 2 ? !hasAny :                   // NOT_ANY
                        logic === 3 ? hasAll : hasAny;            // AND_ALL
                    if (!secondaryPassed) continue;
                }

                // Step 3: Probability check
                const probability = entry.probability ?? 100;
                if (probability < 100 && Math.random() * 100 > probability) continue;

                active.push(this._entryToMemory(entry, 80));
            }
        }

        return active;
    }

    _matchSingleKW(kw, text, entry) {
        try {
            const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Chinese-aware whole-word: use Unicode-aware boundaries instead of \b
            const pattern = entry.matchWholeWords
                ? `(?<![\\p{Script=Han}a-zA-Z0-9])${escaped}(?![\\p{Script=Han}a-zA-Z0-9])`
                : escaped;
            return new RegExp(pattern, entry.caseSensitive ? 'gu' : 'giu').test(text);
        } catch {
            // Fallback without Unicode property escapes
            const src = entry.caseSensitive ? text : text.toLowerCase();
            const kw2 = entry.caseSensitive ? kw : kw.toLowerCase();
            if (!entry.matchWholeWords) return src.includes(kw2);
            // Manual whole-word: check surrounding characters
            let idx = 0;
            while ((idx = src.indexOf(kw2, idx)) !== -1) {
                const before = idx > 0 ? src[idx - 1] : ' ';
                const after = idx + kw2.length < src.length ? src[idx + kw2.length] : ' ';
                const isWordChar = c => /[一-鿿a-zA-Z0-9]/.test(c);
                if (!isWordChar(before) && !isWordChar(after)) return true;
                idx += kw2.length;
            }
            return false;
        }
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
            _position: entry.position ?? 0,
            source: { type: 'world_book', uid: entry.uid, position: entry.position ?? 0 },
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
        const budget = Math.round(this.modelContextSize * this.memoryBudgetPct / 100);
        const result = [];
        let used = 0;

        for (const m of memories) {
            const tokens = m.estimatedTokens || 0;
            if (used + tokens <= budget) {
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

        const budget = Math.round(this.modelContextSize * this.memoryBudgetPct / 100);
        return {
            totalEntries: activeMemories.length,
            totalTokens,
            budget,
            budgetPct: this.memoryBudgetPct,
            modelContext: this.modelContextSize,
            usagePercent: Math.round((totalTokens / budget) * 100),
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
export function createMemoryManager(editorState = {}, options = {}) {
    return new MemoryManager({
        worldBook: editorState.worldBook || { entries: {} },
        characters: editorState.characters || [],
        outline: editorState.outline || [],
        styleGuide: editorState.styleGuide || editorState.currentNovel?.styleGuide || '',
        writingRules: getActiveWritingRules(editorState),
        chapterSummaries: editorState.chapterSummaries || [],
        memoryBudgetPct: options.memoryBudgetPct || editorState.memoryBudgetPct || 15,
        modelContextSize: options.modelContextSize || 128000,
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
