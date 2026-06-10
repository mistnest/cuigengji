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

export const router = express.Router();

// ==================== POST /continue — AI 续写 (完整记忆管线) ====================
router.post('/continue', async (req, res) => {
    try {
        const { text, config, worldBook, characters, outline, styleGuide, instructions, chapterContext, novelId } = req.body;

        if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
        if (!config?.apiKey && config?.provider !== 'ollama') return res.status(400).json({ error: 'API key required' });

        // ---- L4: Smart Retrieval ----
        const memory = createMemoryManager({
            worldBook: worldBook || { entries: {} },
            characters: characters || [],
            outline: outline || [],
            styleGuide: styleGuide || '',
            chapterSummaries: chapterContext || [],
        });

        const activeMemories = memory.retrieve(text);
        const memoryText = memory.formatForPrompt(activeMemories);
        const memoryStats = memory.getStats(activeMemories);

        // ---- L1: Author Profile ----
        const authorProfile = getAuthorProfile();
        const authorContext = authorProfile.formatForPrompt(true, 1000);

        // ---- Build Prompts ----
        const sysParts = [];

        // Author profile first (L1 — highest precedence)
        if (authorContext) sysParts.push(authorContext);

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
            model: config.model || 'default',
            systemPrompt,
            worldBook,
            characters,
            maxOutputTokens: config.maxTokens || 4096,
        });

        // ---- Call AI ----
        const result = await callAI(config, systemPrompt, ctx.trimmedText);

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
        const { text, config, worldBook, characters, outline, styleGuide } = req.body;
        if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
        if (!config?.apiKey && config?.provider !== 'ollama') return res.status(400).json({ error: 'API key required' });

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

        const result = await callAI(config, systemPrompt, userPrompt, { maxTokens: 2000 });
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
        const { text, config, worldBook, characters, styleGuide } = req.body;

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

        const result = await callAI(config, systemPrompt,
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
        const { text, config } = req.body;
        if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

        const result = await callAI(config,
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
        const { text, novelId, config } = req.body;
        if (!text?.trim() || !novelId) return res.status(400).json({ error: 'text and novelId required' });

        const novelMemory = new NovelMemory(novelId);
        const extractions = novelMemory.extractFromText(text);

        // If we have AI config, generate proper summaries
        if (config?.apiKey || config?.provider === 'ollama') {
            // Generate chapter summary
            if (text.length > 500) {
                const summary = await callAI(config,
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

// ==================== POST /test-connection ====================
router.post('/test-connection', async (req, res) => {
    try {
        const { config } = req.body;
        const result = await callAI(config, '简短回复。', '回复"连接成功"', { maxTokens: 50 });
        res.json({ success: true, response: result });
    } catch (err) {
        res.json({ success: false, error: err.message });
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

// ==================== AI Backend Caller ====================

async function callAI(config, systemPrompt, userPrompt, options = {}) {
    const { provider, apiKey, endpoint, model } = config;
    const maxTokens = options.maxTokens || config.maxTokens || 4096;
    const temperature = config.temperature ?? 0.7;
    const topP = config.topP ?? 0.9;
    const topK = config.topK ?? 40;

    switch (provider) {
        case 'anthropic':
            return callAnthropic({ apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, topP, topK });
        case 'openai':
        case 'custom':
            return callOpenAI({ apiKey, endpoint, model, systemPrompt, userPrompt, temperature, maxTokens, topP });
        case 'deepseek':
            return callOpenAI({ apiKey, endpoint: endpoint || 'https://api.deepseek.com/v1', model: model || 'deepseek-chat', systemPrompt, userPrompt, temperature, maxTokens, topP });
        case 'openrouter':
            return callOpenRouter({ apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, topP });
        case 'ollama':
            return callOllama({ endpoint: endpoint || 'http://localhost:11434', model, systemPrompt, userPrompt, temperature, maxTokens, topP, topK });
        default:
            throw new Error(`Unsupported: ${provider}`);
    }
}

async function callAnthropic({ apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, topP, topK }) {
    const body = { model: model || 'claude-sonnet-4-6', max_tokens: maxTokens, temperature, top_p: topP, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };
    if (topK) body.top_k = topK;
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `Anthropic ${r.status}`); }
    const d = await r.json();
    return d.content?.map(c => c.text || '').join('') || '';
}

async function callOpenAI({ apiKey, endpoint, model, systemPrompt, userPrompt, temperature, maxTokens, topP }) {
    const base = endpoint?.replace(/\/+$/, '') || 'https://api.openai.com/v1';
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: model || 'gpt-4o', max_tokens: maxTokens, temperature, top_p: topP, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `${r.status}`); }
    return r.json().then(d => d.choices?.[0]?.message?.content || '');
}

async function callOpenRouter({ apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, topP }) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: model || 'anthropic/claude-sonnet-4-6', max_tokens: maxTokens, temperature, top_p: topP, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `${r.status}`); }
    return r.json().then(d => d.choices?.[0]?.message?.content || '');
}

async function callOllama({ endpoint, model, systemPrompt, userPrompt, temperature, maxTokens, topP, topK }) {
    const base = endpoint?.replace(/\/+$/, '') || 'http://localhost:11434';
    const p = `### System:\n${systemPrompt}\n\n### User:\n${userPrompt}`;
    const r = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model || 'llama3', prompt: p, stream: false, options: { temperature, num_predict: maxTokens, top_p: topP, top_k: topK } }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `${r.status}`); }
    return r.json().then(d => d.response || '');
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
