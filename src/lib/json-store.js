import fs from 'node:fs/promises';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { ApiError } from './http.js';

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
            throw new ApiError(500, `Corrupt JSON file: ${path.basename(filePath)}`, 'CORRUPT_JSON');
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

export async function removeFile(filePath) {
    return enqueueFileWrite(filePath, async () => {
        await fs.rm(filePath, { force: true });
    });
}

export function enqueueFileWrite(filePath, operation) {
    const key = path.resolve(filePath);
    if ([...blockedRoots].some(root => isInside(root, key))) {
        throw new ApiError(409, 'Project is being deleted', 'PROJECT_DELETING');
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
    try {
        const pending = [...writeQueues.entries()]
            .filter(([filePath]) => isInside(root, filePath))
            .map(([, promise]) => promise.catch(() => {}));
        await Promise.all(pending);
        return await operation();
    } finally {
        if (!options.keepBlocked) blockedRoots.delete(root);
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
