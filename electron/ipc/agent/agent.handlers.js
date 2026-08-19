import {
    AGENT_INPUT_SCHEMAS,
    AGENT_IPC_CHANNELS,
} from '../../../shared/desktop-api/agent/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

export function registerAgentIpcHandlers({ ipcMain, getMainWindow, gateway }) {
    const handlers = new Map([
        [AGENT_IPC_CHANNELS.status, createGuardedHandler(
            getMainWindow,
            () => gateway.status(),
            'agent.status',
            AGENT_INPUT_SCHEMAS.status,
        )],
        [AGENT_IPC_CHANNELS.openProject, createGuardedHandler(
            getMainWindow,
            input => gateway.openProject(projectContextInput(input)),
            'agent.openProject',
            AGENT_INPUT_SCHEMAS.openProject,
        )],
        [AGENT_IPC_CHANNELS.listSessions, createGuardedHandler(
            getMainWindow,
            input => gateway.listSessions({ projectId: input?.projectId }),
            'agent.listSessions',
            AGENT_INPUT_SCHEMAS.listSessions,
        )],
        [AGENT_IPC_CHANNELS.createSession, createGuardedHandler(
            getMainWindow,
            input => gateway.createSession({ projectId: input?.projectId }),
            'agent.createSession',
            AGENT_INPUT_SCHEMAS.createSession,
        )],
        [AGENT_IPC_CHANNELS.activateSession, createGuardedHandler(
            getMainWindow,
            input => gateway.activateSession({
                projectId: input?.projectId,
                sessionId: input?.sessionId,
            }),
            'agent.activateSession',
            AGENT_INPUT_SCHEMAS.activateSession,
        )],
        [AGENT_IPC_CHANNELS.getHistory, createGuardedHandler(
            getMainWindow,
            input => gateway.getHistory({
                projectId: input?.projectId,
                sessionId: input?.sessionId,
                beforeSeq: input?.beforeSeq,
                maxMessages: input?.maxMessages,
            }),
            'agent.getHistory',
            AGENT_INPUT_SCHEMAS.getHistory,
        )],
        [AGENT_IPC_CHANNELS.prompt, createGuardedHandler(
            getMainWindow,
            input => gateway.prompt({
                projectId: input?.projectId,
                sessionId: input?.sessionId,
                text: input?.text,
                mode: input?.mode,
                clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
            }),
            'agent.prompt',
            AGENT_INPUT_SCHEMAS.prompt,
        )],
        [AGENT_IPC_CHANNELS.cancel, createGuardedHandler(
            getMainWindow,
            input => gateway.cancel({
                projectId: input?.projectId,
                sessionId: input?.sessionId,
            }),
            'agent.cancel',
            AGENT_INPUT_SCHEMAS.cancel,
        )],
        [AGENT_IPC_CHANNELS.refreshContext, createGuardedHandler(
            getMainWindow,
            input => gateway.refreshContext(projectContextInput(input)),
            'agent.refreshContext',
            AGENT_INPUT_SCHEMAS.refreshContext,
        )],
        [AGENT_IPC_CHANNELS.restart, createGuardedHandler(
            getMainWindow,
            input => gateway.restart(projectContextInput(input)),
            'agent.restart',
            AGENT_INPUT_SCHEMAS.restart,
        )],
        [AGENT_IPC_CHANNELS.stop, createGuardedHandler(
            getMainWindow,
            () => gateway.stop(),
            'agent.stop',
            AGENT_INPUT_SCHEMAS.stop,
        )],
    ]);
    const unsubscribe = gateway.subscribe(event => {
        const window = getMainWindow();
        if (!window || window.isDestroyed() || window.webContents.isDestroyed?.()) return;
        window.webContents.send(AGENT_IPC_CHANNELS.event, event);
    });
    const unregister = registerHandlers(ipcMain, handlers);
    return () => {
        unsubscribe();
        unregister();
    };
}

function projectContextInput(input) {
    return {
        projectId: input?.projectId,
        chapterId: input?.chapterId,
    };
}
