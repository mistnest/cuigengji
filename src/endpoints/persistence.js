import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { ApiError, asyncRoute, requireObject, requireString } from '../lib/http.js';
import { readJson, updateJson, writeJson } from '../lib/json-store.js';
import { projectFile } from '../lib/project-paths.js';
import { ensureCharacterSummaries, ensureWorldBookSummaries } from '../services/reference-summaries.js';

export const router = express.Router();

router.post('/worldbook', asyncRoute(async (req, res) => {
    const { novelId, name, data } = req.body;
    requireString(novelId, 'novelId', { maxLength: 100 });
    requireObject(data, 'data');
    requireObject(data.entries, 'data.entries');
    const filePath = projectAssetFile(novelId, 'worldbooks', name || 'worldbook');
    await writeJson(filePath, ensureWorldBookSummaries(data).data);
    res.json({ success: true, path: filePath });
}));

router.get('/worldbooks', asyncRoute(async (req, res) => {
    const novelId = requireString(req.query.novelId, 'novelId', { maxLength: 100 });
    const files = await listJsonFiles(projectFile(novelId, 'assets', 'worldbooks'));
    res.json({ files });
}));

router.post('/character', asyncRoute(async (req, res) => {
    const { novelId, data } = req.body;
    requireString(novelId, 'novelId', { maxLength: 100 });
    requireObject(data, 'data');
    const name = data.data?.name || data.name || 'character';
    const filePath = projectAssetFile(novelId, 'characters', name);
    await writeJson(filePath, ensureCharacterSummaries([data]).data[0]);
    res.json({ success: true, path: filePath });
}));

router.post('/preset', asyncRoute(async (req, res) => {
    const { novelId, name, data } = req.body;
    requireString(novelId, 'novelId', { maxLength: 100 });
    requireObject(data, 'data');
    const filePath = projectAssetFile(novelId, 'presets', name || 'preset');
    await writeJson(filePath, data);
    res.json({ success: true, path: filePath });
}));

router.post('/novel-config', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    const config = requireObject(req.body.config || {}, 'config');
    const filePath = projectFile(novelId, 'novel.json');
    const merged = await updateJson(filePath, existing => ({
        ...existing,
        ...config,
        novelId,
        updated: Date.now(),
    }), { defaultValue: {} });
    res.json({ success: true, config: merged });
}));

router.get('/characters', asyncRoute(async (req, res) => {
    const novelId = requireString(req.query.novelId, 'novelId', { maxLength: 100 });
    const dir = projectFile(novelId, 'assets', 'characters');
    const entries = await listJsonFiles(dir);
    const files = await Promise.all(entries.map(async entry => {
        try {
            return { ...entry, data: await readJson(entry.path) };
        } catch (err) {
            if (err.code === 'CORRUPT_JSON') return { ...entry, data: null, error: err.code };
            throw err;
        }
    }));
    res.json({ files });
}));

router.get('/worldbook/:name', asyncRoute(async (req, res) => {
    const novelId = requireString(req.query.novelId, 'novelId', { maxLength: 100 });
    const filePath = projectAssetFile(novelId, 'worldbooks', req.params.name);
    try {
        res.json(await readJson(filePath));
    } catch (err) {
        if (err.code === 'ENOENT') throw new ApiError(404, 'World book not found', 'NOT_FOUND');
        throw err;
    }
}));

router.post('/worldbook-entry', asyncRoute(async (req, res) => {
    const { novelId, bookName, uid, entry } = req.body;
    requireString(novelId, 'novelId', { maxLength: 100 });
    if (uid === undefined || uid === null) throw new ApiError(400, 'uid is required', 'VALIDATION_ERROR');
    requireObject(entry, 'entry');
    const filePath = projectAssetFile(novelId, 'worldbooks', bookName || 'worldbook');
    await updateJson(filePath, book => ({
        ...ensureWorldBookSummaries({
            ...book,
            entries: {
                ...(book.entries || {}),
                [uid]: entry,
            },
        }).data,
    }));
    res.json({ success: true });
}));

router.get('/workspace/:novelId', asyncRoute(async (req, res) => {
    const filePath = projectFile(req.params.novelId, 'workspace.json');
    res.json(await readJson(filePath, { defaultValue: {} }));
}));

router.post('/workspace/:novelId', asyncRoute(async (req, res) => {
    requireObject(req.body, 'workspace');
    const filePath = projectFile(req.params.novelId, 'workspace.json');
    const workspace = {
        ...req.body,
        novelId: req.params.novelId,
        savedAt: Date.now(),
    };
    if (workspace.worldBook?.entries) {
        workspace.worldBook = ensureWorldBookSummaries(workspace.worldBook).data;
    }
    if (Array.isArray(workspace.characters)) {
        workspace.characters = ensureCharacterSummaries(workspace.characters).data;
    }
    await writeJson(filePath, workspace);
    res.json({ success: true, savedAt: workspace.savedAt });
}));

async function listJsonFiles(dir) {
    let names;
    try {
        names = await fs.readdir(dir);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    return names
        .filter(name => name.endsWith('.json'))
        .map(name => ({
            name: name.replace(/\.json$/i, ''),
            path: path.join(dir, name),
        }));
}

function projectAssetFile(novelId, folder, name) {
    const safe = sanitize(String(name || '')).substring(0, 100);
    if (!safe) throw new ApiError(400, 'Invalid file name', 'INVALID_PATH');
    return projectFile(novelId, 'assets', folder, `${safe}.json`);
}
