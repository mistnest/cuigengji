import http from 'node:http';
import { randomUUID } from 'node:crypto';

import {
    createChapter,
    deleteChapter,
    getChapter,
    listChapters,
    updateChapter,
} from '../../../../src/backend/domains/project/index.js';
import { AppError, publishDomainChange } from '../../../../src/backend/foundation/platform/index.js';

/**
 * Loopback-only capability bridge used by the writing-project MCP process.
 * The MCP child never receives filesystem access; every mutation is routed
 * through the same domain services used by the desktop renderer.
 */
export function createWritingProjectBridge({ host = '127.0.0.1' } = {}) {
    const capabilities = new Map();
    let server;
    let address;

    async function start() {
        if (server) return publicAddress();
        server = http.createServer(async (request, response) => {
            try {
                await handleRequest(request, response);
            } catch (error) {
                sendJson(response, Number(error?.status) >= 400 ? Number(error.status) : 500, serializeError(error));
            }
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, host, () => {
                server.off('error', reject);
                resolve();
            });
        });
        address = server.address();
        // The bridge is owned by the Electron lifecycle; an unref'd listener
        // must not keep isolated supervisor tests or shutdown from exiting.
        server.unref();
        return publicAddress();
    }

    async function stop() {
        capabilities.clear();
        const active = server;
        server = undefined;
        address = undefined;
        if (!active) return;
        await new Promise(resolve => active.close(() => resolve()));
    }

    async function issueCapability({ projectId, sessionId = '', ttlMs = 86_400_000 } = {}) {
        if (!projectId || typeof projectId !== 'string') throw new AppError('VALIDATION_ERROR', 'projectId is required', { status: 400 });
        await start();
        const token = randomUUID() + randomUUID();
        capabilities.set(token, {
            projectId,
            sessionId: String(sessionId || '').slice(0, 160),
            expiresAt: Date.now() + Math.max(60_000, Math.min(Number(ttlMs) || 86_400_000, 86_400_000)),
        });
        return { url: publicAddress(), token, projectId };
    }

    function revokeCapability(token) {
        capabilities.delete(token);
    }

    function publicAddress() {
        if (!address || typeof address === 'string') return '';
        return `http://${host}:${address.port}`;
    }

    async function handleRequest(request, response) {
        if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: { code: 'method_not_allowed' } });
        const url = new URL(request.url || '/', publicAddress() || `http://${host}`);
        if (url.pathname !== '/v1/execute' && url.pathname !== '/v1/graph-changed') {
            return sendJson(response, 404, { ok: false, error: { code: 'not_found' } });
        }
        const token = bearerToken(request.headers.authorization);
        const capability = token ? capabilities.get(token) : undefined;
        if (!capability || capability.expiresAt < Date.now()) {
            if (token) capabilities.delete(token);
            return sendJson(response, 401, { ok: false, error: { code: 'unauthorized' } });
        }
        const payload = await readJsonBody(request);
        if (url.pathname === '/v1/graph-changed') {
            const event = publishDomainChange({
                projectId: capability.projectId,
                entityType: payload.entityType || 'graph',
                entityId: payload.entityId || 'graph',
                operation: payload.operation || 'updated',
                revision: Number(payload.revision || payload.graphVersion || 0),
                beforeRevision: Number(payload.beforeRevision || 0),
                contentHash: String(payload.contentHash || ''),
                changedFields: Array.isArray(payload.changedFields) ? payload.changedFields : [],
                actor: { kind: 'agent', id: capability.sessionId || 'writing-project-mcp', runId: payload.runId },
            });
            return sendJson(response, 200, { ok: true, event });
        }
        const result = await executeTool(capability, payload);
        return sendJson(response, 200, { ok: true, result });
    }

    return Object.freeze({ start, stop, issueCapability, revokeCapability, address: publicAddress });
}

async function executeTool(capability, payload = {}) {
    const tool = String(payload.tool || '');
    const args = payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {};
    const projectId = capability.projectId;
    switch (tool) {
    case 'manuscript_list':
        return { projectId, items: await listChapters(projectId) };
    case 'manuscript_get': {
        const chapter = await getChapter(projectId, args.chapterId);
        const includeContent = args.includeContent !== false;
        if (!includeContent) delete chapter.content;
        if (includeContent && (Number.isFinite(Number(args.start)) || Number.isFinite(Number(args.maxChars)))) {
            const start = Math.max(0, Number(args.start) || 0);
            const maxChars = Math.max(1, Math.min(200_000, Number(args.maxChars) || 200_000));
            const content = String(chapter.content || '');
            chapter.content = content.slice(start, start + maxChars);
            chapter.contentWindow = { start, maxChars, totalChars: content.length, truncated: start + maxChars < content.length };
        }
        return { projectId, chapter };
    }
    case 'manuscript_create':
        return createChapter(projectId, { ...args, actor: agentActor(capability) });
    case 'manuscript_update':
        return updateChapter(projectId, args.chapterId, {
            ...(args.patch && typeof args.patch === 'object' ? args.patch : {}),
            expectedRevision: args.expectedRevision,
            expectedContentHash: args.expectedContentHash,
            actor: agentActor(capability),
        });
    case 'manuscript_delete':
        if (args.confirmed !== true) throw new AppError('DELETE_CONFIRMATION_REQUIRED', 'manuscript delete requires confirmed=true', { status: 409, publicMessage: '删除正文前需要 confirmed=true。' });
        return deleteChapter(projectId, args.chapterId, {
            confirmed: true,
            expectedRevision: args.expectedRevision,
            expectedContentHash: args.expectedContentHash,
            actor: agentActor(capability),
        });
    default:
        throw new AppError('VALIDATION_ERROR', `Unknown writing project tool: ${tool}`, { status: 400 });
    }
}

function agentActor(capability) {
    return { kind: 'agent', id: capability.sessionId || 'writing-project-mcp' };
}

function bearerToken(value) {
    const match = /^Bearer\s+(.+)$/iu.exec(String(value || ''));
    return match ? match[1].trim() : '';
}

async function readJsonBody(request) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) throw new AppError('VALIDATION_ERROR', 'bridge request is too large', { status: 413 });
        chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new AppError('VALIDATION_ERROR', 'bridge request must be JSON', { status: 400 });
    }
}

function sendJson(response, status, value) {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(value));
}

function serializeError(error) {
    return {
        ok: false,
        error: {
            code: error?.code || 'internal_error',
            message: error?.publicMessage || error?.message || String(error),
            ...(error?.details ? { details: error.details } : {}),
        },
    };
}
