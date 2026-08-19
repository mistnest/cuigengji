import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { createDshGateway } from '../../../electron/intelligence/agent/dsh/dsh-gateway.js';
import { createDshSupervisor } from '../../../electron/intelligence/agent/dsh/dsh-supervisor.js';
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
    messageText,
    startMockDeepSeekProvider,
    textResponseFrames,
} from '../helpers/dsh-contract-runtime.js';

test.setTimeout(120_000);

test('@integration DSH Gateway completes prompt, live events and history without WebContents', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigenji-dsh-gateway-'));
    const previousDataRoot = globalThis.DATA_ROOT;
    const previousDshRoot = process.env.CUIGENGJI_DSH_ROOT;
    let provider;
    let gateway;
    try {
        globalThis.DATA_ROOT = path.join(root, 'data');
        process.env.CUIGENGJI_DSH_ROOT = path.join(root, 'runtime');
        configureAiSecretProtection({
            encrypt: value => Buffer.from(value, 'utf8').toString('base64'),
            decrypt: value => Buffer.from(value, 'base64').toString('utf8'),
        });
        provider = await startMockDeepSeekProvider(body => {
            const prompt = body.messages.findLast(message => (
                message.role === 'user'
                && !messageText(message).startsWith('Current runtime context.')
            ));
            return {
                frames: textResponseFrames(`网关回复：${messageText(prompt)}`, {
                    reasoning: '先核对当前章节。',
                }),
            };
        });
        const project = await createProject({ title: 'Gateway 项目' });
        const chapter = await createChapter(project.id, {
            title: '第一章',
            content: '林冬站在星港北门。',
        });
        saveAiSecret({ provider: 'deepseek', apiKey: 'gateway-fake-key' });
        await saveWorkspace(project.id, {
            aiConfig: {
                provider: 'deepseek',
                endpoint: provider.baseUrl,
                model: 'deepseek-v4-flash',
            },
        });

        const supervisor = createDshSupervisor({
            electronApp: { getPath: () => path.join(root, 'runtime') },
            spawnProcess: spawn,
        });
        gateway = createDshGateway({ supervisor });
        const received = [];
        gateway.subscribe(event => received.push(event));

        const opened = await gateway.openProject({
            projectId: project.id,
            chapterId: chapter.id,
        });
        expect(opened).toMatchObject({
            projectId: project.id,
            status: { kind: 'deepseek-harness', ready: true, hasCredential: true },
            context: { chapterId: chapter.id },
        });
        expect(JSON.stringify(opened)).not.toContain('127.0.0.1');
        expect(JSON.stringify(opened)).not.toContain('gateway-fake-key');

        await gateway.prompt({
            projectId: project.id,
            sessionId: opened.sessionId,
            text: '请概括当前场景。',
            mode: 'queue',
            clientTimeZone: 'Asia/Shanghai',
        });
        await expect.poll(() => received.some(event => (
            event.type === 'turn.completed' && event.sessionId === opened.sessionId
        )), { timeout: 20_000 }).toBe(true);
        expect(received.map(event => event.type)).toEqual(expect.arrayContaining([
            'runtime.state',
            'session.ready',
            'turn.started',
            'message.user',
            'assistant.delta',
            'assistant.completed',
            'turn.completed',
        ]));

        const history = await gateway.getHistory({
            projectId: project.id,
            sessionId: opened.sessionId,
            maxMessages: 30,
        });
        expect(history.events.some(event => (
            event.type === 'assistant.completed' && event.data.text.includes('网关回复')
        ))).toBe(true);
        const sessions = await gateway.listSessions({ projectId: project.id });
        expect(sessions).toEqual(expect.arrayContaining([
            expect.objectContaining({ sessionId: opened.sessionId, active: true }),
        ]));
        await expect(gateway.getHistory({
            projectId: 'other-project',
            sessionId: opened.sessionId,
        })).rejects.toMatchObject({ code: 'AGENT_SESSION_PROJECT_MISMATCH' });
    } finally {
        await gateway?.stop();
        await provider?.close();
        clearAiSecretProtection();
        if (previousDataRoot === undefined) delete globalThis.DATA_ROOT;
        else globalThis.DATA_ROOT = previousDataRoot;
        if (previousDshRoot === undefined) delete process.env.CUIGENGJI_DSH_ROOT;
        else process.env.CUIGENGJI_DSH_ROOT = previousDshRoot;
        await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
