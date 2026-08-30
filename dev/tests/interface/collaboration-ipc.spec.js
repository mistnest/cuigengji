import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerChapterIpcHandlers } from '../../../electron/ipc/project/index.js';
import { registerProjectIpcHandlers } from '../../../electron/ipc/project/index.js';
import { registerWorkspaceIpcHandlers } from '../../../electron/ipc/project/index.js';
import { createProject } from '../../../src/backend/domains/project/index.js';
import {
    getDomainChanges,
    getDomainEventBus,
} from '../../../src/backend/foundation/platform/index.js';
import {
    CHAPTER_IPC_CHANNELS,
    WORKSPACE_IPC_CHANNELS,
} from '../../../shared/desktop-api/project/index.js';

test('@interface project writes use atomic revisions and announce replayable changes', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-collaboration-'));
    globalThis.DATA_ROOT = dataRoot;
    const eventBus = getDomainEventBus();
    eventBus.clear();
    await createProject({ title: '协作契约', actor: { kind: 'system', id: 'test' } });

    const handlers = new Map();
    const sent = [];
    const webContents = { mainFrame: {}, send: (_channel, value) => sent.push(value) };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const ipcMain = {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: channel => handlers.delete(channel),
    };
    const getMainWindow = () => ({ isDestroyed: () => false, webContents });
    const disposeProject = registerProjectIpcHandlers({ ipcMain, getMainWindow });
    const disposeChapter = registerChapterIpcHandlers({ ipcMain, getMainWindow });
    const disposeWorkspace = registerWorkspaceIpcHandlers({ ipcMain, getMainWindow });

    try {
        const first = await handlers.get(WORKSPACE_IPC_CHANNELS.save)(event, {
            projectId: '协作契约',
            workspace: { title: '协作契约', worldBook: { entries: {} }, characters: [] },
        });
        expect(first).toMatchObject({ ok: true, data: { revision: 1 } });

        const second = await handlers.get(WORKSPACE_IPC_CHANNELS.save)(event, {
            projectId: '协作契约',
            workspace: {
                title: '协作契约（更新）', expectedRevision: 1,
                worldBook: { entries: {} }, characters: [],
            },
        });
        expect(second).toMatchObject({ ok: true, data: { revision: 2 } });

        const stale = await handlers.get(WORKSPACE_IPC_CHANNELS.save)(event, {
            projectId: '协作契约',
            workspace: {
                title: '不应覆盖', expectedRevision: 1,
                worldBook: { entries: {} }, characters: [],
            },
        });
        expect(stale).toMatchObject({
            ok: false,
            error: {
                code: 'REVISION_CONFLICT',
                details: {
                    expectedRevision: 1,
                    currentRevision: 2,
                    currentVersion: { revision: 2 },
                },
            },
        });

        const chapter = await handlers.get(CHAPTER_IPC_CHANNELS.create)(event, {
            projectId: '协作契约', chapter: { title: '第一章', content: '初稿' },
        });
        expect(chapter).toMatchObject({ ok: true, data: { revision: 1 } });
        const chapterUpdate = await handlers.get(CHAPTER_IPC_CHANNELS.update)(event, {
            projectId: '协作契约', chapterId: chapter.data.id,
            patch: { content: '第二稿', expectedRevision: 1 },
        });
        expect(chapterUpdate).toMatchObject({ ok: true, data: { revision: 2 } });

        const replay = getDomainChanges('协作契约', 0, eventBus.streamId);
        expect(replay.resetRequired).toBe(false);
        expect(replay.events.length).toBeGreaterThanOrEqual(3);
        expect(replay.events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                entityType: 'workspace', revision: 2,
                actor: { kind: 'human', id: 'renderer' },
            }),
            expect.objectContaining({
                entityType: 'chapter', revision: 2,
                actor: { kind: 'human', id: 'renderer' },
            }),
        ]));
        expect(sent.some(item => item.entityType === 'chapter' && item.revision === 2)).toBe(true);

        const reset = getDomainChanges('协作契约', 0, 'old-stream');
        expect(reset.resetRequired).toBe(true);
        expect(reset.events).toEqual([]);
    } finally {
        disposeWorkspace();
        disposeChapter();
        disposeProject();
        eventBus.clear();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
