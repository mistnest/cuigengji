import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import {
    AppError,
    projectFile,
    readJson,
    removeFile,
    requireString,
    resolveInside,
    updateJson,
    writeJson,
} from '../../../foundation/platform/index.js';

export async function listSessions(projectId) {
    const id = requireProjectId(projectId);
    const dir = sessionsDir(id);
    let files;
    try {
        files = (await fs.readdir(dir)).filter(file => file.endsWith('.json'));
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const sessions = await Promise.all(files.map(async file => {
        try {
            const data = await readJson(resolveInside(dir, file));
            return {
                id: data.id,
                name: data.name,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt || data.createdAt,
                mode: data.mode || 'write',
                revision: Number(data.revision || 0),
                chapterWindowAnchor: data.chapterWindowAnchor || null,
                messageCount: countMessages(data.messages),
            };
        } catch (error) {
            if (error.code === 'CORRUPT_JSON' || error.code === 'ENOENT') return null;
            throw error;
        }
    }));
    return sessions.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createSession(projectId, input = {}) {
    const id = requireProjectId(projectId);
    const now = Date.now();
    const sessionId = `${now.toString(36)}-${randomUUID().slice(0, 8)}`;
    const session = {
        schemaVersion: 1,
        revision: 1,
        id: sessionId,
        name: input.name || '新会话',
        createdAt: now,
        updatedAt: now,
        mode: input.mode || 'write',
        chapterWindowAnchor: input.chapterWindowAnchor || null,
        totalRoundCount: Number(input.totalRoundCount || 0),
        messages: input.messages || [],
    };
    await writeJson(sessionFile(id, sessionId), session);
    return session;
}

export async function getSession(projectId, sessionId) {
    try {
        const session = await readJson(sessionFile(requireProjectId(projectId), requireSessionId(sessionId)));
        return { ...session, revision: Number(session.revision || 0) };
    } catch (error) {
        if (error.code === 'ENOENT') throw notFound();
        throw error;
    }
}

export async function updateSession(projectId, sessionId, patch = {}) {
    const id = requireProjectId(projectId);
    const targetId = requireSessionId(sessionId);
    const file = sessionFile(id, targetId);
    return updateJson(file, existing => {
        const currentRevision = Number(existing.revision || 0);
        if (patch.expectedRevision !== undefined
            && Number(patch.expectedRevision) !== currentRevision) {
            throw new AppError('REVISION_CONFLICT', 'Session was changed by another operation', {
                status: 409,
                publicMessage: '会话已被其他操作修改，请刷新后重试。',
                details: { expectedRevision: Number(patch.expectedRevision), currentRevision },
            });
        }
        return {
            ...existing,
            schemaVersion: Number(existing.schemaVersion || 1),
            revision: currentRevision + 1,
            id: targetId,
            name: patch.name !== undefined ? patch.name : existing.name,
            mode: patch.mode !== undefined ? patch.mode : existing.mode,
            messages: patch.messages !== undefined ? patch.messages : existing.messages,
            chapterWindowAnchor: patch.chapterWindowAnchor !== undefined
                ? patch.chapterWindowAnchor
                : existing.chapterWindowAnchor,
            totalRoundCount: patch.totalRoundCount !== undefined
                ? patch.totalRoundCount
                : (existing.totalRoundCount || 0),
            updatedAt: Date.now(),
        };
    }, {
        defaultValue: {
            schemaVersion: 1,
            revision: 0,
            id: targetId,
            createdAt: Date.now(),
            messages: { write: [], assist: [] },
        },
    });
}

export async function deleteSession(projectId, sessionId, options = {}) {
    if (options.confirmed !== true) {
        throw new AppError('DELETE_CONFIRMATION_REQUIRED', 'Session delete confirmation is required', {
            status: 409,
            publicMessage: '删除会话前需要确认。',
        });
    }
    await removeFile(sessionFile(requireProjectId(projectId), requireSessionId(sessionId)));
    return { success: true };
}

function sessionsDir(projectId) {
    return projectFile(projectId, 'sessions');
}

function sessionFile(projectId, sessionId) {
    return resolveInside(sessionsDir(projectId), `${sessionId}.json`);
}

function requireProjectId(value) {
    return requireString(value, 'projectId', { maxLength: 100 });
}

function requireSessionId(value) {
    return requireString(value, 'sessionId', { maxLength: 150 });
}

function notFound() {
    return new AppError('NOT_FOUND', 'Session not found', { status: 404 });
}

function countMessages(messages) {
    if (Array.isArray(messages)) return messages.length;
    if (!messages || typeof messages !== 'object') return 0;
    return Object.values(messages).reduce((total, value) =>
        total + (Array.isArray(value) ? value.length : 0), 0);
}
