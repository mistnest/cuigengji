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
            input => createChapter(input?.projectId, input?.chapter),
            'chapters.create',
            PROJECT_INPUT_SCHEMAS.createChapter,
        )],
        [CHAPTER_IPC_CHANNELS.update, createGuardedHandler(
            getMainWindow,
            input => updateChapter(input?.projectId, input?.chapterId, input?.patch),
            'chapters.update',
            PROJECT_INPUT_SCHEMAS.updateChapter,
        )],
        [CHAPTER_IPC_CHANNELS.delete, createGuardedHandler(
            getMainWindow,
            input => deleteChapter(input?.projectId, input?.chapterId, {
                confirmed: input?.confirmed,
            }),
            'chapters.delete',
            PROJECT_INPUT_SCHEMAS.deleteChapter,
        )],
    ]);
    return registerHandlers(ipcMain, handlers);
}
