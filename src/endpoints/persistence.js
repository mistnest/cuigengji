/**
 * Novel AI Editor — Persistence API
 * 将前端状态持久化到磁盘
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { getDataRoot } from '../config.js';

export const router = express.Router();

// POST /api/save/worldbook — 保存世界书到磁盘
router.post('/worldbook', async (req, res) => {
    try {
        const { name, data } = req.body;
        if (!data?.entries) return res.status(400).json({ error: 'Invalid world book data' });

        const dir = path.join(getDataRoot(), 'worlds');
        fs.mkdirSync(dir, { recursive: true });

        const filename = sanitize(name || 'worldbook') + '.json';
        fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), 'utf8');

        res.json({ success: true, path: path.join(dir, filename) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/save/worldbook — 列出所有已保存的世界书
router.get('/worldbooks', async (_req, res) => {
    try {
        const dir = path.join(getDataRoot(), 'worlds');
        if (!fs.existsSync(dir)) return res.json({ files: [] });

        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({ name: f.replace('.json', ''), path: path.join(dir, f) }));

        res.json({ files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/save/character — 保存单个角色到磁盘
router.post('/character', async (req, res) => {
    try {
        const { data } = req.body;
        if (!data) return res.status(400).json({ error: 'No character data' });

        const name = (data.data?.name || data.name || 'character');
        const dir = path.join(getDataRoot(), 'characters');
        fs.mkdirSync(dir, { recursive: true });

        const filename = sanitize(name) + '.json';
        fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), 'utf8');

        res.json({ success: true, path: path.join(dir, filename) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/save/preset — 保存预设
router.post('/preset', async (req, res) => {
    try {
        const { name, data } = req.body;
        const dir = path.join(getDataRoot(), 'presets');
        fs.mkdirSync(dir, { recursive: true });

        const filename = sanitize(name || 'preset') + '.json';
        fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), 'utf8');

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/save/novel-config — 保存小说项目配置
router.post('/novel-config', async (req, res) => {
    try {
        const { novelId, config } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId required' });

        const dir = path.join(getDataRoot(), 'novels', sanitize(novelId));
        fs.mkdirSync(dir, { recursive: true });

        const filePath = path.join(dir, 'novel.json');
        const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
        const merged = { ...existing, ...config, updated: Date.now() };
        fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');

        res.json({ success: true, config: merged });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/save/characters — 列出所有已保存的角色
router.get('/characters', async (_req, res) => {
    try {
        const dir = path.join(getDataRoot(), 'characters');
        if (!fs.existsSync(dir)) return res.json({ files: [] });

        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const filePath = path.join(dir, f);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    return { name: f.replace('.json', ''), path: filePath, data };
                } catch {
                    return { name: f.replace('.json', ''), path: filePath, data: null };
                }
            });

        res.json({ files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/save/worldbook/:name — 加载指定世界书
router.get('/worldbook/:name', async (req, res) => {
    try {
        const dir = path.join(getDataRoot(), 'worlds');
        const filePath = path.join(dir, sanitize(req.params.name) + '.json');
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'World book not found' });
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/save/worldbook-entry — 更新单个世界书条目
router.post('/worldbook-entry', async (req, res) => {
    try {
        const { bookName, uid, entry } = req.body;
        const dir = path.join(getDataRoot(), 'worlds');
        const filePath = path.join(dir, sanitize(bookName || 'worldbook') + '.json');
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'World book not found' });
        const book = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!book.entries) book.entries = {};
        book.entries[uid] = entry;
        fs.writeFileSync(filePath, JSON.stringify(book, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/save/workspace/:novelId — 加载工作区配置
router.get('/workspace/:novelId', async (req, res) => {
    try {
        const dir = path.join(getDataRoot(), 'novels', sanitize(req.params.novelId));
        const filePath = path.join(dir, 'workspace.json');
        if (!fs.existsSync(filePath)) return res.json({});
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/save/workspace/:novelId — 保存工作区配置
router.post('/workspace/:novelId', async (req, res) => {
    try {
        const dir = path.join(getDataRoot(), 'novels', sanitize(req.params.novelId));
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, 'workspace.json');
        fs.writeFileSync(filePath, JSON.stringify({ ...req.body, savedAt: Date.now() }, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function sanitize(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
}
