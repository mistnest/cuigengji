import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { ApiError, asyncRoute, requireString } from '../lib/http.js';
import { allowWritesInside, readJson, withWriteBarrier, writeJson } from '../lib/json-store.js';
import { novelDir, novelsRoot, resolveInside, safeSegment } from '../lib/project-paths.js';

export const router = express.Router();

router.get('/', asyncRoute(async (_req, res) => {
    const root = novelsRoot();
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') return res.json({ novels: [] });
        throw err;
    }

    const novels = (await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
        const dirPath = resolveInside(root, entry.name);
        const stat = await fs.stat(dirPath);
        let config = { title: entry.name, created: stat.birthtimeMs, updated: stat.mtimeMs };
        try {
            config = { ...config, ...await readJson(path.join(dirPath, 'novel.json')) };
        } catch (err) {
            if (!['ENOENT', 'CORRUPT_JSON'].includes(err.code)) throw err;
        }
        const created = config.created || stat.birthtimeMs || 0;
        return {
            id: entry.name,
            title: config.title || entry.name,
            created,
            updated: config.updated || stat.mtimeMs || created,
        };
    }))).sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));

    res.json({ novels });
}));

router.post('/', asyncRoute(async (req, res) => {
    const title = requireString(req.body.title, 'title', { maxLength: 200 }).trim();
    const id = sanitize(title).substring(0, 50) || Date.now().toString(36);
    const dir = novelDir(id);
    try {
        await fs.access(dir);
        throw new ApiError(409, 'Project already exists', 'PROJECT_EXISTS');
    } catch (err) {
        if (err instanceof ApiError) throw err;
        if (err.code !== 'ENOENT') throw err;
    }

    allowWritesInside(dir);
    await Promise.all([
        fs.mkdir(path.join(dir, 'chapters'), { recursive: true }),
        fs.mkdir(path.join(dir, 'memory'), { recursive: true }),
        fs.mkdir(path.join(dir, 'sessions'), { recursive: true }),
    ]);
    const now = Date.now();
    const config = { novelId: id, title, author: '', genre: '', styleGuide: '', created: now, updated: now };
    await writeJson(path.join(dir, 'novel.json'), config);
    res.status(201).json({ id, config });
}));

router.delete('/:id', asyncRoute(async (req, res) => {
    const id = safeSegment(req.params.id, 'project id');
    const dir = resolveInside(novelsRoot(), id);
    try {
        await fs.access(dir);
    } catch (err) {
        if (err.code === 'ENOENT') throw new ApiError(404, 'Project not found', 'NOT_FOUND');
        throw err;
    }
    await withWriteBarrier(
        dir,
        () => fs.rm(dir, { recursive: true, force: true }),
        { keepBlocked: true },
    );
    res.json({ success: true });
}));
