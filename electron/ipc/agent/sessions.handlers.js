import {
    createSession,
    deleteSession,
    getSession,
    listSessions,
    updateSession,
} from '../../../src/backend/intelligence/agent/index.js';
import {
    AGENT_SESSION_INPUT_SCHEMAS,
    SESSION_IPC_CHANNELS,
} from '../../../shared/desktop-api/agent/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

export function registerSessionIpcHandlers({ ipcMain, getMainWindow }) {
    const handlers = new Map([
        [SESSION_IPC_CHANNELS.list, createGuardedHandler(getMainWindow,
            input => listSessions(input?.projectId), 'sessions.list',
            AGENT_SESSION_INPUT_SCHEMAS.list)],
        [SESSION_IPC_CHANNELS.create, createGuardedHandler(getMainWindow,
            input => createSession(input?.projectId, input?.session), 'sessions.create',
            AGENT_SESSION_INPUT_SCHEMAS.create)],
        [SESSION_IPC_CHANNELS.get, createGuardedHandler(getMainWindow,
            input => getSession(input?.projectId, input?.sessionId), 'sessions.get',
            AGENT_SESSION_INPUT_SCHEMAS.get)],
        [SESSION_IPC_CHANNELS.update, createGuardedHandler(getMainWindow,
            input => updateSession(input?.projectId, input?.sessionId, input?.patch), 'sessions.update',
            AGENT_SESSION_INPUT_SCHEMAS.update)],
        [SESSION_IPC_CHANNELS.delete, createGuardedHandler(getMainWindow,
            input => deleteSession(input?.projectId, input?.sessionId, {
                confirmed: input?.confirmed,
            }), 'sessions.delete', AGENT_SESSION_INPUT_SCHEMAS.delete)],
    ]);
    return registerHandlers(ipcMain, handlers);
}
