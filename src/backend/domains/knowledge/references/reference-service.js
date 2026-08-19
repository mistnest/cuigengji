import fs from 'node:fs/promises';
import path from 'node:path';

import sanitize from 'sanitize-filename';

import {
    AppError,
    projectFile,
    readJson,
    requireObject,
    requireString,
    updateJson,
    writeJson,
} from '../../../foundation/platform/index.js';
import { ensureCharacterSummaries, ensureWorldBookSummaries } from '../summaries/reference-summaries.js';

export async function saveWorldBook(projectId, name, data) {
    requireProjectId(projectId);
    requireObject(data, 'data');
    requireObject(data.entries, 'data.entries');
    const filePath = projectAssetFile(projectId, 'worldbooks', name || 'worldbook');
    await writeJson(filePath, ensureWorldBookSummaries(data).data);
    return { success: true, name: safeAssetName(name || 'worldbook'), path: filePath };
}

export async function listWorldBooks(projectId) {
    requireProjectId(projectId);
    return listJsonFiles(projectFile(projectId, 'assets', 'worldbooks'));
}

export async function getWorldBook(projectId, name) {
    requireProjectId(projectId);
    try {
        return await readJson(projectAssetFile(projectId, 'worldbooks', name));
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new AppError('NOT_FOUND', 'World book not found', { status: 404 });
        }
        throw error;
    }
}

export async function updateWorldBookEntry(projectId, bookName, uid, entry) {
    requireProjectId(projectId);
    if (uid === undefined || uid === null) {
        throw new AppError('VALIDATION_ERROR', 'uid is required', { status: 400 });
    }
    requireObject(entry, 'entry');
    const filePath = projectAssetFile(projectId, 'worldbooks', bookName || 'worldbook');
    await updateJson(filePath, book => ensureWorldBookSummaries({
        ...book,
        entries: {
            ...(book.entries || {}),
            [uid]: entry,
        },
    }).data);
    return { success: true };
}

export async function saveCharacter(projectId, data) {
    requireProjectId(projectId);
    requireObject(data, 'data');
    const name = data.data?.name || data.name || 'character';
    const filePath = projectAssetFile(projectId, 'characters', name);
    const character = ensureCharacterSummaries([data]).data[0];
    await writeJson(filePath, character);
    return { success: true, name: safeAssetName(name), path: filePath, character };
}

export async function listCharacters(projectId) {
    requireProjectId(projectId);
    const entries = await listJsonFiles(projectFile(projectId, 'assets', 'characters'));
    return Promise.all(entries.map(async entry => {
        try {
            return { ...entry, data: await readJson(entry.path) };
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
