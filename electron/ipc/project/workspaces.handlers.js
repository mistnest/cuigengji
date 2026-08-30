import { loadWorkspace, saveWorkspace } from '../../../src/backend/domains/project/index.js';
import {
    PROJECT_INPUT_SCHEMAS,
    WORKSPACE_IPC_CHANNELS,
} from '../../../shared/desktop-api/project/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

export function registerWorkspaceIpcHandlers({ ipcMain, getMainWindow }) {
    const handlers = new Map([
        [WORKSPACE_IPC_CHANNELS.get, createGuardedHandler(getMainWindow,
            input => loadWorkspace(input?.projectId), 'workspaces.get',
            PROJECT_INPUT_SCHEMAS.getWorkspace)],
        [WORKSPACE_IPC_CHANNELS.save, createGuardedHandler(getMainWindow,
            input => saveWorkspace(input?.projectId, {
                ...(input?.workspace || {}),
                ...(input?.expectedRevision !== undefined
                    ? { expectedRevision: input.expectedRevision } : {}),
                ...(input?.expectedContentHash !== undefined
                    ? { expectedContentHash: input.expectedContentHash } : {}),
                actor: humanActor(input?.clientId),
            }), 'workspaces.save',
            PROJECT_INPUT_SCHEMAS.saveWorkspace)],
    ]);
    return registerHandlers(ipcMain, handlers);
}

function humanActor(clientId) {
    const id = typeof clientId === 'string' ? clientId.replace(/[\0\r\n]/gu, '').slice(0, 160) : '';
    return { kind: 'human', id: id || 'renderer' };
}
