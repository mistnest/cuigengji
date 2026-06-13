/**
 * Novel AI Editor — Sessions API
 * AI 多会话管理，类似 CC 的会话切换
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import sanitize from 'sanitize-filename';
import { getDataRoot } from '../config.js';

export const router = express.Router();

function sessionsDir(novelId) {
    return path.join(getDataRoot(), 'novels', sanitize(novelId), 'sessions');
}

function countMessages(messages) {
    if (Array.isArray(messages)) return messages.length;
    if (!messages || typeof messages !== 'object') return 0;
    return Object.values(messages).reduce((total, value) =>
        total + (Array.isArray(value) ? value.length : 0), 0);
}

// GET /api/sessions?novelId=xxx — List all sessions
router.get('/', async (req, res) => {
    try {
        const { novelId } = req.query;
        if (!novelId) return res.status(400).json({ error: 'novelId required' });
        const dir = sessionsDir(novelId);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return res.json({ sessions: [] }); }
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        const sessions = files.map(f => {
            try {
                const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                return {
                    id: d.id,
                    name: d.name,
                    createdAt: d.createdAt,
                    updatedAt: d.updatedAt || d.createdAt,
                    mode: d.mode || 'write',
                    messageCount: countMessages(d.messages),
                };
            } catch { return null; }
        }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
        res.json({ sessions });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sessions — Create new session
router.post('/', async (req, res) => {
    try {
        const { novelId, name } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId required' });
        const dir = sessionsDir(novelId);
        fs.mkdirSync(dir, { recursive: true });
        const id = Date.now().toString(36);
        const session = { id, name: name || '新会话', createdAt: Date.now(), updatedAt: Date.now(), mode: 'write', messages: [] };
        fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(session, null, 2), 'utf8');
        res.status(201).json(session);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sessions/:id?novelId=xxx — Load session content
router.get('/:id', async (req, res) => {
    try {
        const { novelId } = req.query;
        if (!novelId) return res.status(400).json({ error: 'novelId required' });
        const file = path.join(sessionsDir(novelId), `${req.params.id}.json`);
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
        res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/sessions/:id — Save session
router.put('/:id', async (req, res) => {
    try {
        const { novelId, name, messages, mode } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId required' });
        const dir = sessionsDir(novelId);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${req.params.id}.json`);
        const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { id: req.params.id, createdAt: Date.now(), messages: { write: [], assist: [] } };
        if (name !== undefined) existing.name = name;
        if (mode !== undefined) existing.mode = mode;
        if (messages !== undefined) existing.messages = messages;
        existing.updatedAt = Date.now();
        fs.writeFileSync(file, JSON.stringify(existing, null, 2), 'utf8');
        res.json(existing);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/sessions/:id — Delete session
router.delete('/:id', async (req, res) => {
    try {
        const { novelId } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId required' });
        const file = path.join(sessionsDir(novelId), `${req.params.id}.json`);
        if (fs.existsSync(file)) fs.unlinkSync(file);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
