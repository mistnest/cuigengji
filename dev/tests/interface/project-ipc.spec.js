import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerProjectIpcHandlers } from '../../../electron/ipc/project/index.js';
import { PROJECT_IPC_CHANNELS } from '../../../shared/desktop-api/project/index.js';
import {
    enqueueFileWrite,
    withWriteBarrier,
} from '../../../src/backend/foundation/platform/index.js';

test('@interface project IPC owns the full create/list/delete lifecycle', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-project-ipc-'));
    globalThis.DATA_ROOT = dataRoot;

    const handlers = new Map();
    const webContents = { mainFrame: {} };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const dispose = registerProjectIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: channel => handlers.delete(channel),
        },
        getMainWindow: () => ({
            isDestroyed: () => false,
            webContents,
        }),
    });

    try {
        const created = await handlers.get(PROJECT_IPC_CHANNELS.create)(event, { title: 'IPC 项目' });
        expect(created).toMatchObject({
            ok: true,
            data: { id: 'IPC 项目', config: { schemaVersion: 1, title: 'IPC 项目' } },
        });

        const listed = await handlers.get(PROJECT_IPC_CHANNELS.list)(event);
        expect(listed).toMatchObject({
            ok: true,
            data: [{ id: 'IPC 项目', title: 'IPC 项目' }],
        });

        const denied = await handlers.get(PROJECT_IPC_CHANNELS.delete)(event, {
            projectId: 'IPC 项目',
            confirmationToken: 'invalid',
        });
        expect(denied).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

        const confirmation = await handlers.get(PROJECT_IPC_CHANNELS.requestDelete)(event, {
            projectId: 'IPC 项目',
        });
        const deleted = await handlers.get(PROJECT_IPC_CHANNELS.delete)(event, {
            projectId: 'IPC 项目',
            confirmationToken: confirmation.data.token,
        });
        expect(deleted).toMatchObject({ ok: true, data: { success: true } });
        expect((await handlers.get(PROJECT_IPC_CHANNELS.list)(event)).data).toEqual([]);
    } finally {
        dispose();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test('@interface a failed project deletion releases its write barrier', async () => {
    const root = path.join(os.tmpdir(), `cuigengji-delete-barrier-${Date.now()}`);
    await expect(withWriteBarrier(root, async () => {
        throw new Error('simulated delete failure');
    }, { keepBlocked: true })).rejects.toThrow('simulated delete failure');

    await expect(enqueueFileWrite(path.join(root, 'chapter.json'), async () => true))
        .resolves.toBe(true);
});
