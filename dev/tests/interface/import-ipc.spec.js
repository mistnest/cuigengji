import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerImportIpcHandlers } from '../../../electron/ipc/exchange/index.js';
import { createProject } from '../../../src/backend/domains/project/index.js';
import { IMPORT_IPC_CHANNELS } from '../../../shared/desktop-api/exchange/index.js';

test('@interface Electron import dialogs keep source paths inside the trusted process', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-import-ipc-'));
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-import-source-'));
    globalThis.DATA_ROOT = dataRoot;
    await createProject({ title: '导入契约' });

    const worldBookPath = path.join(sourceRoot, '世界.json');
    const characterPath = path.join(sourceRoot, '角色.json');
    const presetPath = path.join(sourceRoot, '预设.json');
    const documentPath = path.join(sourceRoot, '小说.txt');
    await Promise.all([
        fs.writeFile(worldBookPath, JSON.stringify({
            entries: { 0: { uid: 0, key: ['城'], content: '山城' } },
        }), 'utf8'),
        fs.writeFile(characterPath, JSON.stringify({ data: { name: '沈墨', description: '书生' } }), 'utf8'),
        fs.writeFile(presetPath, JSON.stringify({ name: '测试预设', temperature: 0.7 }), 'utf8'),
        fs.writeFile(documentPath, '第一章 起点\n晨光落在窗前。\n\n第二章 出发\n马车驶出城门。', 'utf8'),
    ]);

    const selections = [[worldBookPath], [characterPath], [presetPath], [documentPath]];
    const handlers = new Map();
    const webContents = { mainFrame: {} };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const dispose = registerImportIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: channel => handlers.delete(channel),
        },
        dialog: {
            showOpenDialog: async () => ({ canceled: false, filePaths: selections.shift() }),
        },
        getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    });

    try {
        const worldBook = await handlers.get(IMPORT_IPC_CHANNELS.selectWorldBook)(event, {
            projectId: '导入契约',
        });
        expect(worldBook).toMatchObject({ ok: true, data: { entryCount: 1 } });
        expect(JSON.stringify(worldBook.data)).not.toContain(sourceRoot);

        const characters = await handlers.get(IMPORT_IPC_CHANNELS.selectCharacters)(event, {
            projectId: '导入契约',
        });
        expect(characters).toMatchObject({
            ok: true,
            data: { characters: [{ character: { data: { name: '沈墨' } } }] },
        });

        const preset = await handlers.get(IMPORT_IPC_CHANNELS.selectPreset)(event, {
            projectId: '导入契约',
        });
        expect(preset).toMatchObject({ ok: true, data: { data: { temperature: 0.7 } } });

        const document = await handlers.get(IMPORT_IPC_CHANNELS.selectDocument)(event, {
            projectId: '导入契约', autoSplit: true,
        });
        expect(document).toMatchObject({
            ok: true,
            data: { count: 2, project: { id: '导入契约' } },
        });
        expect(JSON.stringify(document.data)).not.toContain(sourceRoot);
    } finally {
        dispose();
        globalThis.DATA_ROOT = previousDataRoot;
        await Promise.all([
            fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
            fs.rm(sourceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
        ]);
    }
});
