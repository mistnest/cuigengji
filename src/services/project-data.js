import fs from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { getDataRoot } from '../config.js';

export function loadProjectContext(novelId, fallback = {}) {
    const workspace = readWorkspace(novelId);
    const novelConfig = readJson(path.join(novelDir(novelId), 'novel.json')) || {};
    const worldBook = loadWorldBook(novelId, workspace, novelConfig, fallback.worldBookEntries);
    const characters = loadCharacters(workspace, novelConfig, fallback.characters);
    const chapters = loadChapters(novelId);
    const plotMemory = buildPlotMemory({ chapters, outline: fallback.outline || [] });

    return {
        workspace,
        novelConfig,
        worldBook,
        characters,
        chapters,
        plotMemory,
        sources: {
            worldBook: worldBook._source || 'fallback',
            characters: characters._source || 'fallback',
            chapters: chapters.length,
        },
    };
}

export function readWorkspace(novelId) {
    return readJson(path.join(novelDir(novelId), 'workspace.json')) || {};
}

function loadWorldBook(novelId, workspace, novelConfig, fallbackEntries = []) {
    if (workspace.worldBook?.entries) {
        return { ...workspace.worldBook, _source: 'workspace' };
    }

    const names = [
        workspace.worldBookName,
        ...(novelConfig.linkedWorldBooks || []),
        novelId,
        'worldbook',
    ].filter(Boolean);

    for (const name of names) {
        const book = readJson(path.join(getDataRoot(), 'worlds', `${sanitize(name)}.json`));
        if (book?.entries) {
            return { ...book, _source: name };
        }
    }

    return {
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
        _source: 'request_summary',
    };
}

function loadCharacters(workspace, novelConfig, fallbackCharacters = []) {
    if (Array.isArray(workspace.characters)) {
        const characters = [...workspace.characters];
        characters._source = 'workspace';
        return characters;
    }

    const requestedNames = new Set([
        ...(workspace.characterNames || []),
        ...(novelConfig.linkedCharacters || []),
    ].filter(Boolean));
    const dir = path.join(getDataRoot(), 'characters');
    const result = [];
    const seen = new Set();

    if (requestedNames.size && fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
            const data = readJson(path.join(dir, file));
            if (!data) continue;
            const name = data.data?.name || data.name || file.replace(/\.json$/i, '');
            if (requestedNames.size && !requestedNames.has(name) && !requestedNames.has(file.replace(/\.json$/i, ''))) continue;
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

    result._source = result.length && requestedNames.size ? 'workspace' : 'request_summary';
    return result;
}

function loadChapters(novelId) {
    const root = path.join(novelDir(novelId), 'chapters');
    if (!fs.existsSync(root)) return [];
    const chapters = [];

    const visit = (dir, volumeTitle = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                visit(full, entry.name);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('vol_')) continue;
            const chapter = readJson(full);
            if (!chapter || chapter.type === 'volume') continue;
            chapters.push({
                ...chapter,
                volumeTitle,
                _path: full,
            });
        }
    };

    visit(root);
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
    return path.join(getDataRoot(), 'novels', sanitize(novelId || 'default'));
}

function readJson(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}
