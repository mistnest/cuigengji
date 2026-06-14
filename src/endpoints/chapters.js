import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { v4 as uuidv4 } from 'uuid';
import { getDataRoot } from '../config.js';
import { ApiError, asyncRoute, requireString } from '../lib/http.js';
import { enqueueFileWrite, readJson, removeFile, writeJson } from '../lib/json-store.js';
import { projectFile, resolveInside } from '../lib/project-paths.js';

export const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
    const novelId = requireString(req.query.novelId, 'novelId', { maxLength: 100 });
    const root = chaptersDir(novelId);
    const items = await listChapterItems(root, novelId);
    const volumes = items
        .filter(item => item.type === 'volume')
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || a.title.localeCompare(b.title, 'zh-CN'));
    const chapters = items.filter(item => item.type !== 'volume');
    const sortChapters = (a, b) =>
        Number(a.order || 0) - Number(b.order || 0)
        || Number(a.created || 0) - Number(b.created || 0)
        || a.title.localeCompare(b.title, 'zh-CN');
    const ordered = [];
    for (const volume of volumes) {
        ordered.push(volume);
        ordered.push(...chapters.filter(chapter => chapter.volumeId === volume.id).sort(sortChapters));
    }
    ordered.push(...chapters.filter(chapter => !chapter.volumeId).sort(sortChapters));
    res.json({ chapters: ordered });
}));

router.get('/:id', asyncRoute(async (req, res) => {
    const novelId = requireString(req.query.novelId, 'novelId', { maxLength: 100 });
    const found = await findChapterFile(chaptersDir(novelId), req.params.id);
    if (!found) throw new ApiError(404, 'Chapter not found', 'NOT_FOUND');
    res.json(found.data);
}));

router.post('/', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    const result = await withChapterLock(novelId, async () => {
        const root = chaptersDir(novelId);
        if (req.body.type === 'volume') {
            const title = String(req.body.title || '未命名卷');
            const volumeName = safeFileBase(title, 'volume');
            await fs.mkdir(resolveInside(root, volumeName), { recursive: true });
            return {
                status: 201,
                body: {
                    id: `vol_${volumeName}`,
                    novelId,
                    type: 'volume',
                    title,
                    volumeId: '',
                    order: 0,
                },
            };
        }

        const content = typeof req.body.content === 'string' ? req.body.content : '';
        const chapter = {
            id: uuidv4(),
            novelId,
            title: String(req.body.title || '未命名章节'),
            content,
            status: 'draft',
            wordCount: countWords(content),
            created: Date.now(),
            updated: Date.now(),
            notes: '',
            plotPoints: [],
            order: 0,
            volumeId: normalizeVolumeId(req.body.volumeId),
        };
        const targetDir = chapterTargetDir(root, chapter.volumeId);
        await fs.mkdir(targetDir, { recursive: true });
        const existing = await listJsonNames(targetDir);
        const prefix = String(existing.length + 1).padStart(3, '0');
        const filename = `${safeFileBase(`${prefix}-${chapter.title}`, 'chapter')}.json`;
        await writeJson(resolveInside(targetDir, filename), chapter);
        return { status: 201, body: chapter };
    });
    res.status(result.status).json(result.body);
}));

router.put('/:id', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    const chapter = await withChapterLock(novelId, async () => {
        const root = chaptersDir(novelId);
        const found = await findChapterFile(root, req.params.id);
        if (!found) throw new ApiError(404, 'Chapter not found', 'NOT_FOUND');

        const next = { ...found.data };
        if (req.body.title !== undefined) next.title = String(req.body.title);
        if (req.body.content !== undefined) {
            next.content = String(req.body.content);
            next.wordCount = countWords(next.content);
        }
        if (req.body.order !== undefined) next.order = Number(req.body.order) || 0;
        next.updated = Date.now();

        let targetPath = found.path;
        if (req.body.volumeId !== undefined) {
            next.volumeId = normalizeVolumeId(req.body.volumeId);
            const targetDir = chapterTargetDir(root, next.volumeId);
            await fs.mkdir(targetDir, { recursive: true });
            targetPath = await getUniquePath(resolveInside(targetDir, path.basename(found.path)), found.path);
        }

        await writeJson(targetPath, next);
        if (path.resolve(targetPath) !== path.resolve(found.path)) await removeFile(found.path);
        return next;
    });
    res.json(chapter);
}));

router.delete('/:id', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    await withChapterLock(novelId, async () => {
        const root = chaptersDir(novelId);
        if (req.params.id.startsWith('vol_')) {
            const volumeId = normalizeVolumeId(req.params.id);
            const volumeDir = chapterTargetDir(root, volumeId);
            if (await exists(volumeDir)) {
                for (const file of await listJsonNames(volumeDir)) {
                    const source = resolveInside(volumeDir, file);
                    const chapter = await readJson(source);
                    chapter.volumeId = '';
                    chapter.updated = Date.now();
                    const target = await getUniquePath(resolveInside(root, file), source);
                    await writeJson(target, chapter);
                    await removeFile(source);
                }
                await fs.rm(volumeDir, { recursive: true, force: true });
                return;
            }
        }

        const found = await findChapterFile(root, req.params.id);
        if (!found) throw new ApiError(404, 'Chapter not found', 'NOT_FOUND');
        const backupDir = path.join(getDataRoot(), 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        await fs.copyFile(found.path, path.join(backupDir, `${req.params.id}_${Date.now()}.json`));
        await removeFile(found.path);
    });
    res.json({ success: true });
}));

function chaptersDir(novelId) {
    return projectFile(novelId, 'chapters');
}

function withChapterLock(novelId, operation) {
    return enqueueFileWrite(projectFile(novelId, '.chapters-write-lock'), operation);
}

async function listChapterItems(root, novelId) {
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    const items = [];
    for (const entry of entries) {
        const full = resolveInside(root, entry.name);
        if (entry.isDirectory()) {
            const volumeId = `vol_${entry.name}`;
            items.push({ id: volumeId, novelId, type: 'volume', title: entry.name, volumeId: '', order: 0 });
            for (const file of (await listJsonNames(full)).sort()) {
                const chapter = await tryReadChapter(resolveInside(full, file));
                if (chapter) items.push(lightChapter(chapter, volumeId));
            }
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            const data = await tryReadChapter(full);
            if (!data) continue;
            if (entry.name.startsWith('vol_') || data.type === 'volume') {
                items.push({ id: data.id, novelId, type: 'volume', title: data.title, volumeId: '', order: data.order || 0 });
            } else {
                items.push(lightChapter(data, ''));
            }
        }
    }
    return items;
}

async function findChapterFile(rootDir, id) {
    let entries;
    try {
        entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
    for (const entry of entries) {
        const full = resolveInside(rootDir, entry.name);
        if (entry.isDirectory()) {
            const found = await findChapterFile(full, id);
            if (found) return found;
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            const data = await tryReadChapter(full);
            if (data?.id === id) return { path: full, data };
        }
    }
    return null;
}

async function tryReadChapter(filePath) {
    try {
        return await readJson(filePath);
    } catch (err) {
        if (err.code === 'CORRUPT_JSON') return null;
        throw err;
    }
}

function lightChapter(chapter, volumeId) {
    return {
        id: chapter.id,
        novelId: chapter.novelId,
        type: chapter.type || 'chapter',
        title: chapter.title,
        volumeId,
        wordCount: chapter.wordCount || 0,
        status: chapter.status || 'draft',
        order: chapter.order || 0,
        created: chapter.created,
        updated: chapter.updated,
    };
}

function normalizeVolumeId(value) {
    if (!value) return '';
    const volumeId = String(value);
    if (!volumeId.startsWith('vol_')) throw new ApiError(400, 'Invalid volumeId', 'VALIDATION_ERROR');
    const name = volumeId.slice(4);
    if (!name || safeFileBase(name, 'volume') !== name) {
        throw new ApiError(400, 'Invalid volumeId', 'VALIDATION_ERROR');
    }
    return volumeId;
}

function chapterTargetDir(root, volumeId) {
    return volumeId ? resolveInside(root, volumeId.slice(4)) : root;
}

function safeFileBase(value, fallback) {
    return sanitize(String(value || '')).substring(0, 100) || fallback;
}

async function listJsonNames(dir) {
    try {
        return (await fs.readdir(dir)).filter(file => file.endsWith('.json'));
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

async function getUniquePath(targetPath, currentPath) {
    if (path.resolve(targetPath) === path.resolve(currentPath)) return targetPath;
    if (!await exists(targetPath)) return targetPath;
    const parsed = path.parse(targetPath);
    for (let index = 2; index < 1000; index += 1) {
        const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
        if (!await exists(candidate)) return candidate;
    }
    return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
}

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
    }
}

function countWords(content = '') {
    const chinese = (content.match(/[\u3400-\u9fff]/g) || []).length;
    const other = (content.match(/[a-zA-Z0-9]+/g) || []).length;
    return chinese + other;
}
