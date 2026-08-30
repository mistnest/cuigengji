import fs from 'node:fs/promises';
import path from 'node:path';

import sanitize from 'sanitize-filename';

import {
    AppError,
    expectedRevisionFrom,
    expectedContentHashFrom,
    getVersionStamp,
    projectFile,
    readRevision,
    readUpdatedAt,
    publishDomainChange,
    readJson,
    requireObject,
    requireString,
    updateVersionedJson,
    withVersion,
} from '../../../foundation/platform/index.js';
import { ensureCharacterSummaries, ensureWorldBookSummaries } from '../summaries/reference-summaries.js';

export async function saveWorldBook(projectId, name, data, options = {}) {
    requireProjectId(projectId);
    requireObject(data, 'data');
    requireObject(data.entries, 'data.entries');
    const safeName = safeAssetName(name || 'worldbook');
    const filePath = projectAssetFile(projectId, 'worldbooks', safeName);
    const expectedRevision = options.expectedRevision ?? expectedRevisionFrom(data);
    const actor = options.actor || data.actor;
    let previous;
    const saved = await updateVersionedJson(filePath, current => {
        previous = current;
        const candidate = stripControlFields(data);
        return ensureWorldBookSummaries(candidate).data;
    }, {
        defaultValue: { schemaVersion: 1, entries: {} },
        expectedRevision,
        expectedContentHash: expectedContentHashFrom(data) ?? options.expectedContentHash,
        resource: `worldbook:${projectId}/${safeName}`,
        includeCurrent: true,
    });
    const version = getVersionStamp(saved);
    publishDomainChange({
        projectId,
        entityType: 'worldbook',
        entityId: safeName,
        operation: previous && Object.keys(previous.entries || {}).length ? 'updated' : 'created',
        beforeRevision: readRevision(previous),
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
        changedFields: ['entries'],
        actor,
    });
    return {
        success: true,
        name: safeName,
        path: filePath,
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
    };
}

export async function listWorldBooks(projectId) {
    requireProjectId(projectId);
    return listJsonFiles(projectFile(projectId, 'assets', 'worldbooks'));
}

export async function getWorldBook(projectId, name) {
    requireProjectId(projectId);
    try {
        const data = await readJson(projectAssetFile(projectId, 'worldbooks', name));
        return withVersion(data, readRevision(data), readUpdatedAt(data));
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new AppError('NOT_FOUND', 'World book not found', { status: 404 });
        }
        throw error;
    }
}

export async function updateWorldBookEntry(projectId, bookName, uid, entry, options = {}) {
    requireProjectId(projectId);
    if (uid === undefined || uid === null) {
        throw new AppError('VALIDATION_ERROR', 'uid is required', { status: 400 });
    }
    requireObject(entry, 'entry');
    const safeName = safeAssetName(bookName || 'worldbook');
    const filePath = projectAssetFile(projectId, 'worldbooks', safeName);
    let previous;
    const saved = await updateVersionedJson(filePath, book => {
        previous = book;
        return ensureWorldBookSummaries({
            ...book,
            entries: {
                ...(book.entries || {}),
                [uid]: stripControlFields(entry),
            },
        }).data;
    }, {
        expectedRevision: options.expectedRevision ?? expectedRevisionFrom(entry),
        expectedContentHash: options.expectedContentHash ?? expectedContentHashFrom(entry),
        resource: `worldbook:${projectId}/${safeName}`,
        includeCurrent: true,
    });
    const version = getVersionStamp(saved);
    publishDomainChange({
        projectId,
        entityType: 'worldbook',
        entityId: safeName,
        operation: 'updated',
        beforeRevision: readRevision(previous),
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
        changedFields: [`entries.${String(uid)}`],
        actor: options.actor,
    });
    return {
        success: true,
        name: safeName,
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
    };
}

export async function saveCharacter(projectId, data, options = {}) {
    requireProjectId(projectId);
    requireObject(data, 'data');
    const name = data.data?.name || data.name || 'character';
    const safeName = safeAssetName(name);
    const filePath = projectAssetFile(projectId, 'characters', safeName);
    const expectedRevision = options.expectedRevision ?? expectedRevisionFrom(data);
    const actor = options.actor || data.actor;
    let previous;
    const character = ensureCharacterSummaries([stripControlFields(data)]).data[0];
    const saved = await updateVersionedJson(filePath, current => {
        previous = current;
        return character;
    }, {
        defaultValue: { schemaVersion: 1 },
        expectedRevision,
        expectedContentHash: expectedContentHashFrom(data) ?? options.expectedContentHash,
        resource: `character:${projectId}/${safeName}`,
        includeCurrent: true,
    });
    const version = getVersionStamp(saved);
    publishDomainChange({
        projectId,
        entityType: 'character',
        entityId: safeName,
        operation: previous && Object.keys(previous).length ? 'updated' : 'created',
        beforeRevision: readRevision(previous),
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
        changedFields: Object.keys(character || {}),
        actor,
    });
    return {
        success: true,
        name: safeName,
        path: filePath,
        character: saved,
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
    };
}

export async function listCharacters(projectId) {
    requireProjectId(projectId);
    const entries = await listJsonFiles(projectFile(projectId, 'assets', 'characters'));
    return Promise.all(entries.map(async entry => {
        try {
            const data = await readJson(entry.path);
            return { ...entry, data: withVersion(data, readRevision(data), readUpdatedAt(data)) };
        } catch (error) {
            if (error.code === 'CORRUPT_JSON') return { ...entry, data: null, error: error.code };
            throw error;
        }
    }));
}

async function listJsonFiles(dir) {
    let names;
    try {
        names = await fs.readdir(dir);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    return names
        .filter(name => name.endsWith('.json'))
        .map(name => ({
            name: name.replace(/\.json$/i, ''),
            path: path.join(dir, name),
        }));
}

function projectAssetFile(projectId, folder, name) {
    return projectFile(projectId, 'assets', folder, `${safeAssetName(name)}.json`);
}

function safeAssetName(name) {
    const safe = sanitize(String(name || '')).substring(0, 100);
    if (!safe) throw new AppError('INVALID_PATH', 'Invalid file name', { status: 400 });
    return safe;
}

function requireProjectId(value) {
    return requireString(value, 'projectId', { maxLength: 100 });
}

function stripControlFields(value) {
    const next = { ...(value || {}) };
    delete next.expectedRevision;
    delete next.baseRevision;
    delete next.expectedContentHash;
    delete next.baseContentHash;
    delete next.actor;
    delete next.version;
    delete next.contentHash;
    delete next.updatedAt;
    return next;
}
