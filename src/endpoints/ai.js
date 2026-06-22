/**
 * 催更姬 — AI Endpoint (with Memory Pipeline)
 *
 * L4+L5: 世界书引擎检索 + Prompt 注入
 *   1. 扫描正文 → 关键词匹配世界书条目
 *   2. 检测出场的角色
 *   3. 注入相关的记忆到 system prompt
 *   4. AI 生成后 → L3 自动提取
 */
import express from 'express';
import fs from 'node:fs/promises';
import { createMemoryManager } from '../services/memory-manager.js';
import { prepareContext } from '../services/context-manager.js';
import { NovelMemory } from '../services/novel-memory.js';
import { getAuthorProfile } from '../services/author-profile.js';
import { applyAiSecret } from '../services/ai-secrets.js';
import { callAIText, fetchModelList } from '../services/ai-client.js';
import { applyAiReferenceSummary, normalizeAiSummary } from '../services/reference-summaries.js';
import { capturePrompt } from './debug.js';
import { projectFile } from '../lib/project-paths.js';
import { writeJson } from '../lib/json-store.js';

export const router = express.Router();

const extractionJobs = new Map();
const EXTRACTION_JOB_LIMIT = 30;
const EXTRACTION_JOB_PROGRESS_LIMIT = 160;

function hasApiKey(config) {
    return !!config?.apiKey || config?.provider === 'ollama';
}

function createExtractionJob({ type, title, novelId = '', range = null }) {
    const id = `extract_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const job = {
        id,
        type,
        title,
        novelId,
        range,
        status: 'queued',
        progress: [],
        current: null,
        result: null,
        summary: '',
        error: '',
        createdAt: now,
        updatedAt: now,
        startedAt: 0,
        finishedAt: 0,
    };
    extractionJobs.set(id, job);
    pruneExtractionJobs();
    return job;
}

function pruneExtractionJobs() {
    const removable = [...extractionJobs.values()]
        .filter(job => !['queued', 'running'].includes(job.status))
        .sort((a, b) => a.updatedAt - b.updatedAt);
    while (extractionJobs.size > EXTRACTION_JOB_LIMIT && removable.length) {
        extractionJobs.delete(removable.shift().id);
    }
}

function updateExtractionJob(job, patch = {}) {
    Object.assign(job, patch, { updatedAt: Date.now() });
    return job;
}

function pushExtractionProgress(job, message, extra = {}) {
    if (!message) return;
    job.progress.push({ time: Date.now(), message, ...extra });
    if (job.progress.length > EXTRACTION_JOB_PROGRESS_LIMIT) {
        job.progress.splice(0, job.progress.length - EXTRACTION_JOB_PROGRESS_LIMIT);
    }
    job.updatedAt = Date.now();
}

function serializeExtractionJob(job, { includeResult = false } = {}) {
    return {
        id: job.id,
        type: job.type,
        title: job.title,
        novelId: job.novelId,
        range: job.range,
        status: job.status,
        current: job.current,
        progress: job.progress.slice(-30),
        summary: job.summary,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        result: includeResult ? job.result : undefined,
    };
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
const SUMMARIZE_PROMPTS = {
    chapter: '你是中文小说长篇记忆编辑。请基于正文事实生成约100字章节摘要，写清本章主要事件、人物行动、状态变化和关键伏笔。重视后续续写会用到的正文信息，不评价文风，不扩写，不输出列表。只输出摘要。',
    worldbook: '你是中文小说设定摘要编辑。请为世界书条目生成约50字短摘要，优先保留能直接影响正文描写、情节因果、人物行动的稳定设定。不要复述字段名、触发词、排序、注入位置或其他软件配置。只输出摘要。',
    character: '你是中文小说角色摘要编辑。请为角色卡生成约50字短摘要，优先保留角色在正文里会体现的身份、关系、动机、能力限制、说话/行动倾向。不要复述字段名或配置说明。只输出摘要。',
};

router.post('/summarize', async (req, res) => {
    try {
        const { text, type, config, presetName } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        const prompt = SUMMARIZE_PROMPTS[type] || SUMMARIZE_PROMPTS.chapter;
        const result = cleanSummaryText(await callAIText(aiConfig, prompt, text, { maxTokens: 400 }));

        res.json({ summary: result });
    } catch (err) {
        console.error('[AI Summarize]', err.message);
        res.status(500).json({ error: err.message });
    }
});

function cleanSummaryText(text = '') {
    return String(text || '')
        .replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/\*\([^)]*未生成正文[^)]*\)\*/g, '')
        .trim();
}

// ==================== Background extraction jobs ====================
router.get('/extract-jobs', (req, res) => {
    pruneExtractionJobs();
    const jobs = [...extractionJobs.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(job => serializeExtractionJob(job));
    res.json({ jobs });
});

router.get('/extract-jobs/:jobId', (req, res) => {
    const job = extractionJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Extraction job not found' });
    res.json({ job: serializeExtractionJob(job, { includeResult: true }) });
});

router.delete('/extract-jobs/:jobId', (req, res) => {
    const existed = extractionJobs.delete(req.params.jobId);
    res.json({ ok: existed });
});

router.post('/extract-jobs', async (req, res) => {
    try {
        const {
            type = 'current',
            text = '',
            novelId = '',
            chapterTitle = '',
            config,
            presetName,
            startOrder = 1,
            endOrder = 50,
            maxChapters = 100,
        } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        if (type === 'current' && !String(text || '').trim()) {
            return res.status(400).json({ error: 'text is required' });
        }
        if (type === 'project' && !novelId) {
            return res.status(400).json({ error: 'novelId is required' });
        }
        if (!['current', 'project'].includes(type)) {
            return res.status(400).json({ error: 'Unknown extraction job type' });
        }

        const job = createExtractionJob({
            type,
            title: type === 'project'
                ? `逐章扫描 ${Number(startOrder)}-${Number(endOrder)}`
                : `当前章节${chapterTitle ? `：${chapterTitle}` : ''}`,
            novelId,
            range: type === 'project'
                ? { startOrder: Number(startOrder), endOrder: Number(endOrder), maxChapters: Number(maxChapters) || 100 }
                : null,
        });
        pushExtractionProgress(job, '任务已创建，等待后台执行。');
        res.status(202).json({ job: serializeExtractionJob(job) });

        setTimeout(() => {
            void runExtractionJob(job, {
                type,
                text: String(text || ''),
                novelId,
                aiConfig,
                chapterTitle,
                startOrder: Number(startOrder),
                endOrder: Number(endOrder),
                maxChapters: Number(maxChapters) || 100,
            }).catch(err => {
                console.error('[AI Extract Job]', err);
                pushExtractionProgress(job, `任务失败：${err.message}`);
                updateExtractionJob(job, {
                    status: 'error',
                    error: err.message,
                    finishedAt: Date.now(),
                });
            });
        }, 0);
    } catch (err) {
        console.error('[AI Extract Job Create]', err.message);
        res.status(500).json({ error: err.message });
    }
});

async function runExtractionJob(job, payload) {
    updateExtractionJob(job, {
        status: 'running',
        startedAt: Date.now(),
    });
    pushExtractionProgress(job, '后台任务已开始。');

    if (payload.type === 'project') {
        await runProjectExtractionJob(job, payload);
    } else {
        await runCurrentExtractionJob(job, payload);
    }
}

async function runCurrentExtractionJob(job, payload) {
    pushExtractionProgress(job, '正在分析当前章节正文。');
    const sysPrompt = buildExtractSystemPrompt();
    const userPrompt = buildExtractUserPrompt(payload.text);
    capturePrompt({ provider: payload.aiConfig.provider, model: payload.aiConfig.model, systemPrompt: sysPrompt, userPrompt });
    const raw = await callAIText(payload.aiConfig, sysPrompt, userPrompt, { maxTokens: 8000 });
    const parsed = parseExtractionResult(raw);
    const result = { ...parsed, rawResponse: raw };
    pushExtractionProgress(job, `当前章节提取完成：角色 ${parsed.characters.length}，世界书 ${parsed.worldEntries.length}。`);
    updateExtractionJob(job, {
        status: 'done',
        result,
        summary: parsed.summary || `提取 ${parsed.characters.length} 个角色、${parsed.worldEntries.length} 条世界书候选。`,
        finishedAt: Date.now(),
    });
}

async function runProjectExtractionJob(job, payload) {
    pushExtractionProgress(job, '正在读取项目章节。');
    const chapters = (await loadExtractionChapters(payload.novelId))
        .filter(chapter => chapter.order >= Number(payload.startOrder) && chapter.order <= Number(payload.endOrder))
        .slice(0, Math.max(1, Math.min(200, Number(payload.maxChapters) || 100)));
    if (!chapters.length) throw new Error('No chapters in selected range');

    updateExtractionJob(job, {
        range: {
            startOrder: Number(payload.startOrder),
            endOrder: Number(payload.endOrder),
            processed: 0,
            total: chapters.length,
        },
    });
    pushExtractionProgress(job, `开始逐章扫描 ${chapters.length} 章。`);

    const aggregate = {
        characters: new Map(),
        worldEntries: new Map(),
        logs: [],
    };

    for (let index = 0; index < chapters.length; index++) {
        const chapter = chapters[index];
        updateExtractionJob(job, {
            current: {
                index: index + 1,
                total: chapters.length,
                title: chapter.title,
                order: chapter.order,
            },
            range: {
                ...job.range,
                processed: index,
            },
        });
        pushExtractionProgress(job, `扫描第 ${index + 1}/${chapters.length} 章：${chapter.title}`);

        const sysPrompt = buildProjectExtractionPrompt();
        const userPrompt = buildProjectExtractionUserPrompt(chapter, aggregate);
        const raw = await callAIText(payload.aiConfig, sysPrompt, userPrompt, { maxTokens: 5000 });
        const parsed = parseExtractionResult(raw);
        await persistChapterAiSummary(chapter, parsed.chapterSummary);
        mergeProjectExtraction(aggregate, parsed, chapter);

        const log = {
            chapter: chapter.title,
            order: chapter.order,
            characters: parsed.characters.length,
            worldEntries: parsed.worldEntries.length,
            summary: parsed.summary || '',
            chapterSummary: parsed.chapterSummary?.brief || '',
        };
        aggregate.logs.push(log);
        pushExtractionProgress(job, `完成：${chapter.title}（角色 ${log.characters}，世界书 ${log.worldEntries}）`);
    }

    const characters = [...aggregate.characters.values()].map(normalizeAggregatedCharacter);
    const worldEntries = [...aggregate.worldEntries.values()].map(normalizeAggregatedWorldEntry);
    const summary = `逐章扫描 ${chapters.length} 章，提取 ${characters.length} 个角色、${worldEntries.length} 条世界书候选。`;
    updateExtractionJob(job, {
        status: 'done',
        current: null,
        range: {
            ...job.range,
            processed: chapters.length,
            total: chapters.length,
        },
        result: {
            mode: 'project',
            range: {
                startOrder: Number(payload.startOrder),
                endOrder: Number(payload.endOrder),
                processed: chapters.length,
            },
            characters,
            worldEntries,
            extractionLog: aggregate.logs,
            summary,
        },
        summary,
        finishedAt: Date.now(),
    });
}

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

// ==================== POST /extract-project — 逐章提取项目级角色与世界书 ====================
router.post('/extract-project', async (req, res) => {
    try {
        const {
            novelId,
            config,
            presetName,
            startOrder = 1,
            endOrder = 50,
            maxChapters = 100,
        } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });
        if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });

        const chapters = (await loadExtractionChapters(novelId))
            .filter(chapter => chapter.order >= Number(startOrder) && chapter.order <= Number(endOrder))
            .slice(0, Math.max(1, Math.min(200, Number(maxChapters) || 100)));
        if (!chapters.length) return res.status(400).json({ error: 'No chapters in selected range' });

        const aggregate = {
            characters: new Map(),
            worldEntries: new Map(),
            logs: [],
        };

        for (const chapter of chapters) {
            const sysPrompt = buildProjectExtractionPrompt();
            const userPrompt = buildProjectExtractionUserPrompt(chapter, aggregate);
            const raw = await callAIText(aiConfig, sysPrompt, userPrompt, { maxTokens: 5000 });
            const parsed = parseExtractionResult(raw);
            await persistChapterAiSummary(chapter, parsed.chapterSummary);
            mergeProjectExtraction(aggregate, parsed, chapter);
            aggregate.logs.push({
                chapter: chapter.title,
                order: chapter.order,
                characters: parsed.characters.length,
                worldEntries: parsed.worldEntries.length,
                summary: parsed.summary || '',
                chapterSummary: parsed.chapterSummary?.brief || '',
            });
        }

        const characters = [...aggregate.characters.values()].map(normalizeAggregatedCharacter);
        const worldEntries = [...aggregate.worldEntries.values()].map(normalizeAggregatedWorldEntry);
        res.json({
            mode: 'project',
            range: {
                startOrder: Number(startOrder),
                endOrder: Number(endOrder),
                processed: chapters.length,
            },
            characters,
            worldEntries,
            extractionLog: aggregate.logs,
            summary: `逐章扫描 ${chapters.length} 章，提取 ${characters.length} 个角色、${worldEntries.length} 条世界书候选。`,
        });
    } catch (err) {
        console.error('[AI Project Extract]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==================== POST /extract-project-stream — 流式逐章提取项目级设定 ====================
router.post('/extract-project-stream', async (req, res) => {
    setupSse(res);
    let aborted = false;
    res.once('close', () => {
        if (!res.writableEnded) aborted = true;
    });
    try {
        const {
            novelId,
            config,
            presetName,
            startOrder = 1,
            endOrder = 50,
            maxChapters = 100,
        } = req.body;
        const aiConfig = applyAiSecret(config, presetName);
        sendSse(res, { type: 'accepted', message: '已连接，正在读取章节...' });
        if (!novelId) {
            sendSse(res, { type: 'error', message: 'novelId is required' });
            return res.end();
        }
        if (!hasApiKey(aiConfig)) {
            sendSse(res, { type: 'error', message: 'API key required' });
            return res.end();
        }

        const chapters = (await loadExtractionChapters(novelId))
            .filter(chapter => chapter.order >= Number(startOrder) && chapter.order <= Number(endOrder))
            .slice(0, Math.max(1, Math.min(200, Number(maxChapters) || 100)));
        if (!chapters.length) {
            sendSse(res, { type: 'error', message: 'No chapters in selected range' });
            return res.end();
        }

        const aggregate = {
            characters: new Map(),
            worldEntries: new Map(),
            logs: [],
        };
        sendSse(res, {
            type: 'start',
            total: chapters.length,
            startOrder: Number(startOrder),
            endOrder: Number(endOrder),
        });

        for (let index = 0; index < chapters.length; index++) {
            if (aborted) return;
            const chapter = chapters[index];
            sendSse(res, {
                type: 'chapter_start',
                index: index + 1,
                total: chapters.length,
                title: chapter.title,
                order: chapter.order,
            });
            const sysPrompt = buildProjectExtractionPrompt();
            const userPrompt = buildProjectExtractionUserPrompt(chapter, aggregate);
            const raw = await callAIText(aiConfig, sysPrompt, userPrompt, { maxTokens: 5000 });
            const parsed = parseExtractionResult(raw);
            await persistChapterAiSummary(chapter, parsed.chapterSummary);
            mergeProjectExtraction(aggregate, parsed, chapter);
            const characters = [...aggregate.characters.values()].map(normalizeAggregatedCharacter);
            const worldEntries = [...aggregate.worldEntries.values()].map(normalizeAggregatedWorldEntry);
            const log = {
                chapter: chapter.title,
                order: chapter.order,
                characters: parsed.characters.length,
                worldEntries: parsed.worldEntries.length,
                summary: parsed.summary || '',
                chapterSummary: parsed.chapterSummary?.brief || '',
            };
            aggregate.logs.push(log);
            sendSse(res, {
                type: 'chapter_done',
                index: index + 1,
                total: chapters.length,
                title: chapter.title,
                order: chapter.order,
                characters: parsed.characters.length,
                worldEntries: parsed.worldEntries.length,
                cumulativeCharacters: characters.length,
                cumulativeWorldEntries: worldEntries.length,
                summary: parsed.summary || '',
                chapterSummary: parsed.chapterSummary?.brief || '',
            });
        }

        const characters = [...aggregate.characters.values()].map(normalizeAggregatedCharacter);
        const worldEntries = [...aggregate.worldEntries.values()].map(normalizeAggregatedWorldEntry);
        sendSse(res, {
            type: 'done',
            mode: 'project',
            range: {
                startOrder: Number(startOrder),
                endOrder: Number(endOrder),
                processed: chapters.length,
            },
            characters,
            worldEntries,
            extractionLog: aggregate.logs,
            summary: `逐章扫描 ${chapters.length} 章，提取 ${characters.length} 个角色、${worldEntries.length} 条世界书候选。`,
        });
        res.end();
    } catch (err) {
        console.error('[AI Project Extract Stream]', err.message);
        sendSse(res, { type: 'error', message: err.message });
        res.end();
    }
});

function buildExtractSystemPrompt() {
    return `## 角色
你是“催更姬”的小说设定提取与长篇记忆整理助手。你的任务是从当前章节正文中提取可复用的角色卡、世界书条目，并生成本章摘要。

## 提取原则
- 只根据正文已经出现或明确确认的信息提取，不脑补后续设定。
- 优先提取会影响后续续写的内容：身份关系、行动动机、能力限制、稳定规则、地点/组织/物品的作用。
- 不要把单章剧情流水账写成世界书；世界书应是后续可复用的稳定设定。
- 不要提取或复述软件配置字段，例如排序、扫描深度、注入位置、激活概率、触发关键词、次级关键词。
- 摘要服务于正文写作和资料工具检索，要保留可定位的实体、关系、规则、场景事实，而不是写成评论。

## 角色提取规则
- 只提取有明确名字的出场角色
- description 写身份、外貌差异特征、已知经历或能力，避免华丽比喻
- personality 从角色言行推断，写行动倾向，不堆形容词
- scenario 写本章中角色所处状态或首次出场场景
- summary 约50字，保留后续写作最需要记住的正文信息

## 世界观提取规则
- 只提取稳定设定：地点、组织/势力、规则/机制、重要物品、专有术语、长期剧情线索
- content 写成可编辑的正文设定说明，避免字段说明和元信息
- summary 约50字，保留影响正文描写、情节因果或人物行动的核心事实
- key 只放2-4个正文里真实会出现的检索词，不要为了软件字段凑关键词
- group 使用用户可理解的自然分组，如“人物关系”“地点”“组织”“规则”“物品”“剧情线”

## 输出格式（严格JSON，不输出其他文字）
{
  "characters": [
    {
      "name": "角色名",
      "summary": "约50字，正文写作可直接参考的角色短摘要",
      "description": "身份、外貌差异特征、能力或已知经历，60-160字",
      "personality": "性格与行动倾向，20-80字",
      "scenario": "当前处境或首次出场场景，30-100字",
      "first_mes": "一句角色口吻的发言",
      "group": "分组建议"
    }
  ],
  "worldEntries": [
    {
      "comment": "条目名称",
      "summary": "约50字，正文写作可直接参考的设定短摘要",
      "key": ["正文检索词1", "正文检索词2"],
      "content": "可编辑的稳定设定说明，100-220字",
      "group": "自然分组建议"
    }
  ],
  "chapterSummary": {
    "brief": "约100字章节摘要，写清主要事件、人物行动、状态变化和伏笔",
    "keyEvents": ["关键事件"],
    "characters": ["本章重要角色"],
    "worldFacts": ["本章新增或确认的稳定设定"],
    "openThreads": ["未解决伏笔或待续线索"],
    "continuityNotes": ["续写时必须保持一致的细节"]
  },
  "summary": "一句话概括提取结果"
}`;
}

function buildExtractUserPrompt(text) {
    const maxLen = 12000;
    const scanText = text.length > maxLen ? text.slice(0, maxLen) + '\n\n…[后续内容省略]…' : text;
    return [
        '请分析以下当前章节正文，提取可复用角色、世界书条目，并生成章节摘要。',
        '注意：摘要和条目都要服务后续正文写作；不要输出软件配置说明。',
        '',
        '【小说正文】',
        scanText,
    ].join('\n');
}

async function loadExtractionChapters(novelId) {
    const root = projectFile(novelId, 'chapters');
    const chapters = [];
    async function visit(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        for (const entry of entries) {
            const full = `${dir}/${entry.name}`;
            if (entry.isDirectory()) {
                await visit(full);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('vol_')) continue;
            try {
                const chapter = JSON.parse(await fs.readFile(full, 'utf8'));
                if (!chapter || chapter.type === 'volume') continue;
                chapters.push({
                    id: chapter.id || '',
                    title: chapter.title || entry.name.replace(/\.json$/i, ''),
                    order: Number(chapter.order || 0),
                    content: chapter.content || '',
                    summary: chapter.summary || '',
                    notes: chapter.notes || '',
                    filePath: full,
                });
            } catch {}
        }
    }
    await visit(root);
    return chapters.sort((a, b) =>
        Number(a.order || 0) - Number(b.order || 0)
        || a.title.localeCompare(b.title, 'zh-CN')
    );
}

function buildProjectExtractionPrompt() {
    return `## 角色
你是“催更姬”的项目级设定库维护助手。你会按章节顺序阅读正文，持续创建或更新角色卡、世界书条目，并为每章生成长篇记忆摘要。

## 任务边界
- 只根据当前章节正文和已有设定索引判断，不要创造正文中没有的信息。
- 已有角色/世界书只是补充信息时，输出同名条目用于合并；不要换名重建。
- 角色优先提取反复出现、推动剧情、后续续写需要记住的人物。
- 世界书优先提取稳定规则、机制、地点、组织、重要物品、长期剧情线索。
- 不要把单章剧情流水账写成世界书；世界书应是后续可复用的稳定设定。
- 每章都必须输出 chapterSummary，即使本章没有新增角色或世界书。
- 不要输出或强调软件配置字段：排序、扫描深度、注入位置、激活概率、触发关键词、次级关键词。
- summary 字段用于 native 注入和资料工具检索，必须更重视正文事实、实体关系、规则限制和状态变化。
- 对不确定内容保持简短，避免脑补。

## 输出格式
严格输出 JSON，不要输出解释文字、Markdown 或代码块：
{
  "characters": [
    {
      "name": "角色名",
      "summary": "约50字，正文写作可直接参考的角色短摘要",
      "description": "身份、能力、外观或已知经历，60-160字",
      "personality": "性格与行动倾向，20-80字",
      "scenario": "截至本章的状态，30-100字",
      "first_mes": "一句角色口吻的发言",
      "group": "自然分组建议"
    }
  ],
  "worldEntries": [
    {
      "comment": "条目名称",
      "summary": "约50字，正文写作可直接参考的设定短摘要",
      "key": ["正文检索词", "正文检索词"],
      "content": "稳定设定说明，100-220字",
      "group": "自然分组建议"
    }
  ],
  "chapterSummary": {
    "brief": "约100字章节摘要，写清主要事件、人物行动和状态变化",
    "keyEvents": ["关键事件"],
    "characters": ["本章重要角色"],
    "worldFacts": ["本章新增或确认的稳定设定"],
    "openThreads": ["未解决伏笔或待续线索"],
    "continuityNotes": ["续写时必须保持一致的细节"]
  },
  "summary": "本章提取结果一句话概括"
}`;
}

function buildProjectExtractionUserPrompt(chapter, aggregate) {
    const existingCharacters = [...aggregate.characters.values()]
        .slice(0, 30)
        .map(character => `- ${character.name}: ${compactLine(character.summary || character.description || character.scenario || '', 90)}`)
        .join('\n') || '（暂无）';
    const existingWorldEntries = [...aggregate.worldEntries.values()]
        .slice(0, 40)
        .map(entry => `- ${entry.comment}: ${compactLine(entry.summary || entry.content || '', 90)}`)
        .join('\n') || '（暂无）';
    const body = chapter.content.length > 14000
        ? `${chapter.content.slice(0, 9000)}\n\n...[中段省略]...\n\n${chapter.content.slice(-5000)}`
        : chapter.content;
    return [
        `当前处理章节：${chapter.title}`,
        `章节顺序：${chapter.order}`,
        '请基于本章正文更新设定库。已有索引用于同名合并和避免重复，不是正文依据。',
        '',
        '【已有角色索引】',
        existingCharacters,
        '',
        '【已有世界书索引】',
        existingWorldEntries,
        '',
        '【本章正文】',
        body,
    ].join('\n');
}

function mergeProjectExtraction(aggregate, parsed, chapter) {
    for (const character of parsed.characters || []) {
        const name = String(character.name || '').trim();
        if (!name) continue;
        const key = normalizeExtractKey(name);
        const existing = aggregate.characters.get(key) || {
            name,
            summary: '',
            description: '',
            personality: '',
            scenario: '',
            first_mes: '',
            group: '',
            sources: [],
        };
        existing.summary = mergeField(existing.summary, character.summary, 160);
        existing.description = mergeField(existing.description, character.description);
        existing.personality = mergeField(existing.personality, character.personality);
        existing.scenario = mergeField(existing.scenario, character.scenario);
        existing.first_mes = existing.first_mes || character.first_mes || '';
        existing.group = existing.group || character.group || '';
        existing.sources.push({ chapter: chapter.title, order: chapter.order });
        aggregate.characters.set(key, existing);
    }

    for (const entry of parsed.worldEntries || []) {
        const comment = String(entry.comment || entry.key?.[0] || '').trim();
        if (!comment) continue;
        const key = normalizeExtractKey(comment);
        const existing = aggregate.worldEntries.get(key) || {
            comment,
            summary: '',
            key: [],
            content: '',
            group: '',
            sources: [],
        };
        existing.key = uniqueStrings([...(existing.key || []), ...(entry.key || [])]).slice(0, 8);
        existing.summary = mergeField(existing.summary, entry.summary, 160);
        existing.content = mergeField(existing.content, entry.content);
        existing.group = existing.group || entry.group || '';
        existing.sources.push({ chapter: chapter.title, order: chapter.order });
        aggregate.worldEntries.set(key, existing);
    }
}

function normalizeAggregatedCharacter(character) {
    return {
        name: character.name,
        summary: compactLine(character.summary, 120),
        description: compactLine(character.description, 280),
        personality: compactLine(character.personality, 160),
        scenario: compactLine(character.scenario, 180),
        first_mes: character.first_mes || '',
        group: character.group || '',
        sources: uniqueSources(character.sources),
    };
}

function normalizeAggregatedWorldEntry(entry) {
    return {
        comment: entry.comment,
        summary: compactLine(entry.summary, 120),
        key: uniqueStrings(entry.key || []).slice(0, 8),
        content: compactLine(entry.content, 360),
        group: entry.group || '',
        sources: uniqueSources(entry.sources),
    };
}

function mergeField(oldValue = '', newValue = '', maxLen = 500) {
    const oldText = compactLine(oldValue, maxLen);
    const newText = compactLine(newValue, maxLen);
    if (!newText) return oldText;
    if (!oldText) return newText;
    if (oldText.includes(newText) || newText.includes(oldText)) return oldText.length >= newText.length ? oldText : newText;
    return compactLine(`${oldText}；${newText}`, maxLen);
}

function compactLine(value = '', maxLen = 200) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function normalizeExtractKey(value = '') {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function uniqueStrings(values = []) {
    return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function uniqueSources(sources = []) {
    const seen = new Set();
    return sources.filter(source => {
        const key = `${source.order}:${source.chapter}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function persistChapterAiSummary(chapter, aiSummary) {
    const normalized = normalizeAiSummary(aiSummary);
    if (!chapter?.filePath || !normalized.brief) return false;
    try {
        const current = JSON.parse(await fs.readFile(chapter.filePath, 'utf8'));
        const next = applyAiReferenceSummary('chapter', current, normalized);
        if (!next.changed) return false;
        await writeJson(chapter.filePath, next.item);
        chapter.summary = next.item.summary || '';
        chapter.aiSummary = next.item.aiSummary;
        chapter.summaryGenerator = next.item.summaryGenerator;
        return true;
    } catch (err) {
        console.warn('[AI Project Extract] Failed to persist chapter summary:', err.message);
        return false;
    }
}

function parseExtractionResult(raw) {
    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { characters: [], worldEntries: [], summary: '未能解析AI输出' };
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            characters: Array.isArray(parsed.characters) ? parsed.characters : [],
            worldEntries: Array.isArray(parsed.worldEntries) ? parsed.worldEntries : [],
            chapterSummary: normalizeAiSummary(parsed.chapterSummary || parsed.chapter_summary || parsed.aiSummary || ''),
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
