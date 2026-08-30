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
import { getDomainEventBus } from '../../../src/backend/foundation/platform/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

export function registerProjectIpcHandlers({ ipcMain, getMainWindow, eventBus = getDomainEventBus() }) {
    const handlers = new Map([
        [PROJECT_IPC_CHANNELS.list, createGuardedHandler(
            getMainWindow,
            () => listProjects(),
            'projects.list',
            PROJECT_INPUT_SCHEMAS.listProjects,
        )],
        [PROJECT_IPC_CHANNELS.changes, createGuardedHandler(
            getMainWindow,
            input => eventBus.getSince(
                input?.projectId,
                input?.sinceSeq,
                input?.sinceStreamId,
            ),
            'projects.changes',
            PROJECT_INPUT_SCHEMAS.getChanges,
        )],
        [PROJECT_IPC_CHANNELS.create, createGuardedHandler(
            getMainWindow,
            input => createProject({ ...input, actor: humanActor(input?.clientId) }),
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
                actor: humanActor(input?.clientId),
            }),
            'projects.delete',
            PROJECT_INPUT_SCHEMAS.deleteProject,
        )],
    ]);
    const unsubscribe = eventBus.subscribe(event => {
        const window = getMainWindow();
        if (!window || window.isDestroyed() || window.webContents.isDestroyed?.()) return;
        window.webContents.send(PROJECT_IPC_CHANNELS.changed, event);
    });
    const unregister = registerHandlers(ipcMain, handlers);
    return () => {
        unsubscribe();
        unregister();
    };
}

function humanActor(clientId) {
    const id = typeof clientId === 'string' ? clientId.replace(/[\0\r\n]/gu, '').slice(0, 160) : '';
    return { kind: 'human', id: id || 'renderer' };
}
