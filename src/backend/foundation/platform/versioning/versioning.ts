import { createHash } from 'node:crypto';

import { AppError } from '../errors/app-error.js';
import type { ConflictDetails, VersionStamp } from '../../../../../shared/contracts/collaboration.js';

export const VERSION_SCHEMA_VERSION = 1 as const;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type VersionedRecord = Record<string, any>;

const ROOT_VERSION_FIELDS = new Set([
    'revision', 'updatedAt', 'updated', 'savedAt', 'contentHash', 'version',
]);

export function normalizeRevision(value: unknown, fallback = 0): number {
    const revision = Number(value);
    return Number.isInteger(revision) && revision >= 0 ? revision : fallback;
}

export function readRevision(value: unknown, fallback = 0): number {
    if (!isRecord(value)) return fallback;
    const nested = isRecord(value.version) ? value.version.revision : undefined;
    return normalizeRevision(value.revision ?? nested, fallback);
}

export function readUpdatedAt(value: unknown, fallback = 0): number {
    if (!isRecord(value)) return fallback;
    const candidate = value.updatedAt ?? value.updated ?? value.savedAt;
    const timestamp = Number(candidate);
    if (Number.isFinite(timestamp) && timestamp >= 0) return timestamp;
    if (typeof candidate === 'string') {
        const parsed = Date.parse(candidate);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

/** Return a stable JSON-compatible value whose object keys are sorted. */
export function canonicalize(value: unknown): any {
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
        if (typeof value === 'bigint') return `${value}n`;
        return value;
    }
    if (Array.isArray(value)) return value.map(item => canonicalize(item));
    const result: Record<string, any> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
}

export function versionPayload(value: unknown): unknown {
    if (!isRecord(value) || Array.isArray(value)) return value;
    const payload: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!ROOT_VERSION_FIELDS.has(key)) payload[key] = item;
    }
    return payload;
}

export function contentHash(value: unknown): string {
    return createHash('sha256')
        .update(JSON.stringify(canonicalize(versionPayload(value))))
        .digest('hex');
}

export function getVersionStamp(value: unknown): VersionStamp {
    const record = isRecord(value) ? value : {};
    return Object.freeze({
        schemaVersion: VERSION_SCHEMA_VERSION,
        revision: readRevision(record),
        updatedAt: readUpdatedAt(record),
        // Never trust a persisted hash blindly.  Recomputing it makes the
        // stamp useful for detecting hand-edited/corrupt files as well as for
        // comparing two otherwise equivalent snapshots.
        contentHash: contentHash(record),
    });
}

/** Add compatibility fields used by existing project JSON records. */
export function withVersion<T extends VersionedRecord>(
    value: T | null | undefined,
    revision: unknown,
    updatedAt = Date.now(),
): T & VersionStamp {
    const next: VersionedRecord = isRecord(value) ? { ...value } : {};
    const normalizedRevision = normalizeRevision(revision);
    next.revision = normalizedRevision;
    next.updatedAt = updatedAt;
    if (Object.prototype.hasOwnProperty.call(next, 'updated')) next.updated = updatedAt;
    if (Object.prototype.hasOwnProperty.call(next, 'savedAt')) next.savedAt = updatedAt;
    next.contentHash = contentHash(next);
    return next as T & VersionStamp;
}

export function expectedRevisionFrom(value: unknown): unknown {
    if (!isRecord(value)) return undefined;
    if (value.expectedRevision !== undefined) return value.expectedRevision;
    if (value.baseRevision !== undefined) return value.baseRevision;
    if (isRecord(value.version) && value.version.revision !== undefined) {
        return value.version.revision;
    }
    return undefined;
}

export function expectedContentHashFrom(value: unknown): unknown {
    if (!isRecord(value)) return undefined;
    if (value.expectedContentHash !== undefined) return value.expectedContentHash;
    if (value.baseContentHash !== undefined) return value.baseContentHash;
    return undefined;
}

export function assertExpectedRevision(
    current: unknown,
    expected: unknown,
    resource = 'resource',
    options: { includeCurrent?: boolean; expectedContentHash?: unknown } = {},
): number {
    return assertExpectedVersion(
        current,
        expected,
        options.expectedContentHash,
        resource,
        options,
    );
}

/**
 * Compare both the monotonic revision and (when supplied) the content hash.
 * Revision is the normal fast path; the hash catches edits made by an
 * external process that preserved or omitted the legacy revision field.
 */
export function assertExpectedVersion(
    current: unknown,
    expectedRevision: unknown,
    expectedHash: unknown,
    resource = 'resource',
    _options: { includeCurrent?: boolean } = {},
): number {
    if (expectedRevision === undefined && expectedHash === undefined) return readRevision(current);
    let normalizedExpected: number | undefined;
    if (expectedRevision !== undefined) {
        normalizedExpected = Number(expectedRevision);
        if (!Number.isInteger(normalizedExpected) || normalizedExpected < 0) {
            throw new AppError('VALIDATION_ERROR', 'expectedRevision must be a non-negative integer', {
                status: 400,
                publicMessage: '版本号格式无效。',
            });
        }
    }
    const normalizedHash = normalizeContentHash(expectedHash);
    const currentRevision = readRevision(current);
    const currentHash = getVersionStamp(current).contentHash;
    const revisionMatches = normalizedExpected === undefined || normalizedExpected === currentRevision;
    const hashMatches = normalizedHash === undefined || normalizedHash === currentHash;
    if (revisionMatches && hashMatches) return currentRevision;
    const details: ConflictDetails = {
        resource,
        expectedRevision: normalizedExpected ?? currentRevision,
        currentRevision,
        currentVersion: getVersionStamp(current),
        ...(normalizedHash ? { expectedContentHash: normalizedHash } : {}),
        currentContentHash: currentHash,
        conflictOn: !revisionMatches ? 'revision' : 'contentHash',
    };
    throw new AppError('REVISION_CONFLICT', `${resource} was changed by another operation`, {
        status: 409,
        publicMessage: '内容已被其他操作修改，请刷新后重试。',
        details,
    });
}

function normalizeContentHash(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/iu.test(value)) {
        throw new AppError('VALIDATION_ERROR', 'expectedContentHash must be a SHA-256 hash', {
            status: 400,
            publicMessage: '内容校验值格式无效。',
        });
    }
    return value.toLowerCase();
}

export function nextVersion<T extends VersionedRecord>(
    current: unknown,
    value: T,
    updatedAt = Date.now(),
): T & VersionStamp {
    return withVersion(value, readRevision(current) + 1, updatedAt);
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
