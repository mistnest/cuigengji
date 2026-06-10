/**
 * Novel AI Editor — Plot Guide Service
 * 情节引导：基于上下文生成多条情节候选
 */

import { buildPlotPrompt, buildInspirePrompt } from './prompt-builder.js';
import { estimateTokens, getModelContext } from './context-manager.js';

/**
 * @typedef {object} PlotCandidate
 * @property {number} index
 * @property {string} direction - 情节走向
 * @property {string} preview - 预览片段
 * @property {number} estimatedWords - 预计字数
 * @property {string} conflict - 冲突点
 * @property {string[]} charactersInvolved - 涉及角色
 * @property {number} excitement - 精彩程度评分 1-10
 */

/**
 * 生成情节候选
 * @param {object} params
 * @param {Function} aiCaller - AI 调用函数
 * @returns {Promise<PlotCandidate[]>}
 */
export async function generatePlotCandidates(params, aiCaller) {
    const { text, config, worldBook, characters, outline, styleGuide } = params;

    const { systemPrompt, userPrompt } = buildPlotPrompt({
        text,
        worldBook,
        characters,
        outline,
        styleGuide,
    });

    const result = await aiCaller(config, systemPrompt, userPrompt, { maxTokens: 2000 });
    return parsePlotCandidates(result);
}

/**
 * 生成灵感启发
 * @param {object} params
 * @param {Function} aiCaller
 * @returns {Promise<object>}
 */
export async function generateInspiration(params, aiCaller) {
    const { text, config, worldBook, characters, styleGuide } = params;

    const { systemPrompt, userPrompt } = buildInspirePrompt({
        text,
        worldBook,
        characters,
        styleGuide,
    });

    const result = await aiCaller(config, systemPrompt, userPrompt, { maxTokens: 1500 });

    return {
        content: result,
        raw: result,
    };
}

/**
 * 解析 AI 返回的情节候选文本
 * @param {string} text
 * @returns {PlotCandidate[]}
 */
function parsePlotCandidates(text) {
    const candidates = [];
    const blocks = text.split('---').map(s => s.trim()).filter(Boolean);

    for (let i = 0; i < Math.min(blocks.length, 5); i++) {
        const block = blocks[i];
        const candidate = {
            index: i,
            direction: '',
            preview: '',
            estimatedWords: 0,
            conflict: '',
            charactersInvolved: [],
            excitement: 5,
        };

        // Extract fields using flexible regex
        const directionMatch = block.match(/(?:情节走向|方向)[：:]\s*(.+?)(?:\n|$)/);
        if (directionMatch) candidate.direction = directionMatch[1].trim();

        const previewMatch = block.match(/(?:预览|片段)[：:]\s*(.+?)(?:\n|$)/);
        if (previewMatch) candidate.preview = previewMatch[1].trim();

        const wordsMatch = block.match(/(?:预计字数|字数)[：:]\s*(\d+)/);
        if (wordsMatch) candidate.estimatedWords = parseInt(wordsMatch[1]);

        const conflictMatch = block.match(/(?:冲突点|冲突)[：:]\s*(.+?)(?:\n|$)/);
        if (conflictMatch) candidate.conflict = conflictMatch[1].trim();

        // Fallback: if no structured data found, use first meaningful line as direction
        if (!candidate.direction && block.trim()) {
            const lines = block.split('\n').filter(l => l.trim().length > 10);
            if (lines.length > 0) {
                candidate.direction = lines[0].replace(/^[-\d.]+\s*/, '').trim();
                candidate.preview = lines.slice(1, 3).join('\n');
            }
        }

        // Estimate excitement based on content richness
        if (candidate.direction) {
            const contentLength = (candidate.direction + candidate.preview + candidate.conflict).length;
            candidate.excitement = Math.min(10, Math.max(3, Math.floor(contentLength / 50)));
            candidates.push(candidate);
        }
    }

    return candidates;
}

/**
 * 对候选进行排序（按精彩程度）
 * @param {PlotCandidate[]} candidates
 * @returns {PlotCandidate[]}
 */
export function rankCandidates(candidates) {
    return [...candidates].sort((a, b) => {
        // Prefer higher excitement and more estimated words
        const scoreA = (a.excitement || 5) * 10 + Math.min(a.estimatedWords / 100, 50);
        const scoreB = (b.excitement || 5) * 10 + Math.min(b.estimatedWords / 100, 50);
        return scoreB - scoreA;
    });
}
