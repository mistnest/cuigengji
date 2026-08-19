'use strict';

const AGENT_IPC_CHANNELS = Object.freeze({
    status: 'cgj:v1:agent:status', openProject: 'cgj:v1:agent:open-project',
    listSessions: 'cgj:v1:agent:list-sessions', createSession: 'cgj:v1:agent:create-session',
    activateSession: 'cgj:v1:agent:activate-session',
    getHistory: 'cgj:v1:agent:get-history', prompt: 'cgj:v1:agent:prompt',
    cancel: 'cgj:v1:agent:cancel', refreshContext: 'cgj:v1:agent:refresh-context',
    restart: 'cgj:v1:agent:restart', stop: 'cgj:v1:agent:stop',
    event: 'cgj:v1:agent:event',
});
const SESSION_IPC_CHANNELS = Object.freeze({
    list: 'cgj:v1:sessions:list', create: 'cgj:v1:sessions:create',
    get: 'cgj:v1:sessions:get', update: 'cgj:v1:sessions:update',
    delete: 'cgj:v1:sessions:delete',
});

function createAgentFacade({ invoke, ipcRenderer }) {
    const runtime = Object.freeze({
        status: () => invoke(AGENT_IPC_CHANNELS.status),
        openProject: input => invoke(AGENT_IPC_CHANNELS.openProject, input),
        refreshContext: input => invoke(AGENT_IPC_CHANNELS.refreshContext, input),
        restart: input => invoke(AGENT_IPC_CHANNELS.restart, input),
        stop: () => invoke(AGENT_IPC_CHANNELS.stop),
    });
    const sessions = Object.freeze({
        list: input => invoke(AGENT_IPC_CHANNELS.listSessions, input),
        create: input => invoke(AGENT_IPC_CHANNELS.createSession, input),
        activate: input => invoke(AGENT_IPC_CHANNELS.activateSession, input),
        history: input => invoke(AGENT_IPC_CHANNELS.getHistory, input),
    });
    const workspaceSessions = Object.freeze({
        list: projectId => invoke(SESSION_IPC_CHANNELS.list, { projectId }),
        create: (projectId, session) => invoke(SESSION_IPC_CHANNELS.create, {
            projectId, session,
        }),
        get: (projectId, sessionId) => invoke(SESSION_IPC_CHANNELS.get, {
            projectId, sessionId,
        }),
        update: (projectId, sessionId, patch) => invoke(SESSION_IPC_CHANNELS.update, {
            projectId, sessionId, patch,
        }),
        delete: (projectId, sessionId, confirmed) => invoke(SESSION_IPC_CHANNELS.delete, {
            projectId, sessionId, confirmed,
        }),
    });
    const turns = Object.freeze({
        prompt: input => invoke(AGENT_IPC_CHANNELS.prompt, input),
        cancel: input => invoke(AGENT_IPC_CHANNELS.cancel, input),
    });
    const events = Object.freeze({
        subscribe(listener) {
            if (typeof listener !== 'function') throw new TypeError('listener must be a function');
            const handler = (_event, value) => {
                if (value && typeof value === 'object') listener(value);
            };
            ipcRenderer.on(AGENT_IPC_CHANNELS.event, handler);
            let active = true;
            return () => {
                if (!active) return;
                active = false;
                ipcRenderer.removeListener(AGENT_IPC_CHANNELS.event, handler);
            };
        },
    });
    return Object.freeze({
        runtime, sessions, workspaceSessions, turns, events,
        status: runtime.status,
        openProject: runtime.openProject,
        listSessions: sessions.list,
        createSession: sessions.create,
        activateSession: sessions.activate,
        getHistory: sessions.history,
        prompt: turns.prompt,
        cancel: turns.cancel,
        refreshContext: runtime.refreshContext,
        restart: runtime.restart,
        stop: runtime.stop,
        onEvent: events.subscribe,
    });
}
