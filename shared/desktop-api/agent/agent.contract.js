export const AGENT_IPC_CHANNELS = Object.freeze({
    status: 'cgj:v1:agent:status', openProject: 'cgj:v1:agent:open-project',
    listSessions: 'cgj:v1:agent:list-sessions', createSession: 'cgj:v1:agent:create-session',
    activateSession: 'cgj:v1:agent:activate-session',
    getHistory: 'cgj:v1:agent:get-history', prompt: 'cgj:v1:agent:prompt',
    cancel: 'cgj:v1:agent:cancel', refreshContext: 'cgj:v1:agent:refresh-context',
    restart: 'cgj:v1:agent:restart', stop: 'cgj:v1:agent:stop',
    event: 'cgj:v1:agent:event',
});
export const AGENT_RUNTIME_KIND = 'deepseek-harness';
export const AGENT_EVENT_SCHEMA_VERSION = 1;
export const AGENT_PROMPT_MAX_CODE_POINTS = 50_000;
export const AGENT_UI_EVENT_TYPES = Object.freeze([
    'runtime.state', 'session.ready', 'turn.started', 'message.user',
    'assistant.delta', 'assistant.completed', 'tool.started', 'tool.completed',
    'proposal.outline', 'turn.completed', 'turn.failed',
]);
