import fs from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { getDataRoot } from '../runtime/runtime-config.js';
import { AppError } from '../errors/app-error.js';

export function safeSegment(value, label = 'path segment') {
    const source = String(value || '').trim();
    const safe = sanitize(source).substring(0, 100);
    if (!source || !safe || safe !== source || source === '.' || source === '..') {
        throw new AppError('INVALID_PATH', `Invalid ${label}`, { status: 400 });
    }
    return safe;
}

export function resolveInside(root, ...segments) {
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, ...segments);
    const relative = path.relative(resolvedRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new AppError('INVALID_PATH', 'Invalid path', { status: 400 });
    }
    return target;
}

export function novelsRoot() {
    return path.join(getDataRoot(), 'novels');
}

export function novelDir(novelId) {
    return resolveInside(novelsRoot(), safeSegment(novelId, 'project id'));
}

export function projectFile(novelId, ...segments) {
    const root = novelDir(novelId);
    if (!fs.existsSync(root)) {
        throw new AppError('NOT_FOUND', 'Project not found', { status: 404 });
    }
    return resolveInside(root, ...segments);
}
