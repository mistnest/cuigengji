import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { prepareDshLaunch } from '../../../electron/intelligence/agent/dsh/dsh-supervisor.js';
import {
    clearAiSecretProtection,
    configureAiSecretProtection,
    saveAiSecret,
} from '../../../src/backend/foundation/configuration/index.js';
import {
    createChapter,
    createProject,
    saveWorkspace,
} from '../../../src/backend/domains/project/index.js';
import {
    createDshSession,
    dshRpc,
    openDshMux,
    startDshContractRuntime,
    startMockDeepSeekProvider,
    textResponseFrames,
} from '../helpers/dsh-contract-runtime.js';

test.setTimeout(120_000);

test('@integration DSH Agent uses the selected OpenAI-compatible provider', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigenji-dsh-multi-provider-'));
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
        provider = await startMockDeepSeekProvider(() => ({
            frames: textResponseFrames('OpenAI 兼容 Agent 已连接。'),
        }));
        const project = await createProject({ title: '多模型 Agent 验证' });
        const chapter = await createChapter(project.id, {
            title: '第一章', content: '林冬站在北门。',
        });
        saveAiSecret({ provider: 'openai', apiKey: 'openai-fake-key' });
        await saveWorkspace(project.id, {
            aiConfig: {
                provider: 'openai',
                endpoint: provider.baseUrl,
                model: 'gpt-4o',
            },
        });
        const launch = await prepareDshLaunch({
            userDataRoot: path.join(root, 'runtime'),
            projectId: project.id,
            chapterId: chapter.id,
        });
        expect(launch.hasCredential).toBe(true);
        expect(launch.env.CUIGENGJI_AGENT_API_KEY).toBe('openai-fake-key');
        expect(launch.env).not.toHaveProperty('DEEPSEEK_API_KEY');
        expect(await fs.readFile(launch.patchFile, 'utf8')).not.toContain('openai-fake-key');

        runtime = await startDshContractRuntime(launch);
        const { sessionId } = await createDshSession(runtime.url, launch);
        mux = openDshMux(runtime.url);
        await mux.ready;
        await dshRpc(runtime.url, 'session.prompt', {
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: '请确认多模型 Agent 链路。' }],
            clientTimeZone: 'Asia/Shanghai',
        });
        await mux.waitFor(frame => (
            frame.type === 'session/event'
            && frame.sessionId === sessionId
            && frame.event?.type === 'turn/end'
        ));

        const request = await provider.waitForRequest(record => Array.isArray(record.body.tools));
        expect(request.authorization).toBe('Bearer openai-fake-key');
        expect(request.body.model).toBe('gpt-4o');
        expect(request.body.tools.map(tool => tool.function.name).sort()).toEqual([
            'get_project_knowledge',
            'propose_outline_patch',
            'safe_web_fetch',
            'search_project_knowledge',
            'skill',
        ]);
        expect(JSON.stringify(request.body.messages)).toContain('当前 Agent 使用非 DeepSeek 模型');
    } finally {
        await mux?.close();
        await runtime?.stop();
        await provider?.close();
        clearAiSecretProtection();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
