/**
 * Novel AI Editor — AI Endpoint (with Memory Pipeline)
 *
 * L4+L5: 世界书引擎检索 + Prompt 注入
 *   1. 扫描正文 → 关键词匹配世界书条目
 *   2. 检测出场的角色
 *   3. 注入相关的记忆到 system prompt
 *   4. AI 生成后 → L3 自动提取
 */
import express from 'express';
import { createMemoryManager } from '../services/memory-manager.js';
import { prepareContext } from '../services/context-manager.js';
import { NovelMemory } from '../services/novel-memory.js';
import { getAuthorProfile } from '../services/author-profile.js';
import { applyAiSecret } from '../services/ai-secrets.js';
import { callAIText, fetchModelList } from '../services/ai-client.js';
import { capturePrompt } from './debug.js';

export const router = express.Router();

function hasApiKey(config) {
    return !!config?.apiKey || config?.provider === 'ollama';
}

// ==================== POST /continue — AI 续写 (完整记忆管线) ====================
router.post('/continue', async (req, res) => {
    try {
        const { text, config, worldBook, characters, outline, styleGuide, instructions, chapterContext, novelId, memoryBudget, presetName } = req.body;

        const aiConfig = applyAiSecret(config, presetName);
        if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        // ---- L4: Smart Retrieval ----
        const { getModelContext } = await import('../services/context-manager.js');
        const modelCtx = getModelContext(aiConfig.model || 'default');
        const memory = createMemoryManager({
            worldBook: worldBook || { entries: {} },
            characters: characters || [],
            outline: outline || [],
            styleGuide: styleGuide || '',
            chapterSummaries: chapterContext || [],
        }, {
            memoryBudgetPct: memoryBudget || 15,
            modelContextSize: modelCtx.total,
        });

        const activeMemories = memory.retrieve(text);
        const memoryText = memory.formatForPrompt(activeMemories);
        const memoryStats = memory.getStats(activeMemories);

        // ---- L1: Author Profile ----
        const authorProfile = getAuthorProfile();
        const authorContext = authorProfile.formatForPrompt(true, 1000);

        // ---- L2: Novel Project Memory ----
        let novelMemoryText = '';
        if (novelId) {
            const novelMemory = new NovelMemory(novelId);
            novelMemoryText = novelMemory.formatForPrompt();
        }

        // ---- Build Prompts ----
        const sysParts = [];

        // Author profile first (L1 — highest precedence)
        if (authorContext) sysParts.push(authorContext);

        // Novel memory (L2)
        if (novelMemoryText) {
            sysParts.push(novelMemoryText);
        }

        // Writing role
        sysParts.push('你是一个专业的网络小说作家。请根据以下设定和上下文，进行高质量的小说续写。');

        // L4+L5: Injected memories (world book entries, characters, outline)
        if (memoryText) {
            sysParts.push(`\n${memoryText}`);
        }

        // Writing rules
        sysParts.push('\n【写作要求】');
        sysParts.push('1. 保持与原文完全一致的文风和叙事节奏');
        sysParts.push('2. 充分运用提供的人物设定和世界观信息');
        sysParts.push('3. 情节发展合乎逻辑，有因果关联');
        sysParts.push('4. 对话要符合人物性格且推动情节');
        sysParts.push('5. 适当设置悬念和冲突');
        sysParts.push('6. 纯中文写作，标点规范');

        const systemPrompt = sysParts.join('\n');

        // User prompt
        const userParts = [];
        if (instructions) { userParts.push(`【特别指示】${instructions}`); userParts.push(''); }
        userParts.push('【当前正文 — 请从此处续写】');
        userParts.push(text.trimEnd());
        userParts.push('');
        userParts.push('续写要求：直接输出续写正文内容。不要加任何前缀、后缀或解释。');

        const userPrompt = userParts.join('\n');

        // ---- Context Management ----
        const ctx = prepareContext({
            text: userPrompt,
            model: aiConfig.model || 'default',
            systemPrompt,
            worldBook,
            characters,
            maxOutputTokens: aiConfig.maxTokens || 4096,
        });

        // ---- Call AI ----
        // [DEBUG] Capture the full API request
        capturePrompt({
            provider: aiConfig.provider, model: aiConfig.model,
            temperature: aiConfig.temperature ?? 0.7, maxTokens: aiConfig.maxTokens ?? 4096, topP: aiConfig.topP ?? 0.9,
            systemPrompt, userPrompt: ctx.trimmedText,
            memoryStats, tokenEstimate: ctx.summary,
        });
        const result = await callAIText(aiConfig, systemPrompt, ctx.trimmedText);

        // ---- L3: Auto-Extract ----
        let extractions = null;
        if (novelId) {
            const novelMemory = new NovelMemory(novelId);
            extractions = novelMemory.extractFromText(result, { context: text });
        }
        const newMemories = memory.autoExtract(result, text);

        res.json({
            content: result,
            context: ctx.summary,
            memory: {
                stats: memoryStats,
                activeEntries: activeMemories.map(m => ({ label: m.label, type: m.type })),
            },
            extractions: extractions ? {
                newCharacters: extractions.newCharacters?.slice(0, 5) || [],
                newWorldElements: extractions.newWorldElements?.slice(0, 5) || [],
                suggestions: newMemories.suggestions?.slice(0, 5) || [],
            } : null,
        });
    } catch (err) {
        console.error('[AI Continue]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==================== POST /plot-suggestions ====================
router.post('/plot-suggestions', async (req, res) => {
    try {
        const { text, config, worldBook, characters, outline, styleGuide, presetName } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        const memory = createMemoryManager({ worldBook, characters, outline, styleGuide });
        const activeMemories = memory.retrieve(text);
        const memoryText = memory.formatForPrompt(activeMemories);

        const systemPrompt = [
            '你是一个小说创作顾问。请分析当前小说内容，给出3种不同的情节发展方向。',
            memoryText,
            '',
            '对每条候选，请按以下格式回复：',
            '---',
            '情节走向：<概述>',
            '冲突点：<描述>',
            '预计字数：<数字>',
            '预览：<约100字预览>',
            '---',
        ].join('\n');

        const userPrompt = [
            '【当前正文末尾】',
            text.slice(-2000),
            '',
            '请给出3种风格各异的情节发展方向：',
        ].join('\n');

        const result = await callAIText(aiConfig, systemPrompt, userPrompt, { maxTokens: 2000 });
        const candidates = parsePlotCandidates(result);

        res.json({ candidates });
    } catch (err) {
        console.error('[AI Plot]', err.message);
        res.status(500).json({ error: err.message, candidates: [] });
    }
});

// ==================== POST /inspire ====================
router.post('/inspire', async (req, res) => {
    try {
        const { text, config, worldBook, characters, styleGuide, presetName } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        const memory = createMemoryManager({ worldBook, characters, outline: [], styleGuide });
        const activeMemories = memory.retrieve(text);
        const memoryText = memory.formatForPrompt(activeMemories);

        const systemPrompt = [
            '你是小说创作顾问。请提供灵感启发：',
            '1. 可发展的新情节线',
            '2. 可深化的人物关系',
            '3. 可引入的新冲突或悬念',
            '4. 对场景描写的建议',
            memoryText,
        ].join('\n');

        const result = await callAIText(aiConfig, systemPrompt,
            text ? `当前正文：\n${text.slice(-1500)}` : '请根据当前小说给出灵感启发',
            { maxTokens: 1500 }
        );

        res.json({ content: result });
    } catch (err) {
        console.error('[AI Inspire]', err.message);
        res.status(500).json({ error: err.message, content: '' });
    }
});

// ==================== POST /summarize ====================
router.post('/summarize', async (req, res) => {
    try {
        const { text, config, presetName } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        const result = await callAIText(aiConfig,
            '你是专业编辑。请为以下章节写一个简洁摘要（200字内），包含主要情节和关键人物。只输出摘要。',
            text,
            { maxTokens: 400 }
        );

        res.json({ summary: result });
    } catch (err) {
        console.error('[AI Summarize]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==================== POST /extract-memories (L3 trigger) ====================
router.post('/extract-memories', async (req, res) => {
    try {
        const { text, novelId, config, presetName } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!text?.trim() || !novelId) return res.status(400).json({ error: 'text and novelId required' });

        const novelMemory = new NovelMemory(novelId);
        const extractions = novelMemory.extractFromText(text);

        // If we have AI config, generate proper summaries
        if (hasApiKey(aiConfig)) {
            // Generate chapter summary
            if (text.length > 500) {
                const summary = await callAIText(aiConfig,
                    '你是专业编辑。请为以下内容写一个简洁摘要（200字内）。只输出摘要。',
                    text.slice(-3000),
                    { maxTokens: 400 }
                );
                extractions.sessionSummary = summary;
            }
        }

        // Save extractions to novel memory
        if (extractions.newCharacters?.length > 0) {
            const content = extractions.newCharacters
                .map(c => `- ${c.name}: ${c.context || '（待补充）'}`)
                .join('\n');
            novelMemory.writeMemory('extracted-chars', 'AI 提取的新角色候选', content, { type: 'extraction', source: 'ai' });
        }

        if (extractions.newWorldElements?.length > 0) {
            const content = extractions.newWorldElements
                .map(e => `- ${e.element} [${e.type}]: ${e.context || '（待补充）'}`)
                .join('\n');
            novelMemory.writeMemory('world-elements', 'AI 提取的世界观元素', content, { type: 'extraction', source: 'ai' });
        }

        if (extractions.sessionSummary) {
            novelMemory.saveSessionNotes(extractions.sessionSummary);
        }

        res.json(extractions);
    } catch (err) {
        console.error('[AI Extract]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==================== POST /list-models — 获取可用模型列表 ====================
router.post('/list-models', async (req, res) => {
    try {
        const { config, presetName } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!aiConfig?.provider) return res.status(400).json({ error: 'provider is required' });

        const models = await fetchModelList(aiConfig);
        res.json({ models });
    } catch (err) {
        console.error('[AI] List models error:', err.message);
        res.status(502).json({ models: [], error: err.message, code: 'UPSTREAM_ERROR' });
    }
});

// ==================== POST /test-connection ====================
router.post('/test-connection', async (req, res) => {
    try {
        const { config, presetName } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        {
            const result = await callAIText(
                aiConfig,
                '\u7b80\u77ed\u56de\u590d\u3002',
                '\u53ea\u56de\u590d\u201c\u8fde\u63a5\u6210\u529f\u201d\u3002',
                { maxTokens: 512 },
            );
            return res.json({ success: true, response: result });
        }
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ==================== POST /preview — [DEBUG] 预览发送给 AI 的完整 prompt ====================
router.post('/preview', async (req, res) => {
    try {
        const { text, config, worldBook, characters, outline, styleGuide, chapterContext, memoryBudget } = req.body;

        const { getModelContext } = await import('../services/context-manager.js');
        const modelCtx = getModelContext(config.model || 'default');
        const memory = createMemoryManager({
            worldBook: worldBook || { entries: {} },
            characters: characters || [],
            outline: outline || [],
            styleGuide: styleGuide || '',
            chapterSummaries: chapterContext || [],
        }, {
            memoryBudgetPct: memoryBudget || 15,
            modelContextSize: modelCtx.total,
        });

        const activeMemories = memory.retrieve(text || '');
        const memoryText = memory.formatForPrompt(activeMemories);
        const memoryStats = memory.getStats(activeMemories);

        const authorProfile = getAuthorProfile();
        const authorContext = authorProfile.formatForPrompt(true, 1000);

        const sysParts = [];
        if (authorContext) sysParts.push(authorContext);
        sysParts.push('你是一个专业的网络小说作家。请根据以下设定和上下文，进行高质量的小说续写。');
        if (memoryText) sysParts.push(`\n${memoryText}`);
        sysParts.push('\n【写作要求】\n1. 保持与原文完全一致的文风和叙事节奏\n2. 充分运用提供的人物设定和世界观信息\n3. 情节发展合乎逻辑，有因果关联\n4. 对话要符合人物性格且推动情节\n5. 适当设置悬念和冲突\n6. 纯中文写作，标点规范');

        const systemPrompt = sysParts.join('\n');
        const userPrompt = text ? `【当前正文 — 请从此处续写】\n${text.trimEnd()}\n\n续写要求：直接输出续写正文内容。不要加任何前缀、后缀或解释。` : '(无正文)';

        const tokenEstimate = {
            system: Math.round(systemPrompt.length / 2.5),
            user: Math.round(userPrompt.length / 2.5),
            total: Math.round((systemPrompt.length + userPrompt.length) / 2.5),
        };

        res.json({
            provider: config.provider,
            model: config.model,
            systemPrompt,
            userPrompt,
            memoryStats,
            tokenEstimate,
        });
    } catch (err) {
        console.error('[AI] Preview error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==================== POST /memory-status ====================
router.post('/memory-status', async (_req, res) => {
    try {
        const author = getAuthorProfile();
        const memories = author.listMemories();
        const profile = author.readProfile();

        res.json({
            author: {
                profileLength: profile.length,
                memoryCount: memories.length,
                recentMemories: memories.slice(-5),
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== POST /extract — AI 提取角色与世界书 ====================
router.post('/extract', async (req, res) => {
    try {
        const { text, config, presetName } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        const sysPrompt = buildExtractSystemPrompt();
        const userPrompt = buildExtractUserPrompt(text);
        capturePrompt({ provider: aiConfig.provider, model: aiConfig.model, systemPrompt: sysPrompt, userPrompt });
        const result = await callAIText(aiConfig, sysPrompt, userPrompt, { maxTokens: 8000 });
        const parsed = parseExtractionResult(result);

        res.json({ ...parsed, rawResponse: result });
    } catch (err) {
        console.error('[AI Extract]', err.message);
        res.status(500).json({ error: err.message });
    }
});

function buildExtractSystemPrompt() {
    return `## 角色
你是专业的小说设定提取助手。你的任务是从小说正文中提取角色信息和世界观元素。

## 工作流程
1. 通读全文，找出所有有名字的角色
2. 找出所有虚构世界观元素（地点、势力、规则、物品等）
3. 对每个发现，注明原文中的关键描述

## 角色提取规则
- 只提取有明确名字的出场角色
- 外貌只写差异特征（疤痕、异色瞳、特殊发色等），不写默认特征
- 描述用白描，不用比喻（"眸如星辰"→提炼为特征而非保留比喻）
- 性格从角色言行推断，不写形容词堆砌

## 世界观提取规则
- 地点：虚构城市/国家/建筑
- 势力：门派/组织/家族
- 规则：魔法体系/社会规则/特殊法则
- 物品：重要道具/武器/神器
- 每个条目配2-4个触发关键词

## 输出格式（严格JSON，不输出其他文字）
{
  "characters": [
    {
      "name": "角色名",
      "description": "外貌+身份白描（50-120字）",
      "personality": "性格特征（20-40字）",
      "scenario": "当前处境或首次出场场景（30-60字）",
      "first_mes": "一句角色口吻的发言",
      "group": "分组建议"
    }
  ],
  "worldEntries": [
    {
      "comment": "条目名称",
      "key": ["触发词1", "触发词2"],
      "content": "注入内容（100-200字白描设定）",
      "group": "地点/势力/规则/物品"
    }
  ],
  "summary": "一句话概括提取结果"
}`;
}

function buildExtractUserPrompt(text) {
    const maxLen = 12000;
    const scanText = text.length > maxLen ? text.slice(0, maxLen) + '\n\n…[后续内容省略]…' : text;
    return [
        '请分析以下小说正文，提取所有角色和世界观元素。',
        '如果需要分组：使用"地点""势力""规则""物品""角色"',
        '',
        '【小说正文】',
        scanText,
    ].join('\n');
}

function parseExtractionResult(raw) {
    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { characters: [], worldEntries: [], summary: '未能解析AI输出' };
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            characters: Array.isArray(parsed.characters) ? parsed.characters : [],
            worldEntries: Array.isArray(parsed.worldEntries) ? parsed.worldEntries : [],
            summary: parsed.summary || '',
        };
    } catch {
        return { characters: [], worldEntries: [], summary: '解析失败，请重试' };
    }
}

function parsePlotCandidates(text) {
    const blocks = text.split('---').map(s => s.trim()).filter(Boolean);
    return blocks.slice(0, 5).map((block, i) => {
        const d = block.match(/(?:情节走向|方向)[：:]\s*(.+)/);
        const p = block.match(/(?:预览|片段)[：:]\s*(.+)/);
        const w = block.match(/(?:预计字数|字数)[：:]\s*(\d+)/);
        const c = block.match(/(?:冲突点|冲突)[：:]\s*(.+)/);
        return {
            index: i,
            direction: d?.[1]?.trim() || block.split('\n')[0]?.slice(0, 100) || '',
            preview: p?.[1]?.trim() || '',
            estimatedWords: w ? parseInt(w[1]) : 0,
            conflict: c?.[1]?.trim() || '',
            excitement: Math.min(10, Math.max(3, Math.floor(block.length / 80))),
        };
    }).filter(c => c.direction);
}
