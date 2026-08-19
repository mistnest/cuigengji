import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerReferenceIpcHandlers } from '../../../electron/ipc/knowledge/index.js';
import { registerSessionIpcHandlers } from '../../../electron/ipc/agent/index.js';
import { registerWorkspaceIpcHandlers } from '../../../electron/ipc/project/index.js';
import { createProject } from '../../../src/backend/domains/project/index.js';
import { REFERENCE_IPC_CHANNELS } from '../../../shared/desktop-api/knowledge/index.js';
import { SESSION_IPC_CHANNELS } from '../../../shared/desktop-api/agent/index.js';
import { WORKSPACE_IPC_CHANNELS } from '../../../shared/desktop-api/project/index.js';

test('@interface workspace, references and sessions persist through bounded IPC', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-content-ipc-'));
    globalThis.DATA_ROOT = dataRoot;
    await createProject({ title: '内容契约' });

    const handlers = new Map();
    const webContents = { mainFrame: {} };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const ipcMain = {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: channel => handlers.delete(channel),
    };
    const getMainWindow = () => ({ isDestroyed: () => false, webContents });
    const disposeWorkspaces = registerWorkspaceIpcHandlers({ ipcMain, getMainWindow });
    const disposeReferences = registerReferenceIpcHandlers({ ipcMain, getMainWindow });
    const disposeSessions = registerSessionIpcHandlers({ ipcMain, getMainWindow });

    try {
        const savedWorkspace = await handlers.get(WORKSPACE_IPC_CHANNELS.save)(event, {
            projectId: '内容契约',
            workspace: {
                panelLayout: { left: 280 },
                worldBook: { entries: { 0: { uid: 0, key: ['城'], content: '山城' } } },
                characters: [{ data: { name: '林青', description: '剑客' } }],
            },
        });
        expect(savedWorkspace).toMatchObject({ ok: true, data: { success: true } });
        const loadedWorkspace = await handlers.get(WORKSPACE_IPC_CHANNELS.get)(event, {
            projectId: '内容契约',
        });
        expect(loadedWorkspace).toMatchObject({
            ok: true,
            data: { panelLayout: { left: 280 }, characters: [{ data: { name: '林青' } }] },
        });

        const savedBook = await handlers.get(REFERENCE_IPC_CHANNELS.saveWorldBook)(event, {
            projectId: '内容契约',
            name: '设定集',
            data: { entries: { 0: { uid: 0, key: ['山'], content: '北山' } } },
        });
        expect(savedBook).toMatchObject({ ok: true, data: { success: true, name: '设定集' } });
        expect(savedBook.data).not.toHaveProperty('path');
        const books = await handlers.get(REFERENCE_IPC_CHANNELS.listWorldBooks)(event, {
            projectId: '内容契约',
        });
        expect(books.data).toEqual([{ name: '设定集' }]);

        const createdSession = await handlers.get(SESSION_IPC_CHANNELS.create)(event, {
            projectId: '内容契约', session: { name: '构思', messages: [] },
        });
        expect(createdSession).toMatchObject({ ok: true, data: { name: '构思', revision: 1 } });
        const updatedSession = await handlers.get(SESSION_IPC_CHANNELS.update)(event, {
            projectId: '内容契约',
            sessionId: createdSession.data.id,
            patch: { messages: [{ role: 'user', content: '开始' }], expectedRevision: 1 },
        });
        expect(updatedSession).toMatchObject({ ok: true, data: { revision: 2 } });
    } finally {
        disposeSessions();
        disposeReferences();
        disposeWorkspaces();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
