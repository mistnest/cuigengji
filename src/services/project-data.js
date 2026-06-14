import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../lib/http.js';
import { novelDir as resolveNovelDir } from '../lib/project-paths.js';

export async function loadProjectContext(novelId, fallback = {}) {
    const workspace = await readWorkspace(novelId);
    const novelConfig = await readJson(path.join(novelDir(novelId), 'novel.json')) || {};
    const worldBookResult = await loadWorldBook(novelId, workspace, fallback.worldBookEntries);
    const characterResult = await loadCharacters(novelId, workspace, fallback.characters);
    const chapters = await loadChapters(novelId);
    const plotMemory = buildPlotMemory({ chapters, outline: fallback.outline || [] });

    return {
        workspace,
        novelConfig,
        worldBook: worldBookResult.data,
        characters: characterResult.data,
        chapters,
        plotMemory,
        sources: {
            worldBook: worldBookResult.source,
            characters: characterResult.source,
            chapters: chapters.length,
        },
    };
}

export async function readWorkspace(novelId) {
    return await readJson(path.join(novelDir(novelId), 'workspace.json')) || {};
}

async function loadWorldBook(novelId, workspace, fallbackEntries = []) {
    if (workspace.worldBook?.entries) {
        return { data: workspace.worldBook, source: 'workspace' };
    }

    const assetDir = path.join(novelDir(novelId), 'assets', 'worldbooks');
    if (await exists(assetDir)) {
        const files = (await fs.readdir(assetDir)).filter(file => file.endsWith('.json')).sort();
        for (const file of files) {
            const book = await readJson(path.join(assetDir, file));
            if (book?.entries) return { data: book, source: `project_asset:${file}` };
        }
    }

    return {
        data: {
            entries: Object.fromEntries((fallbackEntries || []).map((entry, index) => [index, {
                uid: index,
                key: [entry.name].filter(Boolean),
                comment: entry.name || '',
                content: entry.content || '',
                selective: true,
                disable: false,
                order: 100,
                position: 0,
            }])),
        },
        source: 'request_summary',
    };
}

async function loadCharacters(novelId, workspace, fallbackCharacters = []) {
    if (Array.isArray(workspace.characters)) {
        return { data: workspace.characters, source: 'workspace' };
    }

    const result = [];
    const seen = new Set();
    const assetDir = path.join(novelDir(novelId), 'assets', 'characters');
    const hasAssets = await exists(assetDir);
    if (hasAssets) {
        for (const file of (await fs.readdir(assetDir)).filter(item => item.endsWith('.json')).sort()) {
            const data = await readJson(path.join(assetDir, file));
            if (!data) continue;
            const name = data.data?.name || data.name || file.replace(/\.json$/i, '');
            if (seen.has(name)) continue;
            result.push(data);
            seen.add(name);
        }
    }

    for (const character of fallbackCharacters || []) {
        const name = character.data?.name || character.name || '';
        if (!name || seen.has(name)) continue;
        result.push(character);
        seen.add(name);
    }

    return {
        data: result,
        source: result.length && hasAssets ? 'project_assets' : 'request_summary',
    };
}

async function loadChapters(novelId) {
    const root = path.join(novelDir(novelId), 'chapters');
    if (!await exists(root)) return [];
    const chapters = [];

    const visit = async (dir, volumeTitle = '') => {
        const entries = (await fs.readdir(dir, { withFileTypes: true }))
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await visit(full, entry.name);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('vol_')) continue;
            const chapter = await readJson(full);
            if (!chapter || chapter.type === 'volume') continue;
            chapters.push({
                ...chapter,
                volumeTitle,
                _path: full,
            });
        }
    };

    await visit(root);
    return chapters.sort((a, b) => {
        const ao = Number(a.order || 0);
        const bo = Number(b.order || 0);
        if (ao !== bo) return ao - bo;
        return String(a._path).localeCompare(String(b._path), 'zh-CN');
    });
}

function buildPlotMemory({ chapters = [], outline = [] }) {
    const chapterSummaries = chapters
        .filter(chapter => chapter.content || chapter.notes || chapter.plotPoints?.length)
        .map(chapter => ({
            title: chapter.title || 'Untitled chapter',
            summary: buildChapterDigest(chapter),
            updated: chapter.updated || chapter.created || 0,
            wordCount: chapter.wordCount || (chapter.content || '').length,
        }))
        .filter(item => item.summary);

    const keyEvents = [];
    for (const chapter of chapters) {
        for (const point of chapter.plotPoints || []) {
            keyEvents.push({
                title: chapter.title || 'Untitled chapter',
                content: typeof point === 'string' ? point : (point.title || point.description || JSON.stringify(point)),
            });
        }
        if (chapter.notes) {
            keyEvents.push({ title: chapter.title || 'Untitled chapter', content: chapter.notes });
        }
    }

    const openOutline = (outline || [])
        .filter(node => !node.completed)
        .map(node => ({
            title: node.title || '',
            content: node.description || '',
        }))
        .filter(node => node.title || node.content);

    return { chapterSummaries, keyEvents, openOutline };
}

function buildChapterDigest(chapter) {
    const parts = [];
    if (chapter.notes) parts.push(`Notes: ${chapter.notes}`);
    if (chapter.plotPoints?.length) {
        parts.push(`Plot points: ${chapter.plotPoints.map(point =>
            typeof point === 'string' ? point : (point.title || point.description || JSON.stringify(point)),
        ).join(' / ')}`);
    }
    const text = chapter.content || '';
    if (text.trim()) {
        const clean = text.replace(/\s+/g, ' ').trim();
        const head = clean.slice(0, 220);
        const tail = clean.length > 520 ? clean.slice(-300) : '';
        parts.push(tail ? `${head} ... ${tail}` : head);
    }
    return parts.join('\n');
}

function novelDir(novelId) {
    return resolveNovelDir(novelId || 'default');
}

async function readJson(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        if (err instanceof SyntaxError) {
            throw new ApiError(500, `Corrupt project data: ${path.basename(filePath)}`, 'CORRUPT_JSON');
        }
        throw err;
    }
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
