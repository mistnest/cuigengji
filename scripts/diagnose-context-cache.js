/**
 * 催更姬 — 上下文注入模式对比 + 缓存命中率诊断
 *
 * 用法:
 *   node scripts/diagnose-context-cache.js <projectId> [--call]
 *
 *   --call  实际调用 AI（需要有效的 API Key）
 *   不带参数仅对比两种模式的 prompt 结构
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 动态导入 ESM 模块
async function loadModules() {
    const [
        { buildWritingContext },
        { getModelContext },
        { loadProjectContext },
        { NovelMemory },
    ] = await Promise.all([
        import('../src/services/context-orchestrator.js'),
        import('../src/services/context-manager.js'),
        import('../src/services/project-data.js'),
        import('../src/services/novel-memory.js'),
    ]);
    return { buildWritingContext, getModelContext, loadProjectContext, NovelMemory };
}

function countTokens(text) {
    // 简单估算：中文 ~1.5 token/字，英文 ~0.75 token/字
    const chinese = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
    const other = text.length - chinese;
    return Math.ceil(chinese * 1.5 + other * 0.75);
}

function analyzeCacheStructure(messages) {
    if (!Array.isArray(messages) || !messages.length) return { stableTokens: 0, dynamicTokens: 0, stablePct: 0, breakAt: 0 };

    // Anthropic 缓存的是前缀（从第一条消息到最后一个可缓存的消息）
    // system 消息全部可缓存，user/assistant 交替中，最后一个 user 消息之前的内容可缓存
    let stableMessages = [];
    let dynamicMessages = [];
    let foundBreak = false;

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!foundBreak && msg.role === 'user' && i === messages.length - 1) {
            // 最后一个 user 消息不可缓存（它是触发推理的）
            foundBreak = true;
            dynamicMessages.push(msg);
        } else if (!foundBreak) {
            stableMessages.push(msg);
        } else {
            dynamicMessages.push(msg);
        }
    }

    const stableText = stableMessages.map(m => m.content || '').join('\n');
    const dynamicText = dynamicMessages.map(m => m.content || '').join('\n');
    const stableTokens = countTokens(stableText);
    const dynamicTokens = countTokens(dynamicText);
    const total = stableTokens + dynamicTokens;

    return {
        stableMessages: stableMessages.length,
        dynamicMessages: dynamicMessages.length,
        stableTokens,
        dynamicTokens,
        totalTokens: total,
        stablePct: total ? Math.round((stableTokens / total) * 100) : 0,
        breakAt: stableMessages.length,
    };
}

function analyzeMessageRoles(messages) {
    const counts = {};
    let totalChars = 0;
    for (const msg of messages) {
        counts[msg.role] = (counts[msg.role] || 0) + 1;
        totalChars += (msg.content || '').length;
    }
    return { counts, totalChars, estimatedTokens: countTokens(messages.map(m => m.content || '').join('\n')) };
}

async function main() {
    const projectId = process.argv[2];
    const doCall = process.argv.includes('--call');
    const roundsIdx = process.argv.indexOf('--rounds');
    const rounds = roundsIdx >= 0 ? Number(process.argv[roundsIdx + 1]) || 5 : 5;

    if (!projectId) {
        console.log('用法: node scripts/diagnose-context-cache.js <projectId> [--call]');
        console.log('可用项目:');
        const novelsDir = path.join(PROJECT_ROOT, 'data', 'novels');
        if (fs.existsSync(novelsDir)) {
            for (const d of fs.readdirSync(novelsDir)) {
                const np = path.join(novelsDir, d, 'novel.json');
                if (fs.existsSync(np)) {
                    try {
                        const cfg = JSON.parse(fs.readFileSync(np, 'utf8'));
                        console.log(`  ${d}  →  ${cfg.title || '(无标题)'}`);
                    } catch { console.log(`  ${d}`); }
                }
            }
        }
        process.exit(0);
    }

    const { buildWritingContext, getModelContext, NovelMemory } = await loadModules();

    // ---- 测试上下文 ----
    const novelDir = path.join(PROJECT_ROOT, 'data', 'novels', projectId);
    const novelCfg = JSON.parse(fs.readFileSync(path.join(novelDir, 'novel.json'), 'utf8'));
    console.log(`\n📖 项目: ${novelCfg.title || projectId}`);

    // 加载章节内容
    const chaptersDir = path.join(novelDir, 'chapters');
    const chapterFiles = [];
    function walkChapters(dir) {
        if (!fs.existsSync(dir)) return;
        for (const f of fs.readdirSync(dir)) {
            const fp = path.join(dir, f);
            if (fs.statSync(fp).isDirectory()) { walkChapters(fp); continue; }
            if (f.endsWith('.json')) chapterFiles.push(fp);
        }
    }
    walkChapters(chaptersDir);
    chapterFiles.sort();
    const latestChapter = chapterFiles.length ? JSON.parse(fs.readFileSync(chapterFiles[chapterFiles.length - 1], 'utf8')) : null;
    const allText = chapterFiles.map(f => JSON.parse(fs.readFileSync(f, 'utf8')).content || '').join('\n\n').slice(-8000);

    // 加载世界书和角色
    const worldBook = {};
    const worldsDir = path.join(novelDir, '..', '..', 'worlds');
    if (fs.existsSync(worldsDir)) {
        for (const f of fs.readdirSync(worldsDir)) {
            if (!f.endsWith('.json')) continue;
            try {
                const wb = JSON.parse(fs.readFileSync(path.join(worldsDir, f), 'utf8'));
                if (wb.entries) Object.assign(worldBook, wb.entries);
            } catch {}
        }
    }

    const characters = [];
    const charsDir = path.join(novelDir, '..', '..', 'characters');
    if (fs.existsSync(charsDir)) {
        for (const f of fs.readdirSync(charsDir)) {
            if (!f.endsWith('.json')) continue;
            try { characters.push(JSON.parse(fs.readFileSync(path.join(charsDir, f), 'utf8'))); } catch {}
        }
    }

    // NovelMemory
    const novelMemory = new NovelMemory(projectId);
    const memory = novelMemory.readMemory?.() || {};
    const plotSummary = memory.plotSummary || '';
    const recentPlot = memory.recentPlot || '';

    const baseContext = {
        novelId: projectId,
        novelTitle: novelCfg.title || projectId,
        chapterTitle: latestChapter?.title || '',
        currentText: allText,
        worldBook: { entries: worldBook },
        characters,
        plotSummary,
        recentPlot,
        writingReference: { worldbookMode: 'all', characterMode: 'all', selectedCharacters: [], selectedWorldbookGroups: [] },
    };

    const baseConfig = {
        provider: 'deepseek',
        model: 'deepseek-chat',
        maxTokens: 4096,
        temperature: 0.7,
        stream: false,
        memoryBudget: 25,
    };

    // ---- 测试两种模式 ----
    console.log('\n' + '='.repeat(70));
    console.log('📊 上下文注入模式对比');
    console.log('='.repeat(70));
    console.log(`世界书条目: ${Object.keys(worldBook).length}  角色卡: ${characters.length}`);
    console.log(`章节数: ${chapterFiles.length}  最近正文: ${allText.length} 字符`);

    const modes = [
        { name: 'Native (tool)', config: { ...baseConfig, referenceMode: 'tool', compactReference: true, referenceTools: true } },
        { name: 'ST Compatible', config: { ...baseConfig, referenceMode: 'sillytavern', compactReference: false, referenceTools: false } },
    ];

    for (const mode of modes) {
        console.log(`\n--- ${mode.name} ---`);
        try {
            const result = await buildWritingContext({
                message: '请继续写下一段内容',
                context: { ...baseContext, writingReference: { ...baseContext.writingReference, mode: mode.config.referenceMode } },
                config: mode.config,
            });

            const messages = result.messages || result.chatMessages || [];
            const totalMsgCount = messages.length;
            const cache = analyzeCacheStructure(messages);
            const roleInfo = analyzeMessageRoles(messages);

            console.log(`  消息数: ${totalMsgCount}`);
            console.log(`  角色分布: ${JSON.stringify(roleInfo.counts)}`);
            console.log(`  总估算 tokens: ${roleInfo.estimatedTokens}`);
            console.log(`  ─────────────────`);
            console.log(`  可缓存前缀: ${cache.stableMessages} 条消息, ~${cache.stableTokens} tokens (${cache.stablePct}%)`);
            console.log(`  动态后缀:   ${cache.dynamicMessages} 条消息, ~${cache.dynamicTokens} tokens (${100 - cache.stablePct}%)`);
            console.log(`  缓存断点:   第 ${cache.breakAt} 条消息之后`);
            console.log(`  💰 缓存命中率预估: ${cache.stablePct}%（后续调用复用前缀的比例）`);
        } catch (err) {
            console.log(`  ❌ 构建失败: ${err.message}`);
            if (process.env.DEBUG) console.error(err.stack);
        }
    }

    // ---- 实际 API 调用 ----
    if (doCall) {
        console.log('\n' + '='.repeat(70));
        console.log(`🌐 实际 API 调用测试（各模式跑 ${rounds} 轮）`);
        console.log('='.repeat(70));

        const secretsPath = path.join(PROJECT_ROOT, 'data', 'ai-secrets.json');
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
        const apiKey = secrets.profiles?.__default__?.deepseek || '';
        if (!apiKey) { console.log('❌ 无 API Key，跳过实际调用'); process.exit(0); }

        for (const mode of modes) {
            console.log(`\n--- ${mode.name} (2 轮调用) ---`);
            const result = await buildWritingContext({
                message: '请继续写下一段内容',
                context: { ...baseContext, writingReference: { ...baseContext.writingReference, mode: mode.config.referenceMode } },
                config: mode.config,
            });

            const messages = result.messages || result.chatMessages || [];
            console.log(`  请求消息数: ${messages.length}, 估算 tokens: ${countTokens(messages.map(m => m.content || '').join('\n'))}`);

            for (let round = 1; round <= rounds; round++) {
                const start = Date.now();
                try {
                    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify({
                            model: 'deepseek-chat',
                            messages,
                            max_tokens: 1024,
                            temperature: 0.7,
                            stream: false,
                        }),
                    });
                    const data = await resp.json();
                    const duration = Date.now() - start;
                    const usage = data.usage || {};
                    const cacheHit = usage.prompt_cache_hit_tokens ?? usage.cache_hit_tokens ?? usage.cache_read_input_tokens ?? null;
                    const cacheMiss = usage.prompt_cache_miss_tokens ?? usage.cache_miss_tokens ?? usage.cache_creation_input_tokens ?? null;
                    const cacheStr = cacheHit != null
                        ? `  cache↑${cacheHit} miss${cacheMiss ?? '?'}`
                        : '';
                    console.log(`  第 ${round} 轮: ${resp.status} ${duration}ms  input=${usage.prompt_tokens || '?'}  output=${usage.completion_tokens || '?'}  total=${usage.total_tokens || '?'}${cacheStr}`);
                    if (data.usage && Object.keys(data.usage).length > 3) {
                        console.log(`    📦 usage 详情: ${JSON.stringify(data.usage)}`);
                    }
                    // 检查 response headers 中的缓存标记
                    const cacheHeaders = {};
                    resp.headers.forEach((v, k) => { if (/cache|ratelimit/i.test(k)) cacheHeaders[k] = v; });
                    if (Object.keys(cacheHeaders).length) {
                        console.log(`    📋 缓存头: ${JSON.stringify(cacheHeaders)}`);
                    }
                    if (!resp.ok) console.log(`    ⚠️ ${data.error?.message || JSON.stringify(data)}`);
                    if (data.choices?.[0]?.message?.content) {
                        console.log(`    📝 ${data.choices[0].message.content.slice(0, 80)}...`);
                    }
                } catch (err) {
                    console.log(`  第 ${round} 轮: ❌ ${err.message}`);
                }
            }
        }
    }

    console.log('\n✅ 诊断完成\n');
}

main().catch(err => { console.error(err); process.exit(1); });
