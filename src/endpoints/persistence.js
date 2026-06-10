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

function sanitize(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
}
