/**
 * Novel AI Editor — Context Manager
 * 上下文窗口管理、Token 计数、内容裁剪
 */

// Approximate token counting (server-side estimation)
// For accurate counts, use the tokenizer endpoints

/**
 * @typedef {object} ContextBudget
 * @property {number} total - 模型总 token 限制
 * @property {number} reserved - 预留给输出的 token
 * @property {number} system - system prompt 已用
 * @property {number} user - user messages 已用
 * @property {number} worldBook - 世界书条目已用
 * @property {number} characters - 角色信息已用
 */

/**
 * 模型上下文窗口配置
 */
export const MODEL_CONTEXTS = {
    'claude-sonnet-4-6': { total: 200000, output: 32768 },
    'claude-sonnet-4-5': { total: 200000, output: 32768 },
    'claude-opus-4-8': { total: 200000, output: 32768 },
    'claude-opus-4-6': { total: 200000, output: 32768 },
    'claude-haiku-4-5': { total: 200000, output: 32768 },
    'claude-3.5-sonnet': { total: 200000, output: 16384 },
    'gpt-4o': { total: 128000, output: 16384 },
    'gpt-4-turbo': { total: 128000, output: 4096 },
    'gpt-5': { total: 128000, output: 16384 },
    'deepseek-v3': { total: 128000, output: 8192 },
    'deepseek-r1': { total: 128000, output: 8192 },
    // Default fallback
    'default': { total: 131072, output: 16384 },
};

/**
 * 获取模型的上下文窗口大小
 * @param {string} model
 * @returns {{total: number, output: number}}
 */
export function getModelContext(model) {
    // Check for partial matches
    for (const [key, value] of Object.entries(MODEL_CONTEXTS)) {
        if (model?.toLowerCase().includes(key.toLowerCase())) {
            return value;
        }
    }
    return MODEL_CONTEXTS['default'];
}

/**
 * 粗略 token 计数（客户端估计，不依赖 tokenizer）
 * 中文：~1.5 chars/token
 * 英文：~3.5 chars/token
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
    if (!text) return 0;

    const chineseChars = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
    const otherChars = text.replace(/[一-鿿㐀-䶿]/g, '').length;

    // Chinese: ~1.5 chars per token, English/other: ~3.5 chars per token
    return Math.ceil(chineseChars / 1.5 + otherChars / 3.5);
}

/**
 * 为小说续写分配 token 预算
 * @param {object} params
 * @param {string} params.model - 模型名
 * @param {string} params.systemPrompt - 系统提示
 * @param {string} params.currentText - 当前正文
 * @param {number} params.worldBookTokens - 世界书条目 token 数
 * @param {number} params.characterTokens - 角色信息 token 数
 * @param {number} params.maxOutputTokens - 最大输出 token
 * @returns {ContextBudget}
 */
export function allocateBudget(params) {
    const { model, systemPrompt, currentText, worldBookTokens, characterTokens, maxOutputTokens } = params;
    const context = getModelContext(model);

    const budget = {
        total: context.total,
        reserved: maxOutputTokens || context.output,
        system: estimateTokens(systemPrompt || ''),
        user: estimateTokens(currentText || ''),
        worldBook: worldBookTokens || 0,
        characters: characterTokens || 0,
    };

    return budget;
}

/**
 * 检查是否超出上下文限制
 * @param {ContextBudget} budget
 * @returns {{exceeded: boolean, overage: number, available: number}}
 */
export function checkBudget(budget) {
    const used = budget.system + budget.user + budget.worldBook + budget.characters + budget.reserved;
    const available = budget.total - used;
    return {
        exceeded: available < 0,
        overage: Math.max(0, -available),
        available: Math.max(0, available),
    };
}

/**
 * 裁剪正文以适应上下文窗口
 * 策略：从开头裁剪，保留最近的内容
 * @param {string} text - 正文
 * @param {number} maxTokens - 最大可用 token
 * @returns {string}
 */
export function trimText(text, maxTokens) {
    if (!text) return '';
    const estimated = estimateTokens(text);
    if (estimated <= maxTokens) return text;

    // Trim from the beginning, keeping the end
    const ratio = maxTokens / estimated;
    const keepChars = Math.floor(text.length * ratio * 0.9); // 10% safety margin

    const trimmed = text.slice(-keepChars);
    // Try to cut at a paragraph/newline boundary
    const firstNewline = trimmed.indexOf('\n\n');
    if (firstNewline > 0 && firstNewline < 200) {
        return '…[前文已省略]…\n\n' + trimmed.slice(firstNewline + 2);
    }

    return '…[前文已省略]…\n\n' + trimmed;
}

/**
 * 为正文生成上下文摘要（裁剪前文 + 标记关键信息）
 * @param {object} params
 * @returns {{trimmedText: string, summary: object}}
 */
export function prepareContext(params) {
    const {
        text,
        model,
        systemPrompt,
        worldBook,
        characters,
        maxOutputTokens = 8192,
    } = params;

    const context = getModelContext(model);
    const sysTokens = estimateTokens(systemPrompt);
    const wbTokens = estimateTokens(JSON.stringify(worldBook || {}));
    const charTokens = estimateTokens(JSON.stringify(characters || []));

    const maxUserTokens = context.total - sysTokens - wbTokens - charTokens - maxOutputTokens - 500; // 500 safety

    const trimmedText = trimText(text, Math.max(0, maxUserTokens));
    const textTokens = estimateTokens(trimmedText);

    return {
        trimmedText,
        summary: {
            totalBudget: context.total,
            used: sysTokens + wbTokens + charTokens + textTokens,
            reserved: maxOutputTokens,
            remaining: context.total - sysTokens - wbTokens - charTokens - textTokens - maxOutputTokens,
            breakdown: {
                systemPrompt: sysTokens,
                worldBook: wbTokens,
                characters: charTokens,
                text: textTokens,
                output: maxOutputTokens,
            },
        },
    };
}
