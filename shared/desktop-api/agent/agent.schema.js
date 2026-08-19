import { defineObjectSchema } from '../core/schema.js';
import { AGENT_PROMPT_MAX_CODE_POINTS } from './agent.contract.js';

const projectId = { type: 'string', required: true, maxLength: 200 };
const sessionId = { type: 'string', required: true, maxLength: 500 };
export const AGENT_INPUT_SCHEMAS = Object.freeze({
    status: defineObjectSchema('agent.runtime.status', {}, { allowUndefined: true }),
    openProject: defineObjectSchema('agent.runtime.openProject', {
        projectId, chapterId: { type: 'string', maxLength: 200 },
    }),
    listSessions: defineObjectSchema('agent.sessions.list', { projectId }),
    createSession: defineObjectSchema('agent.sessions.create', { projectId }),
    activateSession: defineObjectSchema('agent.sessions.activate', { projectId, sessionId }),
    getHistory: defineObjectSchema('agent.sessions.history', {
        projectId, sessionId,
        beforeSeq: { type: 'number' }, maxMessages: { type: 'number' },
    }),
    prompt: defineObjectSchema('agent.turns.prompt', {
        projectId,
        sessionId,
        text: { type: 'string', required: true, maxLength: AGENT_PROMPT_MAX_CODE_POINTS },
        mode: { type: 'string', maxLength: 20 },
    }),
    cancel: defineObjectSchema('agent.turns.cancel', { projectId, sessionId }),
    refreshContext: defineObjectSchema('agent.runtime.refreshContext', {
        projectId, chapterId: { type: 'string', maxLength: 200 },
    }),
    restart: defineObjectSchema('agent.runtime.restart', {
        projectId, chapterId: { type: 'string', maxLength: 200 },
    }),
    stop: defineObjectSchema('agent.runtime.stop', {}, { allowUndefined: true }),
});

export const AGENT_SESSION_INPUT_SCHEMAS = Object.freeze({
    list: defineObjectSchema('agent.persistedSessions.list', { projectId }),
    create: defineObjectSchema('agent.persistedSessions.create', {
        projectId, session: { type: 'object', required: true },
    }),
    get: defineObjectSchema('agent.persistedSessions.get', { projectId, sessionId }),
    update: defineObjectSchema('agent.persistedSessions.update', {
        projectId, sessionId, patch: { type: 'object', required: true },
    }),
    delete: defineObjectSchema('agent.persistedSessions.delete', {
        projectId, sessionId, confirmed: { type: 'boolean' },
    }),
});
