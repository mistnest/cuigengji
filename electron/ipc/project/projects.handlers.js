import {
    createProject,
    deleteProject,
    listProjects,
    requestProjectDeletion,
} from '../../../src/backend/domains/project/index.js';
import {
    PROJECT_INPUT_SCHEMAS,
    PROJECT_IPC_CHANNELS,
} from '../../../shared/desktop-api/project/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

export function registerProjectIpcHandlers({ ipcMain, getMainWindow }) {
    const handlers = new Map([
        [PROJECT_IPC_CHANNELS.list, createGuardedHandler(
            getMainWindow,
            () => listProjects(),
            'projects.list',
            PROJECT_INPUT_SCHEMAS.listProjects,
        )],
        [PROJECT_IPC_CHANNELS.create, createGuardedHandler(
            getMainWindow,
            input => createProject(input),
            'projects.create',
            PROJECT_INPUT_SCHEMAS.createProject,
        )],
        [PROJECT_IPC_CHANNELS.requestDelete, createGuardedHandler(
            getMainWindow,
            input => requestProjectDeletion(input?.projectId),
            'projects.requestDelete',
            PROJECT_INPUT_SCHEMAS.requestDelete,
        )],
        [PROJECT_IPC_CHANNELS.delete, createGuardedHandler(
            getMainWindow,
            input => deleteProject(input?.projectId, {
                confirmationToken: input?.confirmationToken,
            }),
            'projects.delete',
            PROJECT_INPUT_SCHEMAS.deleteProject,
        )],
    ]);
    return registerHandlers(ipcMain, handlers);
}
