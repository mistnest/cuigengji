import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerOutlineIpcHandlers } from '../../../electron/ipc/project/index.js';
import { createProject } from '../../../src/backend/domains/project/index.js';
import { OUTLINE_IPC_CHANNELS } from '../../../shared/desktop-api/project/index.js';

test('@interface outline IPC owns nodes and guards revisions', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-outline-ipc-'));
    globalThis.DATA_ROOT = dataRoot;
    await createProject({ title: '大纲契约' });

    const handlers = new Map();
    const webContents = { mainFrame: {} };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const dispose = registerOutlineIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: channel => handlers.delete(channel),
        },
        getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    });

    try {
        const empty = await handlers.get(OUTLINE_IPC_CHANNELS.get)(event, { projectId: '大纲契约' });
        expect(empty).toMatchObject({ ok: true, data: { revision: 0, nodes: [] } });

        const created = await handlers.get(OUTLINE_IPC_CHANNELS.createNode)(event, {
            projectId: '大纲契约', node: { title: '主线' },
        });
        const nodeId = created.data.id;
        expect(created).toMatchObject({ ok: true, data: { title: '主线' } });

        const updated = await handlers.get(OUTLINE_IPC_CHANNELS.updateNode)(event, {
            projectId: '大纲契约', nodeId, patch: { completed: true, expectedRevision: 1 },
        });
        expect(updated).toMatchObject({ ok: true, data: { completed: true } });

        const conflict = await handlers.get(OUTLINE_IPC_CHANNELS.updateNode)(event, {
            projectId: '大纲契约', nodeId, patch: { title: '过期标题', expectedRevision: 1 },
        });
        expect(conflict).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });

        const deleted = await handlers.get(OUTLINE_IPC_CHANNELS.deleteNode)(event, {
            projectId: '大纲契约', nodeId, confirmed: true, expectedRevision: 2,
        });
        expect(deleted).toMatchObject({ ok: true, data: { success: true, revision: 3 } });
    } finally {
        dispose();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
