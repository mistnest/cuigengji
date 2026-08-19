import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import sanitize from 'sanitize-filename';

import {
    allowWritesInside,
    AppError,
    novelDir,
    novelsRoot,
    readJson,
    requireString,
    resolveInside,
    safeSegment,
    withWriteBarrier,
    writeJson,
} from '../../../foundation/platform/index.js';

const DELETE_TOKEN_TTL_MS = 60_000;
const deleteTokens = new Map();

export async function listProjects() {
    const root = novelsRoot();
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const projects = await Promise.all(entries
        .filter(entry => entry.isDirectory())
        .map(async entry => {
            const dirPath = resolveInside(root, entry.name);
            const stat = await fs.stat(dirPath);
            let config = {
                title: entry.name,
                created: stat.birthtimeMs,
                updated: stat.mtimeMs,
            };
            try {
                config = { ...config, ...await readJson(path.join(dirPath, 'novel.json')) };
            } catch (error) {
                if (!['ENOENT', 'CORRUPT_JSON'].includes(error.code)) throw error;
            }
            const created = config.created || stat.birthtimeMs || 0;
            return {
                id: entry.name,
                title: config.title || entry.name,
                created,
                updated: config.updated || stat.mtimeMs || created,
            };
        }));

    return projects.sort((a, b) =>
        (b.updated || b.created || 0) - (a.updated || a.created || 0));
}

export async function createProject(input) {
    const title = requireString(input?.title, 'title', { maxLength: 200 }).trim();
    const id = sanitize(title).substring(0, 50) || Date.now().toString(36);
    const dir = novelDir(id);
    try {
        await fs.access(dir);
        throw new AppError('PROJECT_EXISTS', 'Project already exists', { status: 409 });
    } catch (error) {
        if (error instanceof AppError) throw error;
        if (error.code !== 'ENOENT') throw error;
    }

    allowWritesInside(dir);
    await Promise.all([
        fs.mkdir(path.join(dir, 'chapters'), { recursive: true }),
        fs.mkdir(path.join(dir, 'memory'), { recursive: true }),
        fs.mkdir(path.join(dir, 'sessions'), { recursive: true }),
    ]);
    const now = Date.now();
    const config = {
        schemaVersion: 1,
        novelId: id,
        title,
        author: '',
        genre: '',
        styleGuide: '',
        created: now,
        updated: now,
    };
    await writeJson(path.join(dir, 'novel.json'), config);
    return { id, config };
}

export async function requestProjectDeletion(projectId) {
    const id = safeSegment(projectId, 'project id');
    await requireProjectDirectory(id);
    const token = randomUUID();
    deleteTokens.set(token, {
        projectId: id,
        expiresAt: Date.now() + DELETE_TOKEN_TTL_MS,
    });
    pruneDeleteTokens();
    return { projectId: id, token, expiresAt: Date.now() + DELETE_TOKEN_TTL_MS };
}

export async function deleteProject(projectId, options = {}) {
    const id = safeSegment(projectId, 'project id');
    const dir = await requireProjectDirectory(id);
    if (!options.bypassConfirmation) consumeDeleteToken(id, options.confirmationToken);

    await withWriteBarrier(
        dir,
        () => fs.rm(dir, { recursive: true, force: true }),
        { keepBlocked: true },
    );
    return { success: true };
}

async function requireProjectDirectory(id) {
    const dir = resolveInside(novelsRoot(), id);
    try {
        const stat = await fs.stat(dir);
        if (!stat.isDirectory()) throw new AppError('NOT_FOUND', 'Project not found', { status: 404 });
        return dir;
    } catch (error) {
        if (error instanceof AppError) throw error;
        if (error.code === 'ENOENT') {
            throw new AppError('NOT_FOUND', 'Project not found', { status: 404 });
        }
        throw error;
    }
}

function consumeDeleteToken(projectId, token) {
    const record = typeof token === 'string' ? deleteTokens.get(token) : null;
    deleteTokens.delete(token);
    if (!record || record.projectId !== projectId || record.expiresAt < Date.now()) {
        throw new AppError('DELETE_CONFIRMATION_REQUIRED', 'Delete confirmation is missing or expired', {
            status: 409,
            publicMessage: '删除确认已失效，请重新确认。',
        });
    }
}

function pruneDeleteTokens() {
    const now = Date.now();
    for (const [token, record] of deleteTokens) {
        if (record.expiresAt < now) deleteTokens.delete(token);
    }
}
