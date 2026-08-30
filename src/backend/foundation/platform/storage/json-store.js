import fs from 'node:fs/promises';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { AppError } from '../errors/app-error.js';
import {
    assertExpectedRevision,
    expectedContentHashFrom,
    nextVersion,
} from '../versioning/versioning.js';

const writeQueues = new Map();
const blockedRoots = new Set();

export async function readJson(filePath, options = {}) {
    const { defaultValue, allowMissing = defaultValue !== undefined } = options;
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch (err) {
        if (err.code === 'ENOENT' && allowMissing) return cloneDefault(defaultValue);
        if (err instanceof SyntaxError) {
            throw new AppError('CORRUPT_JSON', `Corrupt JSON file: ${path.basename(filePath)}`, {
                status: 500,
                publicMessage: '项目数据文件损坏，已停止读取。',
            });
        }
        throw err;
    }
}

export async function writeJson(filePath, value) {
    return enqueueFileWrite(filePath, async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await writeFileAtomic(filePath, JSON.stringify(value, null, 2), { encoding: 'utf8' });
        return value;
    });
}

export async function updateJson(filePath, updater, options = {}) {
    return enqueueFileWrite(filePath, async () => {
        const current = await readJson(filePath, options);
        const next = await updater(current);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await writeFileAtomic(filePath, JSON.stringify(next, null, 2), { encoding: 'utf8' });
        return next;
    });
}

/**
 * Compare-and-swap update for a versioned JSON aggregate.  The file queue
 * provides serialization; the revision check provides correctness when a
 * renderer and an Agent both hold an older snapshot.
 */
export async function updateVersionedJson(filePath, updater, options = {}) {
    return enqueueFileWrite(filePath, async () => {
        const current = await readJson(filePath, options);
        assertExpectedRevision(
            current,
            options.expectedRevision,
            options.resource || filePath,
            {
                includeCurrent: options.includeCurrent === true,
                expectedContentHash: options.expectedContentHash
                    ?? expectedContentHashFrom(options),
            },
        );
        const candidate = await updater(current);
        const next = nextVersion(current, candidate, options.updatedAt || Date.now());
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await writeFileAtomic(filePath, JSON.stringify(next, null, 2), { encoding: 'utf8' });
        return next;
    });
}

export async function removeFile(filePath) {
    return enqueueFileWrite(filePath, async () => {
        await fs.rm(filePath, { force: true });
    });
}

export function enqueueFileWrite(filePath, operation) {
    const key = path.resolve(filePath);
    if ([...blockedRoots].some(root => isInside(root, key))) {
        throw new AppError('PROJECT_DELETING', 'Project is being deleted', { status: 409 });
    }
    const previous = writeQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    writeQueues.set(key, current);
    current.finally(() => {
        if (writeQueues.get(key) === current) writeQueues.delete(key);
    }).catch(() => {});
    return current;
}

export async function withWriteBarrier(rootPath, operation, options = {}) {
    const root = path.resolve(rootPath);
    blockedRoots.add(root);
    let completed = false;
    try {
        const pending = [...writeQueues.entries()]
            .filter(([filePath]) => isInside(root, filePath))
            .map(([, promise]) => promise.catch(() => {}));
        await Promise.all(pending);
        const result = await operation();
        completed = true;
        return result;
    } finally {
        if (!options.keepBlocked || !completed) blockedRoots.delete(root);
    }
}

export function allowWritesInside(rootPath) {
    blockedRoots.delete(path.resolve(rootPath));
}

function cloneDefault(value) {
    if (value === undefined || value === null) return value;
    return structuredClone(value);
}

function isInside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
