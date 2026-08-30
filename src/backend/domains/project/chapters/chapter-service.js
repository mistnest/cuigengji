import fs from 'node:fs/promises';
import path from 'node:path';

import sanitize from 'sanitize-filename';
import { v4 as uuidv4 } from 'uuid';

import {
    AppError,
    assertExpectedRevision,
    expectedContentHashFrom,
    enqueueFileWrite,
    getDataRoot,
    getVersionStamp,
    projectFile,
    publishDomainChange,
    readJson,
    readRevision,
    readUpdatedAt,
    removeFile,
    requireString,
    resolveInside,
    withVersion,
    writeJson,
} from '../../../foundation/platform/index.js';
import {
    applyAiReferenceSummary,
    ensureChapterSummary,
} from '../../knowledge/index.js';

const chapterPathIndexes = new Map();
const VOLUME_METADATA_FILE = '.volume.json';

export async function listChapters(projectId) {
    const id = requireProjectId(projectId);
    const root = chaptersDir(id);
    const items = await listChapterItems(root, id);
    const volumes = items
        .filter(item => item.type === 'volume')
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)
            || a.title.localeCompare(b.title, 'zh-CN'));
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
    return ordered;
}

export async function getChapter(projectId, chapterId) {
    const id = requireProjectId(projectId);
    const found = await findChapterFile(chaptersDir(id), requireChapterId(chapterId));
    if (!found) throw notFound();
    return withRevision(found.data);
}

export async function createChapter(projectId, input = {}) {
    const id = requireProjectId(projectId);
    return withChapterLock(id, async () => {
        const root = chaptersDir(id);
        if (input.type === 'volume') {
            const title = String(input.title || '未命名卷').trim().slice(0, 200) || '未命名卷';
            const volumeName = await getUniqueDirectoryName(root, safeFileBase(title, 'volume'));
            const volumeDir = resolveInside(root, volumeName);
            const now = Date.now();
            const volume = {
                schemaVersion: 1,
                id: `vol_${volumeName}`,
                novelId: id,
                type: 'volume',
                title,
                volumeId: '',
                order: await nextVolumeOrder(root),
                created: now,
                updated: now,
                revision: 1,
            };
            const versionedVolume = withVersion(volume, 1, now);
            await fs.mkdir(volumeDir, { recursive: false });
            await writeJson(resolveInside(volumeDir, VOLUME_METADATA_FILE), versionedVolume);
            publishDomainChange({
                projectId: id,
                entityType: 'volume',
                entityId: versionedVolume.id,
                operation: 'created',
                beforeRevision: 0,
                revision: versionedVolume.revision,
                updatedAt: versionedVolume.updatedAt,
                contentHash: versionedVolume.contentHash,
                changedFields: Object.keys(versionedVolume),
                actor: input.actor,
            });
            return versionedVolume;
        }

        const content = typeof input.content === 'string' ? input.content : '';
        const now = Date.now();
        let chapter = {
            id: uuidv4(),
            novelId: id,
            type: 'chapter',
            title: String(input.title || '未命名章节'),
            content,
            status: 'draft',
            wordCount: countWords(content),
            created: now,
            updated: now,
            revision: 1,
            notes: '',
            plotPoints: [],
            order: Number(input.order || 0),
            volumeId: normalizeVolumeId(input.volumeId),
        };
        chapter = withVersion(ensureChapterSummary(chapter).chapter, 1, now);
        const targetDir = chapterTargetDir(root, chapter.volumeId);
        await fs.mkdir(targetDir, { recursive: true });
        const existing = await listJsonNames(targetDir);
        const prefix = String(existing.length + 1).padStart(3, '0');
        const filename = `${safeFileBase(`${prefix}-${chapter.title}`, 'chapter')}.json`;
        const filePath = resolveInside(targetDir, filename);
        await writeJson(filePath, chapter);
        setIndexedChapterPath(root, chapter.id, filePath);
        publishDomainChange({
            projectId: id,
            entityType: 'chapter',
            entityId: chapter.id,
            operation: 'created',
            beforeRevision: 0,
            revision: chapter.revision,
            updatedAt: chapter.updatedAt,
            contentHash: chapter.contentHash,
            changedFields: Object.keys(chapter),
            actor: input.actor,
        });
        return chapter;
    });
}

export async function updateChapter(projectId, chapterId, patch = {}) {
    const id = requireProjectId(projectId);
    const targetId = requireChapterId(chapterId);
    return withChapterLock(id, async () => {
        const root = chaptersDir(id);
        const found = await findChapterFile(root, targetId);
        if (!found) throw notFound();

        const currentRevision = readRevision(found.data);
        assertExpectedRevision(found.data, patch.expectedRevision, `chapter:${id}/${targetId}`, {
            expectedContentHash: expectedContentHashFrom(patch),
            includeCurrent: true,
        });

        const next = { ...found.data };
        if (patch.title !== undefined) next.title = String(patch.title);
        if (patch.content !== undefined) {
            next.content = String(patch.content);
            next.wordCount = countWords(next.content);
        }
        if (patch.order !== undefined) next.order = Number(patch.order) || 0;
        if (patch.summary !== undefined) {
            next.summary = String(patch.summary);
            next.summaryGenerator = 'manual';
            next.summaryUpdatedAt = Date.now();
        }
        // AI-generated summaries travel through the same chapter CAS path as
        // human edits.  Keeping the metadata update here prevents a long
        // running extraction job from writing a stale JSON snapshot directly
        // over a newer chapter revision.
        if (patch.aiSummary !== undefined) {
            const summarized = applyAiReferenceSummary('chapter', next, patch.aiSummary);
            Object.assign(next, summarized.item);
        }
        const now = Date.now();
        next.updated = now;
        next.revision = currentRevision + 1;
        // CAS metadata belongs to the transport layer, never to the chapter
        // document.  Removing every accepted control field here keeps a
        // renderer payload from becoming durable manuscript data (and keeps
        // later content hashes independent of the caller's stale token).
        for (const key of [
            'expectedRevision', 'baseRevision', 'expectedContentHash',
            'baseContentHash', 'actor', 'version', 'contentHash', 'updatedAt',
        ]) delete next[key];

        let targetPath = found.path;
        if (patch.volumeId !== undefined) {
            next.volumeId = normalizeVolumeId(patch.volumeId);
            const targetDir = chapterTargetDir(root, next.volumeId);
            await fs.mkdir(targetDir, { recursive: true });
            targetPath = await getUniquePath(resolveInside(targetDir, path.basename(found.path)), found.path);
        }

        const summarized = withVersion(ensureChapterSummary(next).chapter, next.revision, now);
        await writeJson(targetPath, summarized);
        if (path.resolve(targetPath) !== path.resolve(found.path)) await removeFile(found.path);
        setIndexedChapterPath(root, summarized.id, targetPath);
        publishDomainChange({
            projectId: id,
            entityType: 'chapter',
            entityId: summarized.id,
            operation: 'updated',
            beforeRevision: currentRevision,
            revision: summarized.revision,
            updatedAt: summarized.updatedAt,
            contentHash: summarized.contentHash,
            changedFields: changedFields(found.data, summarized),
            actor: patch.actor,
        });
        return summarized;
    });
}

export async function deleteChapter(projectId, chapterId, options = {}) {
    if (options.confirmed !== true) {
        throw new AppError('DELETE_CONFIRMATION_REQUIRED', 'Chapter delete confirmation is required', {
            status: 409,
            publicMessage: '删除章节前需要确认。',
        });
    }
    const id = requireProjectId(projectId);
    const targetId = requireChapterId(chapterId);
    const changeEvents = [];
    let deletedRevision = 0;
    await withChapterLock(id, async () => {
        const root = chaptersDir(id);
        if (targetId.startsWith('vol_')) {
            const volumeId = normalizeVolumeId(targetId);
            const volumeDir = chapterTargetDir(root, volumeId);
            if (await exists(volumeDir)) {
                const metadata = await readVolumeMetadata(volumeDir);
                assertExpectedRevision(metadata || {}, options.expectedRevision, `volume:${id}/${targetId}`, {
                    expectedContentHash: expectedContentHashFrom(options),
                    includeCurrent: true,
                });
                for (const file of await listJsonNames(volumeDir)) {
                    const source = resolveInside(volumeDir, file);
                    const chapter = await readJson(source);
                    chapter.volumeId = '';
                    const now = Date.now();
                    const beforeRevision = readRevision(chapter);
                    chapter.updated = now;
                    chapter.revision = beforeRevision + 1;
                    const target = await getUniquePath(resolveInside(root, file), source);
                    const moved = withVersion(ensureChapterSummary(chapter).chapter, chapter.revision, now);
                    await writeJson(target, moved);
                    await removeFile(source);
                    changeEvents.push({
                        projectId: id,
                        entityType: 'chapter',
                        entityId: moved.id,
                        operation: 'updated',
                        beforeRevision,
                        revision: moved.revision,
                        updatedAt: moved.updatedAt,
                        contentHash: moved.contentHash,
                        changedFields: ['volumeId'],
                        actor: options.actor,
                    });
                }
                await fs.rm(volumeDir, { recursive: true, force: true });
                deletedRevision = readRevision(metadata) + 1;
                changeEvents.push({
                    projectId: id,
                    entityType: 'volume',
                    entityId: targetId,
                    operation: 'deleted',
                    beforeRevision: readRevision(metadata),
                    revision: deletedRevision,
                    updatedAt: Date.now(),
                    changedFields: [],
                    actor: options.actor,
                });
                return;
            }
        }

        const found = await findChapterFile(root, targetId);
        if (!found) throw notFound();
        const beforeRevision = readRevision(found.data);
        assertExpectedRevision(found.data, options.expectedRevision, `chapter:${id}/${targetId}`, {
            expectedContentHash: expectedContentHashFrom(options),
            includeCurrent: true,
        });
        const backupDir = path.join(getDataRoot(), 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        await fs.copyFile(found.path, path.join(backupDir, `${targetId}_${Date.now()}.json`));
        await removeFile(found.path);
        deleteIndexedChapterPath(root, targetId);
        deletedRevision = beforeRevision + 1;
        changeEvents.push({
            projectId: id,
            entityType: 'chapter',
            entityId: targetId,
            operation: 'deleted',
            beforeRevision,
            revision: deletedRevision,
            updatedAt: Date.now(),
            contentHash: '',
            changedFields: [],
            actor: options.actor,
        });
    });
    for (const event of changeEvents) publishDomainChange(event);
    return { success: true, revision: deletedRevision };
}

function requireProjectId(value) {
    return requireString(value, 'projectId', { maxLength: 100 });
}

function requireChapterId(value) {
    return requireString(value, 'chapterId', { maxLength: 120 });
}

function notFound() {
    return new AppError('NOT_FOUND', 'Chapter not found', { status: 404 });
}

function chaptersDir(projectId) {
    return projectFile(projectId, 'chapters');
}

function withChapterLock(projectId, operation) {
    return enqueueFileWrite(projectFile(projectId, '.chapters-write-lock'), operation);
}

async function listChapterItems(root, projectId) {
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const groups = await Promise.all(entries.map(async entry => {
        const full = resolveInside(root, entry.name);
        if (entry.isDirectory()) {
            const volumeId = `vol_${entry.name}`;
            const metadata = await readVolumeMetadata(full);
            const volumeVersion = getVersionStamp(metadata || {});
            const files = (await listJsonNames(full)).sort();
            const chapters = await Promise.all(files.map(async file => {
                const filePath = resolveInside(full, file);
                const chapter = await tryReadChapter(filePath, { summarize: false });
                if (chapter?.id) setIndexedChapterPath(root, chapter.id, filePath);
                return chapter ? lightChapter(chapter, volumeId) : null;
            }));
            return [
                {
                    id: volumeId,
                    novelId: projectId,
                    type: 'volume',
                    title: metadata?.title || entry.name,
                    volumeId: '',
                    order: Number(metadata?.order || 0),
                    created: metadata?.created,
                    updated: metadata?.updated,
                    revision: volumeVersion.revision,
                    updatedAt: volumeVersion.updatedAt,
                    contentHash: volumeVersion.contentHash,
                },
                ...chapters.filter(Boolean),
            ];
        }
        if (!entry.isFile() || !entry.name.endsWith('.json')) return [];
        const data = await tryReadChapter(full, { summarize: false });
        if (!data) return [];
        if (entry.name.startsWith('vol_') || data.type === 'volume') {
            const version = getVersionStamp(data);
            return [{
                id: data.id,
                novelId: projectId,
                type: 'volume',
                title: data.title,
                volumeId: '',
                order: data.order || 0,
                revision: version.revision,
                updatedAt: version.updatedAt,
                contentHash: version.contentHash,
            }];
        }
        if (data.id) setIndexedChapterPath(root, data.id, full);
        return [lightChapter(data, '')];
    }));
    return groups.flat();
}

async function findChapterFile(rootDir, id) {
    const indexedPath = getIndexedChapterPath(rootDir, id);
    if (indexedPath) {
        const data = await tryReadChapter(indexedPath).catch(error => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (data?.id === id) return { path: indexedPath, data };
        deleteIndexedChapterPath(rootDir, id);
    }

    let entries;
    try {
        entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
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

function getChapterPathIndex(rootDir) {
    const key = path.resolve(rootDir);
    if (!chapterPathIndexes.has(key)) chapterPathIndexes.set(key, new Map());
    return chapterPathIndexes.get(key);
}

function setIndexedChapterPath(rootDir, id, filePath) {
    if (id) getChapterPathIndex(rootDir).set(id, filePath);
}

function getIndexedChapterPath(rootDir, id) {
    return getChapterPathIndex(rootDir).get(id);
}

function deleteIndexedChapterPath(rootDir, id) {
    getChapterPathIndex(rootDir).delete(id);
}

async function tryReadChapter(filePath, { summarize = true } = {}) {
    try {
        const chapter = await readJson(filePath);
        if (!summarize) return chapter;
        return ensureChapterSummary(chapter).chapter;
    } catch (error) {
        if (error.code === 'CORRUPT_JSON') return null;
        throw error;
    }
}

function withRevision(chapter) {
    const normalized = ensureChapterSummary(chapter).chapter;
    return withVersion(normalized, readRevision(chapter), readUpdatedAt(chapter, Date.now()));
}

function lightChapter(chapter, volumeId) {
    const version = getVersionStamp(chapter);
    return {
        id: chapter.id,
        novelId: chapter.novelId,
        type: chapter.type || 'chapter',
        title: chapter.title,
        volumeId,
        wordCount: chapter.wordCount || 0,
        status: chapter.status || 'draft',
        order: chapter.order || 0,
        revision: version.revision,
        created: chapter.created,
        updated: chapter.updated,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
    };
}

function changedFields(previous, next) {
    const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
    return [...keys].filter(key => ![
        'revision', 'updatedAt', 'updated', 'savedAt', 'contentHash',
    ].includes(key) && JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key]));
}

function normalizeVolumeId(value) {
    if (!value) return '';
    const volumeId = String(value);
    if (!volumeId.startsWith('vol_')) {
        throw new AppError('VALIDATION_ERROR', 'Invalid volumeId', { status: 400 });
    }
    const name = volumeId.slice(4);
    if (!name || safeFileBase(name, 'volume') !== name) {
        throw new AppError('VALIDATION_ERROR', 'Invalid volumeId', { status: 400 });
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
        return (await fs.readdir(dir)).filter(file => (
            file !== VOLUME_METADATA_FILE && file.endsWith('.json')
        ));
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

async function readVolumeMetadata(volumeDir) {
    try {
        return await readJson(resolveInside(volumeDir, VOLUME_METADATA_FILE));
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'CORRUPT_JSON') return null;
        throw error;
    }
}

async function nextVolumeOrder(root) {
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return 0;
        throw error;
    }
    return entries.filter(entry => (
        entry.isDirectory()
        || (entry.isFile() && entry.name.startsWith('vol_') && entry.name.endsWith('.json'))
    )).length;
}

async function getUniqueDirectoryName(root, baseName) {
    if (!await exists(resolveInside(root, baseName))) return baseName;
    for (let index = 2; index < 1000; index += 1) {
        const candidate = `${baseName}-${index}`;
        if (!await exists(resolveInside(root, candidate))) return candidate;
    }
    return `${baseName}-${Date.now()}`;
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
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

function countWords(content = '') {
    const chinese = (content.match(/[\u3400-\u9fff]/g) || []).length;
    const other = (content.match(/[a-zA-Z0-9]+/g) || []).length;
    return chinese + other;
}
