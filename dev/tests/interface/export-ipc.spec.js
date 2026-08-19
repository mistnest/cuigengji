import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerExportIpcHandlers } from '../../../electron/ipc/exchange/index.js';
import { EXPORT_IPC_CHANNELS } from '../../../shared/desktop-api/exchange/index.js';

test('@interface exports only write to a path selected by the trusted dialog', async () => {
    const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-export-ipc-'));
    const textTarget = path.join(targetRoot, '章节.txt');
    const jsonTarget = path.join(targetRoot, '资料.json');
    const targets = [textTarget, jsonTarget];
    const handlers = new Map();
    const webContents = { mainFrame: {} };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const dispose = registerExportIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: channel => handlers.delete(channel),
        },
        dialog: {
            showSaveDialog: async () => ({ canceled: false, filePath: targets.shift() }),
        },
        getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    });

    try {
        const textResult = await handlers.get(EXPORT_IPC_CHANNELS.saveText)(event, {
            suggestedName: '../../危险名称.txt',
            content: '正文',
        });
        expect(textResult).toMatchObject({ ok: true, data: { saved: true } });
        expect(textResult.data).not.toHaveProperty('path');
        expect(await fs.readFile(textTarget, 'utf8')).toBe('正文');

        const jsonResult = await handlers.get(EXPORT_IPC_CHANNELS.saveJson)(event, {
            suggestedName: '资料.json',
            data: { name: '设定' },
        });
        expect(jsonResult).toMatchObject({ ok: true, data: { saved: true } });
        expect(JSON.parse(await fs.readFile(jsonTarget, 'utf8'))).toEqual({ name: '设定' });
    } finally {
        dispose();
        await fs.rm(targetRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
