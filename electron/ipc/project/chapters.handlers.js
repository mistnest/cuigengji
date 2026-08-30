import {
    createChapter,
    deleteChapter,
    getChapter,
    listChapters,
    updateChapter,
} from '../../../src/backend/domains/project/index.js';
import {
    CHAPTER_IPC_CHANNELS,
    PROJECT_INPUT_SCHEMAS,
} from '../../../shared/desktop-api/project/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

export function registerChapterIpcHandlers({ ipcMain, getMainWindow }) {
    const handlers = new Map([
        [CHAPTER_IPC_CHANNELS.list, createGuardedHandler(
            getMainWindow,
            input => listChapters(input?.projectId),
            'chapters.list',
            PROJECT_INPUT_SCHEMAS.listChapters,
        )],
        [CHAPTER_IPC_CHANNELS.get, createGuardedHandler(
            getMainWindow,
            input => getChapter(input?.projectId, input?.chapterId),
            'chapters.get',
            PROJECT_INPUT_SCHEMAS.getChapter,
        )],
        [CHAPTER_IPC_CHANNELS.create, createGuardedHandler(
            getMainWindow,
            input => createChapter(input?.projectId, {
                ...(input?.chapter || {}),
                actor: humanActor(input?.clientId),
            }),
            'chapters.create',
            PROJECT_INPUT_SCHEMAS.createChapter,
        )],
        [CHAPTER_IPC_CHANNELS.update, createGuardedHandler(
            getMainWindow,
            input => updateChapter(input?.projectId, input?.chapterId, {
                ...(input?.patch || {}),
                actor: humanActor(input?.clientId),
            }),
            'chapters.update',
            PROJECT_INPUT_SCHEMAS.updateChapter,
        )],
        [CHAPTER_IPC_CHANNELS.delete, createGuardedHandler(
            getMainWindow,
            input => deleteChapter(input?.projectId, input?.chapterId, {
                confirmed: input?.confirmed,
                expectedRevision: input?.expectedRevision,
                expectedContentHash: input?.expectedContentHash,
                actor: humanActor(input?.clientId),
            }),
            'chapters.delete',
            PROJECT_INPUT_SCHEMAS.deleteChapter,
        )],
    ]);
    return registerHandlers(ipcMain, handlers);
}

function humanActor(clientId) {
    const id = typeof clientId === 'string' ? clientId.replace(/[\0\r\n]/gu, '').slice(0, 160) : '';
    return { kind: 'human', id: id || 'renderer' };
}
