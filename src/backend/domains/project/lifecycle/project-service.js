import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import sanitize from 'sanitize-filename';

import {
    allowWritesInside,
    AppError,
    getVersionStamp,
    novelDir,
    novelsRoot,
    publishDomainChange,
    readJson,
    requireString,
    resolveInside,
    safeSegment,
    withVersion,
    withWriteBarrier,
    writeJson,
} from '../../../foundation/platform/index.js';

const DELETE_TOKEN_TTL_MS = 60_000;
const deleteTokens = new Map();
const projectLifecycleLocks = new Map();

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
            const version = getVersionStamp(config);
            return {
                id: entry.name,
                title: config.title || entry.name,
                created,
                updated: config.updated || stat.mtimeMs || created,
                revision: version.revision,
                updatedAt: version.updatedAt || config.updated || stat.mtimeMs || created,
                contentHash: version.contentHash,
            };
        }));

    return projects.sort((a, b) =>
        (b.updated || b.created || 0) - (a.updated || a.created || 0));
}

export async function createProject(input) {
    const title = requireString(input?.title, 'title', { maxLength: 200 }).trim();
    const id = sanitize(title).substring(0, 50) || Date.now().toString(36);
    const dir = novelDir(id);
    return withProjectLifecycleLock(id, async () => {
        try {
            await fs.access(dir);
            throw new AppError('PROJECT_EXISTS', 'Project already exists', { status: 409 });
        } catch (error) {
            if (error instanceof AppError) throw error;
            if (error.code !== 'ENOENT') throw error;
        }

        // `access` above is only a friendly error check.  The exclusive mkdir
        // is the actual collision guard, so two renderer/Agent requests for
        // the same title cannot both create a project directory and then
        // overwrite its metadata.  The lifecycle lock also prevents a
        // same-process delete from removing a directory after this check.
        allowWritesInside(dir);
        let createdDirectory = false;
        try {
            await fs.mkdir(novelsRoot(), { recursive: true });
            await fs.mkdir(dir, { recursive: false });
            createdDirectory = true;
            await Promise.all([
                fs.mkdir(path.join(dir, 'chapters'), { recursive: true }),
                fs.mkdir(path.join(dir, 'memory'), { recursive: true }),
                fs.mkdir(path.join(dir, 'sessions'), { recursive: true }),
            ]);
            const now = Date.now();
            const config = withVersion({
                schemaVersion: 1,
                novelId: id,
                title,
                author: '',
                genre: '',
                styleGuide: '',
                created: now,
                updated: now,
            }, 1, now);
            await writeJson(path.join(dir, 'novel.json'), config);
            const version = getVersionStamp(config);
            publishDomainChange({
                projectId: id,
                entityType: 'project',
                entityId: id,
                operation: 'created',
                beforeRevision: 0,
                revision: version.revision,
                updatedAt: version.updatedAt,
                contentHash: version.contentHash,
                changedFields: ['title'],
                actor: input?.actor || { kind: 'human', id: 'renderer' },
            });
            return { id, config };
        } catch (error) {
            if (error?.code === 'EEXIST') {
                throw new AppError('PROJECT_EXISTS', 'Project already exists', { status: 409 });
            }
            // Do not leave a half-created project that would later look valid
            // to the project picker.  Only remove a directory created by this
            // invocation; a failed collision check must never delete another
            // request's project.
            if (createdDirectory) {
                try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* best effort */ }
            }
            throw error;
        }
    });
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
    return withProjectLifecycleLock(id, async () => {
        const dir = await requireProjectDirectory(id);
        if (!options.bypassConfirmation) consumeDeleteToken(id, options.confirmationToken);

        let previousVersion = getVersionStamp({});
        try {
            previousVersion = getVersionStamp(await readJson(path.join(dir, 'novel.json'), {
                defaultValue: {},
            }));
        } catch (error) {
            // A corrupt metadata file must not make a confirmed destructive
            // operation impossible; retain the deletion event's safe fallback
            // version instead of exposing the parse error to the user.
            if (error?.code !== 'CORRUPT_JSON') throw error;
        }

        await withWriteBarrier(
            dir,
            () => fs.rm(dir, { recursive: true, force: true }),
            { keepBlocked: true },
        );
        publishDomainChange({
            projectId: id,
            entityType: 'project',
            entityId: id,
            operation: 'deleted',
            beforeRevision: previousVersion.revision,
            revision: previousVersion.revision + 1,
            updatedAt: Date.now(),
            contentHash: '',
            changedFields: [],
            actor: options.actor || { kind: 'human', id: 'renderer' },
        });
        return { success: true };
    });
}

function withProjectLifecycleLock(projectId, operation) {
    const id = String(projectId || '');
    const previous = projectLifecycleLocks.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    projectLifecycleLocks.set(id, current);
    current.finally(() => {
        if (projectLifecycleLocks.get(id) === current) projectLifecycleLocks.delete(id);
    }).catch(() => {});
    return current;
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
