import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerAgentIpcHandlers } from '../../../electron/ipc/agent/index.js';
import { AGENT_IPC_CHANNELS } from '../../../shared/desktop-api/agent/index.js';

function createHarness() {
    const registered = new Map();
    const calls = [];
    const sent = [];
    const webContents = {
        mainFrame: {},
        send: (channel, value) => sent.push([channel, value]),
        isDestroyed: () => false,
    };
    const mainWindow = { isDestroyed: () => false, webContents };
    let eventListener;
    const gateway = {
        status: async () => ({ state: 'ready', ready: true, kind: 'deepseek-harness' }),
        openProject: async input => {
            calls.push(['openProject', input]);
            return { projectId: input.projectId, sessionId: 'session-1' };
        },
        listSessions: async input => {
            calls.push(['listSessions', input]);
            return [{ sessionId: 'session-1' }];
        },
        createSession: async input => {
            calls.push(['createSession', input]);
            return { sessionId: 'session-2' };
        },
        activateSession: async input => {
            calls.push(['activateSession', input]);
            return { sessionId: input.sessionId, active: true };
        },
        getHistory: async input => {
            calls.push(['getHistory', input]);
            return { sessionId: input.sessionId, events: [] };
        },
        prompt: async input => {
            calls.push(['prompt', input]);
            return { accepted: true };
        },
        cancel: async input => {
            calls.push(['cancel', input]);
            return { accepted: true };
        },
        refreshContext: async input => {
            calls.push(['refresh', input]);
            return { state: 'ready', refreshed: true };
        },
        restart: async input => {
            calls.push(['restartGateway', input]);
            return { state: 'ready' };
        },
        stop: async () => {
            calls.push(['stopGateway']);
            return { state: 'stopped' };
        },
        subscribe: listener => {
            eventListener = listener;
            return () => {
                eventListener = undefined;
            };
        },
    };
    const dispose = registerAgentIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => registered.set(channel, handler),
            removeHandler: channel => registered.delete(channel),
        },
        getMainWindow: () => mainWindow,
        gateway,
    });
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    return {
        calls,
        dispose,
        event,
        registered,
        sent,
        webContents,
        emit: value => eventListener?.(value),
    };
}

test('@interface Agent IPC keeps DSH process details in the trusted main process', async () => {
    const harness = createHarness();
    const input = { projectId: 'novel-1', chapterId: 'chapter-2' };
    const response = await harness.registered.get(AGENT_IPC_CHANNELS.openProject)(
        harness.event,
        input,
    );

    expect(response).toMatchObject({ ok: true, data: { sessionId: 'session-1' } });
    expect(harness.calls).toEqual([['openProject', input]]);
    expect(JSON.stringify(response)).not.toContain('127.0.0.1');

    const rejected = await harness.registered.get(AGENT_IPC_CHANNELS.status)({
        sender: harness.webContents,
        senderFrame: {},
    });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    harness.dispose();
});

test('@interface Agent preload channels stay aligned with the shared contract', async () => {
    const preload = await fs.readFile(path.join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');
    for (const channel of Object.values(AGENT_IPC_CHANNELS)) expect(preload).toContain(channel);
});

test('@interface Agent context refresh is a guarded semantic operation', async () => {
    const harness = createHarness();
    const input = { projectId: 'novel-1', chapterId: 'chapter-2' };
    const refreshed = await harness.registered.get(AGENT_IPC_CHANNELS.refreshContext)(
        harness.event,
        input,
    );

    expect(refreshed).toMatchObject({ ok: true, data: { state: 'ready', refreshed: true } });
    expect(harness.calls).toEqual([['refresh', input]]);
    harness.dispose();
});

test('@interface Agent semantic IPC exposes bounded Gateway operations', async () => {
    const harness = createHarness();
    const project = { projectId: 'novel-1', chapterId: 'chapter-2' };
    const opened = await harness.registered.get(AGENT_IPC_CHANNELS.openProject)(harness.event, project);
    const prompted = await harness.registered.get(AGENT_IPC_CHANNELS.prompt)(harness.event, {
        projectId: 'novel-1',
        sessionId: 'session-1',
        text: '继续写作',
        mode: 'queue',
        endpoint: 'https://forbidden.example',
    });
    const history = await harness.registered.get(AGENT_IPC_CHANNELS.getHistory)(harness.event, {
        projectId: 'novel-1',
        sessionId: 'session-1',
        maxMessages: 30,
    });
    const activated = await harness.registered.get(AGENT_IPC_CHANNELS.activateSession)(harness.event, {
        projectId: 'novel-1',
        sessionId: 'session-1',
    });

    expect(opened).toMatchObject({ ok: true, data: { sessionId: 'session-1' } });
    expect(prompted).toMatchObject({ ok: true, data: { accepted: true } });
    expect(history).toMatchObject({ ok: true, data: { events: [] } });
    expect(activated).toMatchObject({ ok: true, data: { active: true } });
    expect(harness.calls).toEqual(expect.arrayContaining([
        ['openProject', project],
        ['getHistory', { projectId: 'novel-1', sessionId: 'session-1', maxMessages: 30 }],
        ['activateSession', { projectId: 'novel-1', sessionId: 'session-1' }],
    ]));
    const promptCall = harness.calls.find(call => call[0] === 'prompt')[1];
    expect(promptCall).toMatchObject({
        projectId: 'novel-1',
        sessionId: 'session-1',
        text: '继续写作',
        mode: 'queue',
    });
    expect(promptCall.clientTimeZone).toBeTruthy();
    expect(promptCall).not.toHaveProperty('endpoint');
    harness.dispose();
});

test('@interface Agent Gateway events only target the live main window and unsubscribe', () => {
    const harness = createHarness();
    const value = {
        schemaVersion: 1,
        type: 'runtime.state',
        projectId: 'novel-1',
        generation: 1,
        time: Date.now(),
        data: { state: 'ready' },
    };
    harness.emit(value);
    expect(harness.sent).toEqual([[AGENT_IPC_CHANNELS.event, value]]);
    harness.dispose();
    harness.emit({ ...value, generation: 2 });
    expect(harness.sent).toHaveLength(1);
});

test('@interface Agent preload exposes a fixed event subscription with idempotent unsubscribe', async () => {
    const preload = await fs.readFile(path.join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');
    expect(preload).toContain('onEvent: events.subscribe');
    expect(preload).toContain('runtime, sessions, workspaceSessions, turns, events,');
    expect(preload).toContain('removeListener(AGENT_IPC_CHANNELS.event, handler)');
    expect(preload).not.toContain('on: (channel');
    expect(preload).not.toContain('invoke: (channel');
});
