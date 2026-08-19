import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerAutomationIpcHandlers } from '../../../electron/ipc/automation/index.js';
import { executeAutomationOperation } from '../../../src/backend/intelligence/automation/index.js';
import { AUTOMATION_IPC_CHANNELS } from '../../../shared/desktop-api/automation/index.js';

function createHarness(executeOperation) {
    const registered = new Map();
    const webContents = { mainFrame: {} };
    const dispose = registerAutomationIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => registered.set(channel, handler),
            removeHandler: channel => registered.delete(channel),
        },
        getMainWindow: () => ({ isDestroyed: () => false, webContents }),
        executeOperation,
    });
    return {
        dispose,
        event: { sender: webContents, senderFrame: webContents.mainFrame },
        registered,
    };
}

test('@interface Automation IPC validates inputs and dispatches semantic operations', async () => {
    const calls = [];
    const harness = createHarness(async (operation, payload) => {
        calls.push([operation, payload]);
        return { reply: 'continued' };
    });
    try {
        const result = await harness.registered.get(AUTOMATION_IPC_CHANNELS.writingContinue)(
            harness.event,
            {
                operationId: 'write-1',
                message: 'continue',
                config: { provider: 'deepseek', apiKey: 'not-returned' },
                context: { projectId: 'novel-1' },
            },
        );
        expect(result).toMatchObject({
            ok: true,
            data: { operationId: 'write-1', result: { reply: 'continued' } },
        });
        expect(calls).toEqual([['writing.continue', {
            message: 'continue',
            config: { provider: 'deepseek', apiKey: 'not-returned' },
            context: { projectId: 'novel-1' },
        }]]);
        expect(JSON.stringify(result)).not.toContain('not-returned');

        const invalid = await harness.registered.get(AUTOMATION_IPC_CHANNELS.writingContinue)(
            harness.event,
            { config: {} },
        );
        expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    } finally {
        harness.dispose();
    }
});

test('@interface Automation operations support bounded cancellation without Agent sessions', async () => {
    const harness = createHarness((_operation, _payload, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
            const error = new Error('cancelled');
            error.code = 'CANCELLED';
            reject(error);
        }, { once: true });
    }));
    try {
        const pending = harness.registered.get(AUTOMATION_IPC_CHANNELS.ideasInspire)(
            harness.event,
            { operationId: 'idea-1', text: '', config: { provider: 'deepseek' } },
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        const cancelled = await harness.registered.get(AUTOMATION_IPC_CHANNELS.cancel)(
            harness.event,
            { operationId: 'idea-1' },
        );
        expect(cancelled).toMatchObject({
            ok: true,
            data: { operationId: 'idea-1', cancelled: true },
        });
        await expect(pending).resolves.toMatchObject({
            ok: false,
            error: { code: 'CANCELLED' },
        });
    } finally {
        harness.dispose();
    }
});

test('@interface Automation backend adapter runs in-process and preload exposes fixed modules', async () => {
    await expect(executeAutomationOperation('debug.lastPrompt')).resolves.toEqual(
        expect.objectContaining({ empty: true }),
    );
    const preload = await fs.readFile(path.join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');
    for (const channel of Object.values(AUTOMATION_IPC_CHANNELS)) expect(preload).toContain(channel);
    expect(preload).toContain('writing,');
    expect(preload).toContain('extraction,');
    expect(preload).toContain('operations,');
    expect(preload).not.toContain('legacy-http-automation');
});
