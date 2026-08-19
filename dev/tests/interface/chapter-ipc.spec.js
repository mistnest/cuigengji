import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerChapterIpcHandlers } from '../../../electron/ipc/project/index.js';
import { createProject } from '../../../src/backend/domains/project/index.js';
import { CHAPTER_IPC_CHANNELS } from '../../../shared/desktop-api/project/index.js';

test('@interface chapter IPC preserves data and detects revision conflicts', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-chapter-ipc-'));
    globalThis.DATA_ROOT = dataRoot;
    await createProject({ title: '章节契约' });

    const handlers = new Map();
    const webContents = { mainFrame: {} };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const dispose = registerChapterIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: channel => handlers.delete(channel),
        },
        getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    });

    try {
        const created = await handlers.get(CHAPTER_IPC_CHANNELS.create)(event, {
            projectId: '章节契约',
            chapter: { title: '第一章', content: '初稿' },
        });
        expect(created).toMatchObject({
            ok: true,
            data: { title: '第一章', content: '初稿', revision: 1 },
        });
        const chapterId = created.data.id;

        const updated = await handlers.get(CHAPTER_IPC_CHANNELS.update)(event, {
            projectId: '章节契约',
            chapterId,
            patch: { content: '第二稿', expectedRevision: 1 },
        });
        expect(updated).toMatchObject({ ok: true, data: { content: '第二稿', revision: 2 } });

        const conflict = await handlers.get(CHAPTER_IPC_CHANNELS.update)(event, {
            projectId: '章节契约',
            chapterId,
            patch: { content: '过期写入', expectedRevision: 1 },
        });
        expect(conflict).toMatchObject({
            ok: false,
            error: {
                code: 'REVISION_CONFLICT',
                details: { expectedRevision: 1, currentRevision: 2 },
            },
        });

        const listed = await handlers.get(CHAPTER_IPC_CHANNELS.list)(event, {
            projectId: '章节契约',
        });
        expect(listed.data).toHaveLength(1);
        expect(listed.data[0]).toMatchObject({ id: chapterId, revision: 2 });

        const deniedDelete = await handlers.get(CHAPTER_IPC_CHANNELS.delete)(event, {
            projectId: '章节契约', chapterId, confirmed: false,
        });
        expect(deniedDelete).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

        const deleted = await handlers.get(CHAPTER_IPC_CHANNELS.delete)(event, {
            projectId: '章节契约', chapterId, confirmed: true,
        });
        expect(deleted).toMatchObject({ ok: true, data: { success: true } });

        const firstVolume = await handlers.get(CHAPTER_IPC_CHANNELS.create)(event, {
            projectId: '章节契约',
            chapter: { type: 'volume', title: '第一部/旧城' },
        });
        const secondVolume = await handlers.get(CHAPTER_IPC_CHANNELS.create)(event, {
            projectId: '章节契约',
            chapter: { type: 'volume', title: '第一部旧城' },
        });
        expect(firstVolume.data.id).not.toBe(secondVolume.data.id);
        const volumes = (await handlers.get(CHAPTER_IPC_CHANNELS.list)(event, {
            projectId: '章节契约',
        })).data.filter(item => item.type === 'volume');
        expect(volumes.map(item => item.title)).toEqual(['第一部/旧城', '第一部旧城']);
    } finally {
        dispose();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
