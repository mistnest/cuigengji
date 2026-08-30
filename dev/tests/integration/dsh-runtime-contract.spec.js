import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
    prepareDshLaunch,
    refreshDshProjectContext,
} from '../../../electron/intelligence/agent/dsh/dsh-supervisor.js';
import {
    clearAiSecretProtection,
    configureAiSecretProtection,
    saveAiSecret,
} from '../../../src/backend/foundation/configuration/index.js';
import {
    createChapter,
    createProject,
    saveWorkspace,
    updateChapter,
} from '../../../src/backend/domains/project/index.js';
import {
    createDshSession,
    dshRpc,
    messageText,
    openDshMux,
    startDshContractRuntime,
    startMockDeepSeekProvider,
    textResponseFrames,
    toolResponseFrames,
    waitForDshHistory,
} from '../helpers/dsh-contract-runtime.js';

test.setTimeout(120_000);

test('@integration real DSH request keeps exact read-only tools and hot context', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigenji-dsh-contract-'));
    const previousDataRoot = globalThis.DATA_ROOT;
    let provider;
    let runtime;
    let mux;
    try {
        globalThis.DATA_ROOT = path.join(root, 'data');
        configureAiSecretProtection({
            encrypt: value => Buffer.from(value, 'utf8').toString('base64'),
            decrypt: value => Buffer.from(value, 'base64').toString('utf8'),
        });
        provider = await startMockDeepSeekProvider(body => {
            const messages = Array.isArray(body.messages) ? body.messages : [];
            const latestHumanPrompt = messages.findLast(message => (
                message.role === 'user'
                && !messageText(message).startsWith('Current runtime context.')
            ));
            const latestHumanText = messageText(latestHumanPrompt);
            if (latestHumanText.includes('慢速取消')) {
                return {
                    frames: [{ choices: [{ index: 0, delta: { content: '尚未完成' } }] }],
                    holdOpen: true,
                };
            }
            if (latestHumanText.includes('慢速排队')) {
                return {
                    frames: textResponseFrames('排队前一轮完成。'),
                    delayBeforeFramesMs: 400,
                };
            }
            if (latestHumanText.includes('慢速转向')) {
                return {
                    frames: textResponseFrames('转向前步骤完成。'),
                    delayBeforeFramesMs: 400,
                };
            }
            if (latestHumanText.includes('Provider错误')) {
                return {
                    statusCode: 401,
                    json: { error: { message: 'contract provider rejected the request' } },
                };
            }
            const toolPromptIndex = messages.findLastIndex(message => (
                message.role === 'user' && messageText(message).includes('工具验证')
            ));
            const lastToolIndex = messages.findLastIndex(message => message.role === 'tool');
            if (toolPromptIndex >= 0 && lastToolIndex < toolPromptIndex) {
                return {
                    frames: toolResponseFrames('search_project_knowledge', {
                        query: '星港',
                        kind: 'all',
                    }),
                };
            }
            return {
                frames: textResponseFrames('契约验证完成。', {
                    reasoning: '先核对项目上下文。',
                }),
            };
        });

        const project = await createProject({ title: 'DSH契约验证项目' });
        const chapter = await createChapter(project.id, {
            title: '第一章',
            content: '版本A：林冬在星港北门值守。',
        });
        saveAiSecret({ provider: 'deepseek', apiKey: 'contract-fake-key' });
        await saveWorkspace(project.id, {
            aiConfig: {
                provider: 'deepseek',
                endpoint: 'https://api.deepseek.com/v1',
                model: 'deepseek-v4-flash',
            },
            worldBook: {
                entries: {
                    1: {
                        key: ['星港'],
                        comment: '星港',
                        content: '星港实行永久宵禁。',
                    },
                },
            },
            characters: [{
                data: {
                    name: '林冬',
                    description: '负责守卫星港北门。',
                    tags: ['守卫'],
                },
            }],
        });
        const launch = await prepareDshLaunch({
            userDataRoot: path.join(root, 'runtime'),
            projectId: project.id,
            chapterId: chapter.id,
        });
        launch.env.DEEPSEEK_BASE_URL = provider.baseUrl;
        runtime = await startDshContractRuntime(launch);
        const { sessionId } = await createDshSession(runtime.url, launch);
        mux = openDshMux(runtime.url);
        await mux.ready;

        await dshRpc(runtime.url, 'session.prompt', {
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: '工具验证：请查询星港资料。' }],
            clientTimeZone: 'Asia/Shanghai',
        });
        const firstTurnEnd = await mux.waitFor(frame => (
            frame.type === 'session/event'
            && frame.sessionId === sessionId
            && frame.event?.type === 'turn/end'
        ));
        expect(firstTurnEnd.event.data.reason).toBeTruthy();

        const firstRequest = await provider.waitForRequest(record => Array.isArray(record.body.tools));
        expect(firstRequest.authorization).toBe('Bearer contract-fake-key');
        expect(firstRequest.body.stream).toBe(true);
        expect(
            firstRequest.body.tools,
            `DSH stdout:\n${runtime.stdout}\nDSH stderr:\n${runtime.stderr}`,
        ).toBeDefined();
        expect(firstRequest.body.tools.map(tool => tool.function.name).sort()).toEqual([
            'get_project_knowledge',
            'propose_outline_patch',
            'safe_web_fetch',
            'search_project_knowledge',
            'skill',
            'web_search',
        ]);
        expect(JSON.stringify(firstRequest.body.tools)).not.toMatch(
            /bash|pwsh|shell|"web_fetch"|subagent|write_file/iu,
        );
        expect(JSON.stringify(firstRequest.body.messages)).toContain('story-direction-probe');
        expect(JSON.stringify(firstRequest.body.messages)).toContain('版本A');
        const systemText = firstRequest.body.messages
            .filter(message => message.role === 'system')
            .map(message => messageText(message))
            .join('\n');
        expect(systemText).toContain('催更姬');
        expect(systemText).toContain('唯一项目上下文');
        expect(systemText).toContain('默认给出两个真正不同的方案');
        expect(systemText).toContain('只服务于当前 DSH session');
        expect(systemText).toContain('大纲修改只能形成提案');
        expect(systemText).toContain('可使用 web_search');
        expect(systemText).not.toContain('coding agent');
        expect(systemText).not.toContain('DeepSeek Harness Web GUI');
        expect(systemText).not.toContain('implementation checkout');

        const toolFollowup = await provider.waitForRequest(record => (
            record.body.messages.some(message => message.role === 'tool')
        ));
        expect(JSON.stringify(toolFollowup.body.messages)).toContain('星港');

        const firstHistory = await waitForDshHistory(
            runtime.url,
            sessionId,
            events => events.some(item => item.event.type === 'tool/result')
                && events.some(item => item.event.type === 'assistant/message'),
        );
        const eventTypes = firstHistory.events.map(item => item.event.type);
        expect(eventTypes).toEqual(expect.arrayContaining([
            'turn/start',
            'user/message',
            'step/start',
            'request/header',
            'assistant/chunk',
            'tool/call',
            'tool/result',
            'assistant/message',
            'step/end',
            'turn/end',
        ]));
        const muxSeqs = mux.frames
            .filter(frame => frame.type === 'session/event' && frame.sessionId === sessionId)
            .map(frame => frame.event.seq);
        expect(muxSeqs).toEqual([...muxSeqs].sort((left, right) => left - right));
        expect(new Set(muxSeqs).size).toBe(muxSeqs.length);

        const updated = await updateChapter(project.id, chapter.id, {
            content: '版本B：林冬已经离开星港北门。',
            expectedRevision: chapter.revision,
        });
        await refreshDshProjectContext({
            userDataRoot: path.join(root, 'runtime'),
            projectId: project.id,
            chapterId: updated.id,
        });
        const requestCountBeforeRefreshPrompt = provider.requests.length;
        await dshRpc(runtime.url, 'session.prompt', {
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: '热刷新验证：当前林冬在哪里？' }],
            clientTimeZone: 'Asia/Shanghai',
        });
        const refreshedRequest = await provider.waitForRequest((record, index) => (
            index >= requestCountBeforeRefreshPrompt
            && record.body.messages.some(message => messageText(message).includes('热刷新验证'))
        ));
        const runtimeContexts = refreshedRequest.body.messages
            .filter(message => (
                message.role === 'user'
                && messageText(message).startsWith('Current runtime context.')
            ))
            .map(messageText);
        expect(runtimeContexts.at(-1)).toContain('版本B');
        expect(runtimeContexts.at(-1)).not.toContain('版本A：林冬在星港北门值守');

        await waitForDshHistory(
            runtime.url,
            sessionId,
            events => events.filter(item => item.event.type === 'turn/end').length >= 2,
        );

        const queueRequestStart = provider.requests.length;
        await dshRpc(runtime.url, 'session.prompt', {
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: '慢速排队：先运行这一轮。' }],
            clientTimeZone: 'Asia/Shanghai',
        });
        await provider.waitForRequest((record, index) => (
            index >= queueRequestStart
            && record.body.messages.some(message => messageText(message).includes('慢速排队'))
        ));
        const queued = await dshRpc(runtime.url, 'session.prompt', {
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: '排队继续：前一轮完成后回答。' }],
            clientTimeZone: 'Asia/Shanghai',
        });
        expect(queued).toEqual({ accepted: true });
        await provider.waitForRequest((record, index) => (
            index > queueRequestStart
            && record.body.messages.some(message => messageText(message).includes('排队继续'))
        ));
        await waitForDshHistory(
            runtime.url,
            sessionId,
            events => events.filter(item => item.event.type === 'turn/end').length >= 4,
        );

        const cancelRequestStart = provider.requests.length;
        await dshRpc(runtime.url, 'session.prompt', {
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: '慢速取消：保持这个请求运行。' }],
            clientTimeZone: 'Asia/Shanghai',
        });
        await provider.waitForRequest((record, index) => (
            index >= cancelRequestStart
            && record.body.messages.some(message => messageText(message).includes('慢速取消'))
        ));
        const cancelled = await dshRpc(runtime.url, 'session.cancel', { sessionId });
        expect(cancelled).toEqual({ accepted: true });
        const cancelledHistory = await waitForDshHistory(
            runtime.url,
            sessionId,
            events => events.filter(item => item.event.type === 'turn/end').length >= 5,
        );
        expect(cancelledHistory.events
            .filter(item => item.event.type === 'turn/end')
            .map(item => item.event.data.reason?.kind)).toContain('aborted');

        const steerRequestStart = provider.requests.length;
        await dshRpc(runtime.url, 'session.prompt', {
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: '慢速转向：先开始原方向。' }],
            clientTimeZone: 'Asia/Shanghai',
        });
        await provider.waitForRequest((record, index) => (
            index >= steerRequestStart
            && record.body.messages.some(message => messageText(message).includes('慢速转向'))
        ));
        const steered = await dshRpc(runtime.url, 'session.prompt', {
            sessionId,
            mode: 'steer',
            content: [{ type: 'text', text: '转向后的要求：改为一句话回答。' }],
            clientTimeZone: 'Asia/Shanghai',
        });
        expect(steered).toEqual({ accepted: true });
        const steeredRequest = await provider.waitForRequest((record, index) => (
            index > steerRequestStart
            && record.body.messages.some(message => messageText(message).includes('转向后的要求'))
        ));
        expect(JSON.stringify(steeredRequest.body.messages)).toContain('转向后的要求');
        const finalHistory = await waitForDshHistory(
            runtime.url,
            sessionId,
            events => events.filter(item => item.event.type === 'turn/end').length >= 6,
        );
        expect(JSON.stringify(finalHistory.events)).toContain('转向后的要求');

        const errorRequestStart = provider.requests.length;
        await dshRpc(runtime.url, 'session.prompt', {
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: 'Provider错误：验证失败事件。' }],
            clientTimeZone: 'Asia/Shanghai',
        });
        await provider.waitForRequest((record, index) => (
            index >= errorRequestStart
            && record.body.messages.some(message => messageText(message).includes('Provider错误'))
        ));
        const failedHistory = await waitForDshHistory(
            runtime.url,
            sessionId,
            events => events.filter(item => item.event.type === 'turn/end').length >= 7,
        );
        const failedTurn = failedHistory.events
            .filter(item => item.event.type === 'turn/end')
            .at(-1);
        expect(
            failedTurn.event.data.reason?.kind,
            JSON.stringify(failedHistory.events.slice(-8), null, 2),
        ).toBe('error');
        expect(failedHistory.events.some(item => (
            item.event.type === 'assistant/chunk'
            && item.event.data.chunk?.type === 'finish'
            && item.event.data.chunk?.reason?.kind === 'error'
        ))).toBe(true);
    } finally {
        await mux?.close();
        await runtime?.stop();
        await provider?.close();
        clearAiSecretProtection();
        if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
        else globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
