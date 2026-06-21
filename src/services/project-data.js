import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../lib/http.js';
import { novelDir as resolveNovelDir } from '../lib/project-paths.js';
import { ensureChapterSummaries, ensureCharacterSummaries, ensureWorldBookSummaries, getChapterSummary } from './reference-summaries.js';

export async function loadProjectContext(novelId, fallback = {}) {
    const workspace = await readWorkspace(novelId);
    const novelConfig = await readJson(path.join(novelDir(novelId), 'novel.json')) || {};
    const worldBookResult = await loadWorldBook(novelId, workspace, fallback.worldBook || fallback.worldBookEntries);
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
    const assetBook = await loadWorldBookAssets(novelId);
    if (workspace.worldBook?.entries && Object.keys(workspace.worldBook.entries).length) {
        const merged = {
            ...assetBook.data,
            ...workspace.worldBook,
            entries: {
                ...(assetBook.data.entries || {}),
                ...(workspace.worldBook.entries || {}),
            },
            folders: [
                ...new Set([
                    ...(assetBook.data.folders || []),
                    ...(workspace.worldBook.folders || []),
                ].filter(Boolean)),
            ],
        };
        return {
            data: ensureWorldBookSummaries(normalizeWorldBookFolders(merged)).data,
            source: assetBook.count ? 'workspace+project_assets' : 'workspace',
        };
    }

    if (assetBook.count) {
        return { data: ensureWorldBookSummaries(assetBook.data).data, source: 'project_assets' };
    }

    if (fallbackEntries?.entries) {
        return {
            data: ensureWorldBookSummaries(normalizeWorldBookFolders(fallbackEntries)).data,
            source: 'request_worldbook',
        };
    }

    const fallbackBook = {
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
    };

    return {
        data: ensureWorldBookSummaries(fallbackBook).data,
        source: 'request_summary',
    };
}

async function loadWorldBookAssets(novelId) {
    const assetDir = path.join(novelDir(novelId), 'assets', 'worldbooks');
    const result = { entries: {}, folders: [] };
    let count = 0;
    if (await exists(assetDir)) {
        const files = await listJsonFilesRecursive(assetDir);
        for (const file of files) {
            const book = await readJson(file);
            if (!book?.entries) continue;
            const rel = path.relative(assetDir, file);
            const folder = inferWorldBookFolder(rel);
            if (folder) result.folders.push(folder);
            for (const [key, entry] of Object.entries(book.entries || {})) {
                const normalized = {
                    ...entry,
                    folder: entry.folder || entry._folder || folder,
                    _folder: entry.folder || entry._folder || folder,
                    _source: entry._source || folder,
                    sourceGroup: entry.sourceGroup || entry.group || '',
                };
                const finalKey = result.entries[key] ? `${rel}:${key}` : key;
                result.entries[finalKey] = normalized;
                count++;
            }
        }
    }
    return {
        data: normalizeWorldBookFolders(result),
        count,
    };
}

function inferWorldBookFolder(relativeFile) {
    const dir = path.dirname(relativeFile);
    if (dir && dir !== '.') return dir.split(path.sep).join('/');
    return path.basename(relativeFile, path.extname(relativeFile));
}

function normalizeWorldBookFolders(worldBook = {}) {
    const folders = new Set((worldBook.folders || []).map(item => String(item || '').trim()).filter(Boolean));
    for (const entry of Object.values(worldBook.entries || {})) {
        if (entry.group && !entry.sourceGroup) entry.sourceGroup = entry.group;
        const folder = String(entry.folder || entry._folder || entry._source || entry.group || '').trim();
        if (!folder) continue;
        entry.folder = folder;
        entry._folder = folder;
        folders.add(folder);
    }
    return {
        ...worldBook,
        folders: [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    };
}

async function loadCharacters(novelId, workspace, fallbackCharacters = []) {
    if (Array.isArray(workspace.characters) && workspace.characters.length) {
        return { data: ensureCharacterSummaries(workspace.characters).data, source: 'workspace' };
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
        data: ensureCharacterSummaries(result).data,
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
    const sorted = chapters.sort((a, b) => {
        const ao = Number(a.order || 0);
        const bo = Number(b.order || 0);
        if (ao !== bo) return ao - bo;
        return String(a._path).localeCompare(String(b._path), 'zh-CN');
    });
    return ensureChapterSummaries(sorted).data;
}

function autoSummary(chapter = {}) {
    const text = (chapter.content || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 200) + (text.length > 200 ? '...' : '');
}

function buildPlotMemory({ chapters = [], outline = [] }) {
    const chapterSummaries = chapters
        .filter(chapter => chapter.content || chapter.notes || chapter.plotPoints?.length)
        .map(chapter => ({
            title: chapter.title || 'Untitled chapter',
            summary: getChapterSummary(chapter) || autoSummary(chapter),
            order: Number(chapter.order || 0),
            updated: chapter.updated || chapter.created || 0,
            wordCount: chapter.wordCount || (chapter.content || '').length,
        }));
    // 不再丢弃无摘要的章节——用 autoSummary 兜底，保证章节列表完整

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

async function listJsonFilesRecursive(root) {
    const files = [];
    const visit = async dir => {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (err) {
            if (err.code === 'ENOENT') return;
            throw err;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await visit(full);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
        }
    };
    await visit(root);
    return files;
}
