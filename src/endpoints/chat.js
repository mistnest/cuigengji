/**
 * 催更姬 — Chat Endpoint
 * 支持双模式:
 *   POST /api/chat       — 助手模式 (CC-like)
 *   POST /api/chat/write — 续写模式 (酒馆风格)
 */
import express from 'express';
import { applyAiSecret } from '../services/ai-secrets.js';
import { streamAIChat } from '../services/ai-client.js';
import { capturePrompt } from './debug.js';
import { ASSIST_TOOLS, executeTool } from '../services/chat-tools.js';
import { generateWriting, generateWritingStream } from '../services/writing-service.js';
import { getReferenceToolDefinitions, executeReferenceTool } from '../services/ai-tools/reference/index.js';

export const router = express.Router();

function hasApiKey(config) {
    return !!config?.apiKey
        || config?.provider === 'ollama'
        || (
            config?.provider === 'google-vertex'
            && String(config?.vertexAuthMode || 'express') === 'full'
            && !!config?.vertexServiceAccountJson
        );
}

function setupSse(res) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
}

function sendSse(res, event) {
    if (res.destroyed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function streamError(res, err) {
    if (!res.headersSent) setupSse(res);
    sendSse(res, { type: 'error', message: err.message || String(err) });
    res.end();
}

router.post('/', async (req, res) => {
    const requestController = createRequestAbortController(req, res);
    try {
        const { message, history, context, config, presetName } = req.body;
        const aiConfig = { ...applyAiSecret(config, presetName), presetName };
        if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        const sysPrompt = buildAssistSystemPrompt(context || {});
        const messages = buildMessageArray(history, message);
        const novelId = context?.novelId || '';

        capturePrompt({ provider: aiConfig.provider, model: aiConfig.model, temperature: aiConfig.temperature ?? 0.7, maxTokens: 4096, topP: aiConfig.topP ?? 0.9, systemPrompt: sysPrompt, userPrompt: JSON.stringify(messages) });

        setupSse(res);

        // Tool-calling loop: up to 4 rounds. Each model round streams visible text
        // immediately, while tool_call deltas are aggregated by ai-client.
        let reply = '';
        let visibleReply = '';
        const forwardModelEvent = event => {
            if (event?.type === 'chunk') visibleReply += event.content || '';
            sendSse(res, event);
        };
        for (let round = 0; round < 4; round++) {
            const resp = await streamAIChat(aiConfig, sysPrompt, messages, {
                signal: requestController.signal,
                tools: ASSIST_TOOLS,
                toolChoice: 'auto',
                onEvent: forwardModelEvent,
            });

            const toolCalls = resp.message?.tool_calls || [];
            if (!toolCalls.length) {
                reply = resp.message?.content || '';
                break;
            }

            // Stream tool call events to frontend
            sendSse(res, { type: 'tool_start', count: toolCalls.length, round: round + 1 });

            // Execute tools and feed results back
            messages.push({
                role: 'assistant',
                content: resp.message?.content || '',
                tool_calls: toolCalls,
            });
            for (const call of toolCalls) {
                const toolName = call.function?.name;
                const args = parseToolArguments(call.function?.arguments);
                sendSse(res, { type: 'tool_call', name: toolName, target: args.target, data: args.data });
                const result = await executeTool(toolName, args, novelId);
                sendSse(res, { type: 'tool_result', name: toolName, result });
                messages.push({ role: 'tool', tool_call_id: call.id, name: toolName, content: JSON.stringify(result) });
            }

            sendSse(res, { type: 'tool_end', round: round + 1 });
        }

        const finalReply = visibleReply || reply || '(未收到回复)';
        if (!visibleReply) sendSse(res, { type: 'chunk', content: finalReply });
        sendSse(res, { type: 'done', reply: finalReply });
        res.end();
    } catch (err) {
        if (err.name === 'AbortError' && requestController.signal.aborted) return;
        console.error('[Chat Assist]', err.message);
        streamError(res, err);
    }
});

// POST /api/chat/plan — 情节研讨模式 (CC Plan Mode)
router.post('/plan', async (req, res) => {
    const requestController = createRequestAbortController(req, res);
    try {
        const { message, history, context, config, presetName } = req.body;
        const aiConfig = { ...applyAiSecret(config, presetName), presetName };
        if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        const sysPrompt = buildPlanSystemPrompt(context);
        const msgs = [];

        if (!history?.length) {
            msgs.push({ role: 'user', content: `【小说上下文】\n书名: ${context.novelTitle || ''}\n当前章节: ${context.chapterTitle || ''}\n\n【情节问题/需求】\n${message}` });
        } else {
            history.slice(-20).forEach(m => msgs.push({ role: m.role, content: m.content }));
            msgs.push({ role: 'user', content: message });
        }

        capturePrompt({ provider: aiConfig.provider, model: aiConfig.model, temperature: aiConfig.temperature ?? 0.7, maxTokens: 4096, topP: aiConfig.topP ?? 0.9, systemPrompt: sysPrompt, userPrompt: JSON.stringify(msgs) });

        // Plan mode only needs look-up tools, not scene context
        const allRefTools = getReferenceToolDefinitions();
        const planTools = allRefTools.filter(t =>
            t.function.name === 'search_reference' || t.function.name === 'get_reference_detail'
        );
        let reply = '';
        let visibleReply = '';
        const forwardModelEvent = event => {
            if (event?.type === 'chunk') visibleReply += event.content || '';
            sendSse(res, event);
        };
        setupSse(res);
        for (let round = 0; round < 4; round++) {
            const resp = await streamAIChat(aiConfig, sysPrompt, msgs, {
                signal: requestController.signal,
                tools: planTools,
                toolChoice: 'auto',
                onEvent: forwardModelEvent,
            });
            const toolCalls = resp.message?.tool_calls || [];
            if (!toolCalls.length) {
                reply = resp.message?.content || '';
                break;
            }
            sendSse(res, { type: 'tool_start', count: toolCalls.length, round: round + 1 });
            msgs.push({ role: 'assistant', content: resp.message?.content || '', tool_calls: toolCalls });
            for (const call of toolCalls) {
                const toolName = call.function?.name;
                const args = parseToolArguments(call.function?.arguments);
                sendSse(res, { type: 'tool_call', name: toolName, target: args.types?.[0] || args.id || args.query || '', data: args });
                const result = await executeReferenceTool(toolName, args, { message, history, context });
                sendSse(res, { type: 'tool_result', name: toolName, result });
                msgs.push({ role: 'tool', tool_call_id: call.id, name: toolName, content: JSON.stringify(result) });
            }
            sendSse(res, { type: 'tool_end', round: round + 1 });
        }

        const finalReply = visibleReply || reply || '(未收到回复)';
        if (!visibleReply) sendSse(res, { type: 'chunk', content: finalReply });
        sendSse(res, { type: 'done', reply: finalReply });
        res.end();
    } catch (err) {
        if (err.name === 'AbortError' && requestController.signal.aborted) return;
        console.error('[Chat Plan]', err.message);
        streamError(res, err);
    }
});

function buildPlanSystemPrompt(ctx) {
    const p = [];
    p.push('你是小说创作的情节研讨顾问。你的任务是分析用户提出的情节问题，给出**多角度的结构化分析**。');
    p.push('');
    p.push('## 工作流程');
    p.push('1. 分析当前情节状态和用户的问题');
    p.push('2. 列出 2-3 种可能的情节发展方向（标记为 方案A、方案B、方案C）');
    p.push('3. 每个方案包含：情节概述、优点、风险/挑战、对后续情节的影响');
    p.push('4. 最后给出你的推荐和建议');
    p.push('');
    p.push('## 输出格式');
    p.push('用清晰的结构输出，每个方案用 `### 方案X：标题` 分隔。');
    p.push('');
    p.push('## 重要规则');
    p.push('- 基于已有世界观和角色设定进行分析，不要凭空编造');
    p.push('- 每个方案都要考虑角色性格一致性和情节逻辑');
    p.push('- 如果用户已有倾向，重点分析该方向的可行性');
    p.push('- 最后必须有明确的对比和推荐');
    p.push('- 用中文回复');
    p.push('');
    p.push('## 资料工具');
    p.push('你可以调用工具查阅项目中的角色卡、世界书条目、章节内容和场景上下文。');
    p.push('- search_reference: 搜索参考资料（角色/世界书/章节/记忆）');
    p.push('- get_reference_detail: 按ID读取某条资料的详细内容');
    p.push('- get_scene_context: 获取当前写作场景的上下文');
    p.push('当你不确定人物设定、世界观规则或前文情节时，优先查工具，不要猜测。');
    p.push('');
    if (ctx.novelTitle) p.push(`书名: ${ctx.novelTitle}`);
    if (ctx.chapterTitle) p.push(`当前章节: ${ctx.chapterTitle}`);
    if (ctx.currentText) p.push(`\n当前章节末尾:\n${ctx.currentText.slice(-500)}`);
    return p.join('\n');
}

// POST /api/chat/write — 续写模式 (酒馆风格)
router.post('/write', async (req, res) => {
    const requestController = createRequestAbortController(req, res);
    try {
        const { message, history, context, config, promptTemplates, promptOrder, presetName, importConfig } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        setupSse(res);
        const generated = await generateWritingStream({
            message,
            history,
            context: importConfig ? { ...(context || {}), importConfig } : (context || {}),
            config: { ...aiConfig, stream: true },
            promptTemplates,
            promptOrder,
            signal: requestController.signal,
            onEvent: event => sendSse(res, event),
            onPromptBuilt: prompt => captureWritingPrompt(aiConfig, prompt),
        });
        sendSse(res, {
            type: 'meta',
            context: generated.context,
            memory: generated.memory,
            contextDebug: generated.prompt.debug,
        });
        sendSse(res, { type: 'done', reply: generated.reply });
        res.end();
    } catch (err) {
        if (err.name === 'AbortError' && requestController.signal.aborted) return;
        console.error('[Chat Write]', err.message);
        streamError(res, err);
    }
});

// POST /api/chat/infill — Fill the selected gap between before/after prose.
router.post('/infill', async (req, res) => {
    const requestController = createRequestAbortController(req, res);
    try {
        const {
            beforeText = '',
            afterText = '',
            instruction = '',
            lengthMode = 'medium',
            context,
            config,
            promptTemplates,
            promptOrder,
            presetName,
        } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!instruction?.trim()) return res.status(400).json({ error: 'instruction is required' });
        if (!beforeText?.trim() && !afterText?.trim()) return res.status(400).json({ error: 'beforeText or afterText is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        const message = buildInfillUserMessage({ beforeText, afterText, instruction, lengthMode });
        const generated = await generateWriting({
            message,
            history: [],
            context: {
                ...(context || {}),
                taskMode: 'infill',
                beforeText,
                afterText,
            },
            config: aiConfig,
            promptTemplates,
            promptOrder,
            signal: requestController.signal,
            onPromptBuilt: prompt => captureWritingPrompt(aiConfig, prompt),
        });

        res.json({
            reply: cleanInfillReply(generated.reply),
            context: generated.context,
            memory: generated.memory,
            contextDebug: generated.prompt.debug,
        });
    } catch (err) {
        if (err.name === 'AbortError' && requestController.signal.aborted) return;
        console.error('[Chat Infill]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/chat/import-data — 前端检测到AI输出的JSON后，调用此接口导入数据
router.post('/import-data', async (req, res) => {
    try {
        const { name, args, novelId } = req.body;
        if (!name || !args) return res.status(400).json({ error: 'name and args required' });
        if (name !== 'import_data') return res.status(400).json({ error: 'unsupported tool' });
        const result = await executeTool(name, args, novelId || '');
        res.json(result);
    } catch (err) {
        console.error('[Chat ImportData]', err.message);
        res.status(500).json({ error: err.message });
    }
});

function createRequestAbortController(req, res) {
    const controller = new AbortController();
    const abort = () => {
        if (!controller.signal.aborted) controller.abort();
    };
    req.once('aborted', abort);
    res.once('close', () => {
        if (!res.writableEnded) abort();
    });
    return controller;
}

function captureWritingPrompt(config, prompt) {
    capturePrompt({
        provider: config.provider,
        model: config.model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens ?? 4096,
        topP: config.topP ?? 0.9,
        systemPrompt: prompt.systemPrompt,
        userPrompt: JSON.stringify({ messages: prompt.messages, context: prompt.debug }),
    });
}

function buildInfillUserMessage({ beforeText, afterText, instruction, lengthMode }) {
    const lengthText = {
        short: '短：约 200-500 字，快速过渡。',
        medium: '适中：约 500-1000 字，补足动作、心理和场景衔接。',
        long: '详细：约 1000-1800 字，展开描写但不要拖沓。',
    }[lengthMode] || '适中：约 500-1000 字。';
    return [
        '任务：补写小说中段。',
        '',
        '要求：',
        '- 只输出需要填入中间空缺的正文，不要重复前文或后文。',
        '- 必须自然承接前文，并能无缝接到后文。',
        '- 不改写前文和后文已经确定的事实。',
        '- 按作者要求完成中间发生的内容。',
        '- 输出中文小说正文，不要解释，不要列提纲，不要加标题。',
        `- 长度：${lengthText}`,
        '',
        `【前文】\n${beforeText || '(无)'}`,
        '',
        `【中间要补】\n${instruction}`,
        '',
        `【后文】\n${afterText || '(无)'}`,
    ].join('\n');
}

function cleanInfillReply(reply = '') {
    return String(reply)
        .replace(/^```(?:\w+)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
}

// ==================== System Prompts ====================

function buildAssistSystemPrompt(ctx) {
    const p = [];
    p.push('你是 催更姬 的「设定制作」向导，专门帮助作者创建角色卡和世界书。');
    p.push('');
    p.push('## 你的工作方式');
    p.push('采用启发式引导：顺着作者的思路逐步深入，每次只问 1-2 个最关键的问题。');
    p.push('');
    p.push('## ⚠️ 关键：用户可见结果 + 工具导入必须同时完成');
    p.push('');
    p.push('用户说「导出」「输出角色卡」「生成卡片」「生成 JSON」「保存」「创建」「导入」或你已收集到足够信息时：');
    p.push('1. 先在回复正文里给用户展示制作好的结果，包含名称、核心设定和完整 JSON 代码块。');
    p.push('2. 同一轮必须调用 import_data 工具，把这份数据写入当前项目。');
    p.push('3. 工具调用成功后，继续用简短中文告诉用户已导入，以及导入到了角色、世界书或预设。');
    p.push('');
    p.push('⚠️ 不要只描述不保存，也不要只调用工具不展示。用户需要看见成品，项目也需要同步落盘。');
    p.push('');
    p.push('## 角色卡 JSON 格式（严格按此模板）：');
    p.push('```json');
    p.push('{');
    p.push('  "name": "角色名",');
    p.push('  "summary": "约50字，面向正文写作注入的角色短摘要，写清身份、关系、当前状态或关键矛盾",');
    p.push('  "description": "外貌与身份描述（50-150字）",');
    p.push('  "personality": "性格（对比式：表面上...但实际上...）",');
    p.push('  "scenario": "背景处境",');
    p.push('  "first_mes": "用角色口吻写的第一句话",');
    p.push('  "mes_example": "<START>\\n{{char}}: 示例对话\\n{{user}}: 示例回应",');
    p.push('  "tags": ["标签1", "标签2"]');
    p.push('}');
    p.push('```');
    p.push('');
    p.push('## 世界书条目 JSON 格式（严格按此模板）：');
    p.push('```json');
    p.push('{');
    p.push('  "comment": "条目名称",');
    p.push('  "key": ["触发词1", "触发词2"],');
    p.push('  "summary": "约50字，面向正文写作注入的设定短摘要，写清规则、限制、关系或剧情影响",');
    p.push('  "content": "注入的设定内容（100-200字）",');
    p.push('  "depth": 4,');
    p.push('  "order": 100,');
    p.push('  "constant": false');
    p.push('}');
    p.push('```');
    p.push('如需一次创建多条世界书，用数组：');
    p.push('```json');
    p.push('[');
    p.push('  {"comment":"条目1","key":["触发词"],"summary":"约50字短摘要","content":"..."},');
    p.push('  {"comment":"条目2","key":["触发词"],"summary":"约50字短摘要","content":"..."}');
    p.push(']');
    p.push('```');
    p.push('');
    p.push('## 重要规则');
    p.push('- 收集到足够信息后**立即展示 JSON 并调用 import_data**，不要等多轮');
    p.push('- JSON 必须完整、合法，字段名用英文，值用中文');
    p.push('- 角色卡和世界书条目必须包含 summary 字段；summary 不是营销简介，而是给正文续写注入用的短事实摘要');
    p.push('- 调用 import_data 时，target 必须是 character、worldbook 或 preset');
    p.push('- character 的 data 使用角色卡对象；worldbook 的 data 可用单条、数组或 {entries:[...]}；preset 的 data 必须带 name');
    p.push('- 保持对话感，每个回答末尾用**粗体**问下一个问题');
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

function parseToolArguments(raw = '{}') {
    try {
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
}

// Kept temporarily for migration comparison with preset-orchestrator.
// eslint-disable-next-line no-unused-vars
function buildWriteSystemPrompt(ctx, templates, memoryText, authorContext, novelMemoryText) {
    const p = [];

    // L1: Author profile first
    if (authorContext) p.push(authorContext);

    // L2: Novel project memory
    if (novelMemoryText) p.push(novelMemoryText);

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

// eslint-disable-next-line no-unused-vars
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
