import sanitize from 'sanitize-filename';

import {
    expectedContentHashFrom,
    expectedRevisionFrom,
    getVersionStamp,
    projectFile,
    publishDomainChange,
    readJson,
    readRevision,
    readUpdatedAt,
    requireObject,
    requireString,
    updateVersionedJson,
    withVersion,
} from '../../platform/index.js';
import { sanitizePresetSecrets } from '../secret-references/ai-secret-service.js';

export async function savePreset(projectId, name, data, options = {}) {
    const id = requireString(projectId, 'projectId', { maxLength: 100 });
    requireObject(data, 'data');
    const safeName = safePresetName(name || 'preset');
    const filePath = projectFile(id, 'assets', 'presets', `${safeName}.json`);
    let previous;
    const saved = await updateVersionedJson(filePath, current => {
        previous = current;
        return {
            ...sanitizePresetSecrets(stripControlFields(data)),
            name: safeName,
            savedAt: Date.now(),
        };
    }, {
        defaultValue: { schemaVersion: 1 },
        expectedRevision: options.expectedRevision ?? expectedRevisionFrom(data),
        expectedContentHash: options.expectedContentHash ?? expectedContentHashFrom(data),
        resource: `preset:${id}/${safeName}`,
        includeCurrent: true,
    });
    const version = getVersionStamp(saved);
    publishDomainChange({
        projectId: id,
        entityType: 'preset',
        entityId: safeName,
        operation: previous && Object.keys(previous).length ? 'updated' : 'created',
        beforeRevision: readRevision(previous),
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
        changedFields: ['preset'],
        actor: options.actor || data.actor,
    });
    return {
        success: true,
        name: safeName,
        path: filePath,
        data: saved,
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
    };
}

export async function getPreset(projectId, name) {
    const id = requireString(projectId, 'projectId', { maxLength: 100 });
    const safeName = safePresetName(name || 'preset');
    const filePath = projectFile(id, 'assets', 'presets', `${safeName}.json`);
    try {
        const data = await readJson(filePath);
        return withVersion(data, readRevision(data), readUpdatedAt(data));
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

function stripControlFields(value) {
    const next = { ...(value || {}) };
    delete next.expectedRevision;
    delete next.baseRevision;
    delete next.expectedContentHash;
    delete next.baseContentHash;
    delete next.actor;
    delete next.version;
    delete next.revision;
    delete next.updatedAt;
    delete next.contentHash;
    return next;
}

function safePresetName(name) {
    const safe = sanitize(String(name || '')).substring(0, 100);
    if (!safe) throw new Error('Invalid preset name');
    return safe;
}
