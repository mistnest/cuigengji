import path from 'node:path';

import {
    importCharacterFile,
    importDocumentFile,
    importFolder,
    importPresetFile,
    importWorldBookFile,
} from '../../../src/backend/interchange/exchange/index.js';
import { createProject, listProjects } from '../../../src/backend/domains/project/index.js';
import {
    EXCHANGE_INPUT_SCHEMAS,
    IMPORT_IPC_CHANNELS,
} from '../../../shared/desktop-api/exchange/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

async function selectFiles(dialog, window, options) {
    const result = await dialog.showOpenDialog(window, options);
    return result.canceled ? [] : result.filePaths;
}

async function createProjectForDocument(filePath, actor) {
    const baseTitle = path.basename(filePath, path.extname(filePath)).trim() || '导入项目';
    const existing = new Set((await listProjects()).map(project => project.id));
    for (let index = 1; index < 1000; index += 1) {
        const title = index === 1 ? baseTitle : `${baseTitle}-${index}`;
        if (existing.has(title)) continue;
        return createProject({ title, actor });
    }
    return createProject({ title: `${baseTitle}-${Date.now()}`, actor });
}

export function registerImportIpcHandlers({ ipcMain, dialog, getMainWindow }) {
    const handlers = new Map([
        [IMPORT_IPC_CHANNELS.selectDocument, createGuardedHandler(getMainWindow, async input => {
            const actor = humanActor(input?.clientId);
            const [filePath] = await selectFiles(dialog, getMainWindow(), {
                title: '导入小说文档',
                properties: ['openFile'],
                filters: [{ name: '小说文档', extensions: ['txt', 'docx'] }],
            });
            if (!filePath) return null;
            const project = input?.projectId
                ? { id: input.projectId }
                : await createProjectForDocument(filePath, actor);
            const result = await importDocumentFile(project.id, filePath, {
                autoSplit: input?.autoSplit !== false,
                volumeId: input?.volumeId || '',
                actor,
            });
            return {
                ...result,
                project: {
                    id: project.id,
                    title: project.config?.title || project.id,
                },
            };
        }, 'imports.selectDocument', EXCHANGE_INPUT_SCHEMAS.selectDocument)],
        [IMPORT_IPC_CHANNELS.selectFolder, createGuardedHandler(getMainWindow, async input => {
            const [folderPath] = await selectFiles(dialog, getMainWindow(), {
                title: '导入小说文件夹',
                properties: ['openDirectory'],
            });
            return folderPath ? importFolder(input?.projectId, folderPath, {
                actor: humanActor(input?.clientId),
            }) : null;
        }, 'imports.selectFolder', EXCHANGE_INPUT_SCHEMAS.selectFolder)],
        [IMPORT_IPC_CHANNELS.selectWorldBook, createGuardedHandler(getMainWindow, async input => {
            const [filePath] = await selectFiles(dialog, getMainWindow(), {
                title: '导入世界书',
                properties: ['openFile'],
                filters: [{ name: '世界书', extensions: ['json'] }],
            });
            return filePath ? importWorldBookFile(input?.projectId, filePath, {
                actor: humanActor(input?.clientId),
            }) : null;
        }, 'imports.selectWorldBook', EXCHANGE_INPUT_SCHEMAS.selectWorldBook)],
        [IMPORT_IPC_CHANNELS.selectCharacters, createGuardedHandler(getMainWindow, async input => {
            const filePaths = await selectFiles(dialog, getMainWindow(), {
                title: '导入角色卡',
                properties: ['openFile', 'multiSelections'],
                filters: [{ name: '角色卡', extensions: ['png', 'json'] }],
            });
            if (!filePaths.length) return null;
            const characters = [];
            for (const filePath of filePaths) {
                characters.push(await importCharacterFile(input?.projectId, filePath, {
                    actor: humanActor(input?.clientId),
                }));
            }
            return { success: true, characters };
        }, 'imports.selectCharacters', EXCHANGE_INPUT_SCHEMAS.selectCharacters)],
        [IMPORT_IPC_CHANNELS.selectPreset, createGuardedHandler(getMainWindow, async input => {
            const [filePath] = await selectFiles(dialog, getMainWindow(), {
                title: '导入 AI 预设',
                properties: ['openFile'],
                filters: [{ name: 'AI 预设', extensions: ['json'] }],
            });
            return filePath ? importPresetFile(input?.projectId, filePath, {
                actor: humanActor(input?.clientId),
            }) : null;
        }, 'imports.selectPreset', EXCHANGE_INPUT_SCHEMAS.selectPreset)],
    ]);
    return registerHandlers(ipcMain, handlers);
}

function humanActor(clientId) {
    const id = typeof clientId === 'string' ? clientId.replace(/[\0\r\n]/gu, '').slice(0, 160) : '';
    return { kind: 'human', id: id || 'renderer' };
}
