import path from 'node:path';

import sanitize from 'sanitize-filename';

import {
    writeJsonExport,
    writeTextExport,
} from '../../../src/backend/interchange/exchange/index.js';
import {
    EXCHANGE_INPUT_SCHEMAS,
    EXPORT_IPC_CHANNELS,
} from '../../../shared/desktop-api/exchange/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

function safeSuggestedName(value, fallback, extension) {
    const source = sanitize(path.basename(String(value || ''))).slice(0, 150) || fallback;
    return source.toLowerCase().endsWith(extension) ? source : `${source}${extension}`;
}

async function chooseTarget(dialog, window, suggestedName, filter) {
    const result = await dialog.showSaveDialog(window, {
        defaultPath: suggestedName,
        filters: [filter],
        properties: ['showOverwriteConfirmation'],
    });
    return result.canceled ? '' : result.filePath;
}

export function registerExportIpcHandlers({ ipcMain, dialog, getMainWindow }) {
    const handlers = new Map([
        [EXPORT_IPC_CHANNELS.saveText, createGuardedHandler(getMainWindow, async input => {
            const suggestedName = safeSuggestedName(input?.suggestedName, 'chapter', '.txt');
            const target = await chooseTarget(dialog, getMainWindow(), suggestedName, {
                name: '文本文件', extensions: ['txt'],
            });
            return target ? writeTextExport(target, input?.content) : null;
        }, 'exports.saveText', EXCHANGE_INPUT_SCHEMAS.saveText)],
        [EXPORT_IPC_CHANNELS.saveJson, createGuardedHandler(getMainWindow, async input => {
            const suggestedName = safeSuggestedName(input?.suggestedName, 'export', '.json');
            const target = await chooseTarget(dialog, getMainWindow(), suggestedName, {
                name: 'JSON 文件', extensions: ['json'],
            });
            return target ? writeJsonExport(target, input?.data) : null;
        }, 'exports.saveJson', EXCHANGE_INPUT_SCHEMAS.saveJson)],
    ]);
    return registerHandlers(ipcMain, handlers);
}
