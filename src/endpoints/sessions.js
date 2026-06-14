import express from 'express';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ApiError, asyncRoute, requireString } from '../lib/http.js';
import { readJson, removeFile, updateJson, writeJson } from '../lib/json-store.js';
import { projectFile, resolveInside } from '../lib/project-paths.js';

export const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
    const novelId = requireString(req.query.novelId, 'novelId', { maxLength: 100 });
    const dir = sessionsDir(novelId);
    let files;
    try {
        files = (await fs.readdir(dir)).filter(file => file.endsWith('.json'));
    } catch (err) {
        if (err.code === 'ENOENT') return res.json({ sessions: [] });
        throw err;
    }

    const sessions = (await Promise.all(files.map(async file => {
        try {
            const data = await readJson(resolveInside(dir, file));
            return {
                id: data.id,
                name: data.name,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt || data.createdAt,
                mode: data.mode || 'write',
                messageCount: countMessages(data.messages),
            };
        } catch (err) {
            if (err.code === 'CORRUPT_JSON') return null;
            throw err;
        }
    }))).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({ sessions });
}));

router.post('/', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    const now = Date.now();
    const id = `${now.toString(36)}-${randomUUID().slice(0, 8)}`;
    const session = {
        id,
        name: req.body.name || '新会话',
        createdAt: now,
        updatedAt: now,
        mode: 'write',
        messages: [],
    };
    await writeJson(sessionFile(novelId, id), session);
    res.status(201).json(session);
}));

router.get('/:id', asyncRoute(async (req, res) => {
    const novelId = requireString(req.query.novelId, 'novelId', { maxLength: 100 });
    try {
        res.json(await readJson(sessionFile(novelId, req.params.id)));
    } catch (err) {
        if (err.code === 'ENOENT') throw new ApiError(404, 'Session not found', 'NOT_FOUND');
        throw err;
    }
}));

router.put('/:id', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    const file = sessionFile(novelId, req.params.id);
    const session = await updateJson(file, existing => ({
        ...existing,
        id: req.params.id,
        name: req.body.name !== undefined ? req.body.name : existing.name,
        mode: req.body.mode !== undefined ? req.body.mode : existing.mode,
        messages: req.body.messages !== undefined ? req.body.messages : existing.messages,
        updatedAt: Date.now(),
    }), {
        defaultValue: {
            id: req.params.id,
            createdAt: Date.now(),
            messages: { write: [], assist: [] },
        },
    });
    res.json(session);
}));

router.delete('/:id', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    await removeFile(sessionFile(novelId, req.params.id));
    res.json({ success: true });
}));

function sessionsDir(novelId) {
    return projectFile(novelId, 'sessions');
}

function sessionFile(novelId, sessionId) {
    requireString(sessionId, 'session id', { maxLength: 150 });
    return resolveInside(sessionsDir(novelId), `${sessionId}.json`);
}

function countMessages(messages) {
    if (Array.isArray(messages)) return messages.length;
    if (!messages || typeof messages !== 'object') return 0;
    return Object.values(messages).reduce((total, value) =>
        total + (Array.isArray(value) ? value.length : 0), 0);
}
