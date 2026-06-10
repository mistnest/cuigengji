/**
 * Novel AI Editor — Chat Endpoint
 * 支持双模式:
 *   POST /api/chat       — 助手模式 (CC-like)
 *   POST /api/chat/write — 续写模式 (酒馆风格)
 */
import express from 'express';
import { createMemoryManager } from '../services/memory-manager.js';
import { getAuthorProfile } from '../services/author-profile.js';

export const router = express.Router();

// Helper: fetch with timeout
async function fetchWithTimeout(url, options, timeoutMs = 60000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// POST /api/chat — 助手模式
router.post('/', async (req, res) => {
    try {
        const { message, history, context, config } = req.body;
        if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
        if (!config?.apiKey && config?.provider !== 'ollama') return res.status(400).json({ error: 'API key required' });

        const sysPrompt = buildAssistSystemPrompt(context || {});
        const messages = buildMessageArray(history, message);
        const reply = await callAI(config, sysPrompt, messages);

        res.json({ reply });
    } catch (err) {
        console.error('[Chat Assist]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/chat/write — 续写模式 (酒馆风格)
router.post('/write', async (req, res) => {
    try {
        const { message, history, context, config, promptTemplates } = req.body;
        if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
        if (!config?.apiKey && config?.provider !== 'ollama') return res.status(400).json({ error: 'API key required' });

        // L4+L5: Memory retrieval
        const writeMemory = createMemoryManager({
            worldBook: context?.worldBookEntries ? { entries: Object.fromEntries(context.worldBookEntries.map((e, i) => [i, { uid: i, key: [e.name], content: e.content, selective: true, disable: false, order: 100, position: 0 }])) } : { entries: {} },
            characters: (context?.characters || []).map(c => ({ data: { name: c.name, description: c.description } })),
            outline: context?.outline || [],
        });
        const activeMemories = writeMemory.retrieve(context?.currentText || '');
        const memoryText = writeMemory.formatForPrompt(activeMemories);

        // L1: Author profile
        const authorProfile = getAuthorProfile();
        const authorContext = authorProfile.formatForPrompt(true, 500);

        const sysPrompt = buildWriteSystemPrompt(context || {}, promptTemplates, memoryText, authorContext);
        const messages = buildWriteMessages(history, message, context);
        const reply = await callAI(config, sysPrompt, messages);

        res.json({ reply });
    } catch (err) {
        console.error('[Chat Write]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==================== System Prompts ====================

function buildAssistSystemPrompt(ctx) {
    const p = [];
    p.push('你是 Novel AI Editor 的「设定制作」向导，专门帮助作者创建角色卡和世界书。');
    p.push('');
    p.push('## 你的工作方式');
    p.push('你采用启发式引导法：不一次性抛出所有问题，而是顺着作者的思路逐步深入。');
    p.push('每次只问 1-2 个最关键的问题，根据回答自然引出下一个话题。');
    p.push('');
    p.push('## 创作角色卡的引导流程');
    p.push('1. **建立锚点** — 先问「这个角色在故事中做什么？处于什么位置？」（一句话就能建立角色坐标）');
    p.push('2. **性格调色盘** — 引导作者用对比词描述性格：「表面上TA...但实际上TA...」');
    p.push('3. **三面性** — 社会面具 / 独处状态 / 压力下的真实面目');
    p.push('4. **外观特征** — 2-3个最具辨识度的外貌特征，能与性格呼应最佳');
    p.push('5. **语言风格** — 口头禅、说话节奏、用词习惯');
    p.push('6. **收尾整合** — 将以上内容整理为标准角色卡格式');
    p.push('');
    p.push('## 创作世界书条目的引导流程');
    p.push('1. **确定条目** — 「这个设定在什么场景下会用到？」');
    p.push('2. **提炼关键词** — 「当文中出现哪些词时，读者需要知道这个设定？」');
    p.push('3. **撰写内容** — 简洁说明设定本身，不展开不评价。控制在 200 字内');
    p.push('4. **配置参数** — 建议合适的触发深度、是否始终激活');
    p.push('');
    p.push('## ⚠️ 关键：输出 JSON 的时机（必须遵守）');
    p.push('');
    p.push('当用户说「导出」「输出角色卡」「生成卡片」「生成 JSON」「保存」或你已收集到足够信息时——');
    p.push('你必须立即用 ```json 代码块输出完整格式。不要等！不要问「要我输出JSON吗？」直接输出！');
    p.push('');
    p.push('每次输出 JSON 前，先确认已收集了以下信息，缺少的主动询问后再输出。');
    p.push('');
    p.push('角色卡 JSON（复制此模板，填好字段）：');
    p.push('```json');
    p.push('{');
    p.push('  "name": "角色名",');
    p.push('  "description": "外貌与身份描述（50-150字）",');
    p.push('  "personality": "性格（可用对比式：表面上...但实际上...）",');
    p.push('  "scenario": "背景处境",');
    p.push('  "first_mes": "用角色口吻写的第一句话",');
    p.push('  "mes_example": "<START>\\n{{char}}: 示例对话\\n{{user}}: 示例回应",');
    p.push('  "tags": ["标签1", "标签2"]');
    p.push('}');
    p.push('```');
    p.push('');
    p.push('世界书条目 JSON（复制此模板）：');
    p.push('```json');
    p.push('{');
    p.push('  "comment": "条目名称",');
    p.push('  "key": ["触发词1", "触发词2"],');
    p.push('  "keysecondary": [],');
    p.push('  "content": "注入的设定内容（100-200字）",');
    p.push('  "depth": 4,');
    p.push('  "order": 100,');
    p.push('  "constant": false');
    p.push('}');
    p.push('```');
    p.push('');
    p.push('**记住：用户说「导出/输出/生成/保存」= 立刻输出 JSON，不要多问！**');
    p.push('');
    p.push('## 重要规则');
    p.push('- 始终保持对话感，不要变成填表');
    p.push('- 根据已有的世界观和角色信息来提问，避免重复');
    p.push('- 当作者表现出犹豫时，给出 2-3 个具体选项让TA选择');
    p.push('- 每个回答最后用**粗体**问出下一个问题');
    p.push('- 用中文交流');
    p.push('');
    if (ctx.novelTitle) p.push(`书名: ${ctx.novelTitle}`);
    if (ctx.chapterTitle) p.push(`当前章节: ${ctx.chapterTitle}`);

    if (ctx.worldBookEntries?.length) {
        p.push('\n## 已有世界观');
        ctx.worldBookEntries.slice(0, 10).forEach(e => p.push(`- ${e.name}: ${e.content?.substring(0, 100)}`));
    }
    if (ctx.characters?.length) {
        p.push('\n## 已有角色');
        ctx.characters.slice(0, 8).forEach(c => p.push(`- ${c.name}: ${c.description?.substring(0, 100)}`));
    }
    if (ctx.outline?.length) {
        p.push('\n## 大纲');
        ctx.outline.slice(0, 8).forEach(n => p.push(`- ${n.completed ? '✅' : '⬜'} ${n.title}`));
    }

    return p.join('\n');
}

function buildWriteSystemPrompt(ctx, templates, memoryText, authorContext) {
    const p = [];

    // L1: Author profile first
    if (authorContext) p.push(authorContext);

    // If user imported ST prompt templates, use the enabled ones
    const hasTemplates = templates?.length > 0;

    if (hasTemplates) {
        // Use imported ST templates
        const mainTemplate = templates.find(t => t.identifier === 'main');
        if (mainTemplate?.content) {
            // Adapt ST template for novel writing
            p.push(mainTemplate.content
                .replace(/\{\{char\}\}/g, 'AI作家')
                .replace(/\{\{user\}\}/g, '作者')
            );
        }
        // Add other enabled templates
        templates.filter(t => t.identifier !== 'main').forEach(t => {
            if (t.content?.trim()) {
                p.push(`\n[${t.name}]\n${t.content}`);
            }
        });
    }

    // Fallback / base system prompt
    if (!hasTemplates || !templates.find(t => t.identifier === 'main')?.content) {
        p.push('你是一个才华横溢的网络小说作家，正在进行创作。');
        p.push('你会根据上下文自然地续写，保持一致的文风和叙事节奏。');
        p.push('');
        p.push('## 写作要求');
        p.push('1. 文风与上下文完全一致');
        p.push('2. 角色言行符合设定');
        p.push('3. 情节发展自然流畅');
        p.push('4. 对话生动有个性');
        p.push('5. 适当加入冲突和悬念');
        p.push('6. 纯中文写作');
    }

    // Novel context
    p.push('');
    if (ctx.novelTitle) p.push(`书名: ${ctx.novelTitle}`);
    if (ctx.chapterTitle) p.push(`当前章节: ${ctx.chapterTitle}`);

    // L4+L5: Memory injection (keyword-matched world entries + characters)
    if (memoryText) {
        p.push(`\n${memoryText}`);
    } else {
        // Fallback: raw injection
        if (ctx.worldBookEntries?.length) {
            p.push('\n【世界观设定】');
            ctx.worldBookEntries.slice(0, 8).forEach(e => p.push(`- ${e.name}: ${e.content}`));
        }
        if (ctx.characters?.length) {
            p.push('\n【角色信息】');
            ctx.characters.slice(0, 6).forEach(c => p.push(`- ${c.name}: ${c.description}`));
        }
    }
    if (ctx.outline?.length) {
        const pending = ctx.outline.filter(n => !n.completed);
        if (pending.length) p.push(`\n【大纲进度】${pending.map(n => n.title).join(' → ')}`);
    }

    return p.join('\n');
}

// ==================== Message Building ====================

function buildMessageArray(history, currentMsg) {
    const msgs = [];
    for (const m of (history || []).slice(-20)) {
        msgs.push({ role: m.role, content: m.content });
    }
    msgs.push({ role: 'user', content: currentMsg });
    return msgs;
}

function buildWriteMessages(history, currentMsg, ctx) {
    const msgs = [];

    // First message includes context
    if (!history?.length && ctx.currentText) {
        msgs.push({
            role: 'user',
            content: `【当前正文末尾】\n${ctx.currentText.slice(-600)}\n\n【继续】${currentMsg}`,
        });
    } else {
        for (const m of (history || []).slice(-20)) {
            msgs.push({ role: m.role, content: m.content });
        }
        msgs.push({ role: 'user', content: currentMsg });
    }

    return msgs;
}

// ==================== AI Caller ====================

async function callAI(config, systemPrompt, messages) {
    const { provider, apiKey, endpoint, model } = config;
    const temp = config.temperature ?? 0.7;
    const topP = config.topP ?? 0.9;
    const maxTok = 4096;

    switch (provider) {
        case 'anthropic': {
            const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: maxTok, temperature: temp, top_p: topP, system: systemPrompt, messages }),
            });
            if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `Anthropic ${r.status}`); }
            const d = await r.json();
            return d.content?.map(c => c.text || '').join('') || '';
        }
        case 'openai':
        case 'deepseek':
        case 'custom': {
            const base = endpoint?.replace(/\/+$/, '') || (provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1');
            const r = await fetchWithTimeout(`${base}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model: model || (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o'), max_tokens: maxTok, temperature: temp, top_p: topP, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
            });
            if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `${provider} ${r.status}`); }
            const d = await r.json();
            return d.choices?.[0]?.message?.content || '';
        }
        case 'openrouter': {
            const r = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model: model || 'anthropic/claude-sonnet-4-6', max_tokens: maxTok, temperature: temp, top_p: topP, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
            });
            if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `OpenRouter ${r.status}`); }
            const d = await r.json();
            return d.choices?.[0]?.message?.content || '';
        }
        case 'ollama': {
            const base = endpoint?.replace(/\/+$/, '') || 'http://localhost:11434';
            const prompt = `### System:\n${systemPrompt}\n\n### Conversation:\n${messages.map(m => `### ${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content}`).join('\n\n')}\n\n### Assistant:\n`;
            const r = await fetchWithTimeout(`${base}/api/generate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: model || 'llama3', prompt, stream: false, options: { temperature: temp, num_predict: maxTok, top_p: topP } }),
            });
            if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Ollama ${r.status}`); }
            const d = await r.json();
            return d.response || '';
        }
        default: throw new Error(`Unsupported: ${provider}`);
    }
}
