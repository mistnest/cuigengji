/**
 * Novel AI Editor - Novel Project Management
 * 新建、打开、列出小说项目
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import sanitize from 'sanitize-filename';
import { getDataRoot } from '../config.js';

export const router = express.Router();

const novelsRoot = () => path.join(getDataRoot(), 'novels');

// GET /api/novels - List all novel projects
router.get('/', async (_req, res) => {
    try {
        const root = novelsRoot();
        if (!fs.existsSync(root)) {
            fs.mkdirSync(root, { recursive: true });
            return res.json({ novels: [] });
        }

        const dirs = fs.readdirSync(root, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => {
                const dirPath = path.join(root, e.name);
                const configPath = path.join(dirPath, 'novel.json');
                const stat = fs.statSync(dirPath);
                let config = {
                    title: e.name,
                    created: stat.birthtimeMs,
                    updated: stat.mtimeMs,
                };

                if (fs.existsSync(configPath)) {
                    try {
                        config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
                    } catch {}
                }

                const created = config.created || stat.birthtimeMs || 0;
                const updated = config.updated || stat.mtimeMs || created;
                return { id: e.name, title: config.title || e.name, created, updated };
            })
            .sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));

        res.json({ novels: dirs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/novels - Create new novel project
router.post('/', async (req, res) => {
    try {
        const { title } = req.body;
        if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

        const id = sanitize(title).substring(0, 50) || Date.now().toString(36);
        const dir = path.join(novelsRoot(), id);
        if (fs.existsSync(dir)) return res.status(409).json({ error: '项目已存在' });

        fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });

        const now = Date.now();
        const config = { novelId: id, title, author: '', genre: '', styleGuide: '', created: now, updated: now };
        fs.writeFileSync(path.join(dir, 'novel.json'), JSON.stringify(config, null, 2), 'utf8');

        res.status(201).json({ id, config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/novels/:id - Remove a project and its project-scoped data
router.delete('/:id', async (req, res) => {
    try {
        const id = sanitize(req.params.id);
        if (!id || id !== req.params.id) {
            return res.status(400).json({ error: 'Invalid project id' });
        }

        const root = path.resolve(novelsRoot());
        const dir = path.resolve(root, id);
        if (path.dirname(dir) !== root) {
            return res.status(400).json({ error: 'Invalid project path' });
        }
        if (!fs.existsSync(dir)) {
            return res.status(404).json({ error: 'Project not found' });
        }

        fs.rmSync(dir, { recursive: true, force: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
