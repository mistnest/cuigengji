/**
 * Novel AI Editor — World Book Engine
 * 世界书条目管理和上下文注入引擎
 *
 * 核心逻辑借鉴 SillyTavern public/scripts/world-info.js，
 * 但简化为纯服务端 Node.js 实现
 */

// ==================== Types ====================

/**
 * @typedef {object} WorldBookEntry
 * @property {number} uid
 * @property {string[]} key - 主关键词
 * @property {string[]} keysecondary - 次级关键词
 * @property {string} content - 注入内容
 * @property {boolean} constant - 始终激活
 * @property {boolean} selective - 选择性激活
 * @property {number} order - 排序权重
 * @property {number} position - 注入位置 (0=before, 1=after, 2=depth)
 * @property {boolean} disable
 * @property {string} group
 * @property {number} groupWeight
 * @property {number} sticky
 * @property {number} cooldown
 * @property {number} probability
 * @property {number} depth - 扫描深度
 * @property {boolean} caseSensitive
 * @property {boolean} matchWholeWords
 * @property {boolean} useGroupScoring
 * @property {string} comment
 */

/**
 * @typedef {object} WorldBook
 * @property {Object.<string, WorldBookEntry>} entries
 */

// ==================== Engine ====================

export const INSERTION_STRATEGY = {
    EVENLY: 0,
    CHARACTER_FIRST: 1,
    GLOBAL_FIRST: 2,
};

export class WorldBookEngine {
    /**
     * @param {WorldBook} worldBook
     * @param {object} [options]
     */
    constructor(worldBook, options = {}) {
        /** @type {WorldBook} */
        this.worldBook = worldBook || { entries: {} };
        this.options = {
            maxBudget: options.maxBudget || 1500,        // 最大 token 预算
            maxDepth: options.maxDepth || 100,           // 最大扫描深度
            maxRecursionSteps: options.maxRecursionSteps || 5,
            minActivations: options.minActivations || 0,
            insertionStrategy: options.insertionStrategy || INSERTION_STRATEGY.CHARACTER_FIRST,
            caseSensitive: options.caseSensitive || false,
            matchWholeWords: options.matchWholeWords || false,
            useGroupScoring: options.useGroupScoring || false,
        };
    }

    /**
     * 根据当前文本扫描并返回激活的世界书条目
     * @param {string} text - 当前文本（用于关键词匹配）
     * @param {object} [state] - 运行时状态（追踪 sticky/cooldown）
     * @returns {WorldBookEntry[]} 激活的条目列表（已排序）
     */
    scan(text, state = {}) {
        const entries = Object.values(this.worldBook.entries)
            .filter(e => !e.disable);

        const activeEntries = [];
        const activationState = state.activationState || {};

        for (const entry of entries) {
            if (this._isActivated(entry, text, activationState)) {
                activeEntries.push(entry);
                this._updateActivationState(entry, activationState);
            }
        }

        // Sort by insertion strategy
        return this._sortEntries(activeEntries);
    }

    /**
     * 将激活条目注入到 prompt 中
     * @param {WorldBookEntry[]} entries - 激活的条目
     * @param {string} position - 注入位置 'before' | 'after' | 'system'
     * @returns {string} 格式化的注入文本
     */
    inject(entries, position = 'system') {
        if (!entries.length) return '';

        const grouped = this._groupByPosition(entries);

        switch (position) {
            case 'before':
                return this._formatEntries(grouped.beforeChar || []);
            case 'after':
                return this._formatEntries(grouped.afterChar || []);
            case 'system':
            default:
                return this._formatEntries(entries);
        }
    }

    /**
     * 估算条目的 token 数（粗略估算：中文字符 ≈ 0.5 token/字，英文 ≈ 0.25 token/字）
     * @param {WorldBookEntry[]} entries
     * @returns {number}
     */
    estimateTokens(entries) {
        let total = 0;
        for (const entry of entries) {
            const chineseChars = (entry.content.match(/[一-鿿]/g) || []).length;
            const otherChars = entry.content.replace(/[一-鿿]/g, '').length;
            total += Math.ceil(chineseChars * 0.5 + otherChars * 0.25);
            // Add keyword overhead
            if (entry.key) total += entry.key.join('').length * 0.5;
        }
        return total;
    }

    /**
     * 根据 budget 裁剪条目
     * @param {WorldBookEntry[]} entries
     * @param {number} budgetTokens
     * @returns {WorldBookEntry[]}
     */
    trimToBudget(entries, budgetTokens) {
        const result = [];
        let used = 0;

        for (const entry of entries) {
            const tokens = this.estimateTokens([entry]);
            if (used + tokens <= budgetTokens) {
                result.push(entry);
                used += tokens;
            }
        }

        return result;
    }

    // ==================== Private ====================

    _isActivated(entry, text, state) {
        // Constant entries always activate
        if (entry.constant) return true;

        // Check sticky counter
        const stickyKey = `sticky_${entry.uid}`;
        if (state[stickyKey] > 0) return true;

        // Check cooldown
        const cooldownKey = `cooldown_${entry.uid}`;
        if (state[cooldownKey] > 0) return false;

        // Check probability
        if (entry.probability < 100) {
            if (Math.random() * 100 > entry.probability) return false;
        }

        // Selective activation by keywords
        if (entry.selective && entry.key?.length > 0) {
            return this._matchKeywords(entry.key, text, {
                caseSensitive: entry.caseSensitive ?? this.options.caseSensitive,
                matchWholeWords: entry.matchWholeWords ?? this.options.matchWholeWords,
            });
        }

        // Secondary keywords
        if (entry.keysecondary?.length > 0) {
            return this._matchKeywords(entry.keysecondary, text, {
                caseSensitive: entry.caseSensitive ?? this.options.caseSensitive,
                matchWholeWords: entry.matchWholeWords ?? this.options.matchWholeWords,
            });
        }

        return false;
    }

    _matchKeywords(keywords, text, options) {
        const flags = options.caseSensitive ? 'g' : 'gi';

        for (const kw of keywords) {
            if (!kw.trim()) continue;

            const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            let pattern = escaped;

            if (options.matchWholeWords) {
                pattern = `\\b${escaped}\\b`;
            }

            try {
                if (new RegExp(pattern, flags).test(text)) return true;
            } catch {
                // Fallback to simple includes
                const compare = options.caseSensitive ? text : text.toLowerCase();
                const compareKw = options.caseSensitive ? kw : kw.toLowerCase();
                if (compare.includes(compareKw)) return true;
            }
        }

        return false;
    }

    _updateActivationState(entry, state) {
        // Update sticky
        if (entry.sticky > 0) {
            state[`sticky_${entry.uid}`] = entry.sticky;
        }
        // Update cooldown
        if (entry.cooldown > 0) {
            state[`cooldown_${entry.uid}`] = entry.cooldown;
        }
    }

    _sortEntries(entries) {
        switch (this.options.insertionStrategy) {
            case INSERTION_STRATEGY.CHARACTER_FIRST:
                // Sort by position, then by order
                return entries.sort((a, b) => {
                    if (a.position !== b.position) return (a.position || 0) - (b.position || 0);
                    return (b.order || 100) - (a.order || 100);
                });
            case INSERTION_STRATEGY.GLOBAL_FIRST:
                return entries.sort((a, b) => (b.order || 100) - (a.order || 100));
            case INSERTION_STRATEGY.EVENLY:
            default:
                return entries.sort((a, b) => (a.order || 100) - (b.order || 100));
        }
    }

    _groupByPosition(entries) {
        const groups = {
            beforeChar: [],
            afterChar: [],
            depth: [],
            dAnnotation: [],
        };

        for (const entry of entries) {
            switch (entry.position) {
                case 0: groups.beforeChar.push(entry); break;
                case 1: groups.afterChar.push(entry); break;
                case 2: groups.depth.push(entry); break;
                case 3: groups.dAnnotation.push(entry); break;
                default: groups.beforeChar.push(entry);
            }
        }

        return groups;
    }

    _formatEntries(entries) {
        if (!entries.length) return '';

        return entries.map((e, i) => {
            const label = e.comment || e.key?.[0] || `设定${i + 1}`;
            return `【${label}】${e.content}`;
        }).join('\n');
    }

    // ==================== Static Utilities ====================

    /**
     * 从 ST 格式的 JSON 文件加载世界书
     * @param {string} filePath
     * @returns {WorldBook}
     */
    static loadFromFile(filePath) {
        const fs = require('node:fs');
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            entries: data.entries || {},
        };
    }

    /**
     * 验证世界书条目格式
     * @param {object} entry
     * @returns {{valid: boolean, errors: string[]}}
     */
    static validateEntry(entry) {
        const errors = [];
        if (!entry.uid && entry.uid !== 0) errors.push('缺少 uid');
        if (!entry.content?.trim()) errors.push('content 不能为空');
        if (!entry.key?.length && !entry.constant) errors.push('非 constant 条目需要至少一个 key');
        return { valid: errors.length === 0, errors };
    }

    /**
     * 创建空条目模板
     * @param {number} uid
     * @returns {WorldBookEntry}
     */
    static createEntry(uid) {
        return {
            uid,
            key: [],
            keysecondary: [],
            content: '',
            constant: false,
            selective: true,
            order: 100,
            position: 0,
            disable: false,
            group: '',
            groupWeight: 100,
            sticky: 0,
            cooldown: 0,
            probability: 100,
            depth: 4,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            comment: '',
            role: null,
            scanDepth: null,
            automationId: '',
        };
    }
}
