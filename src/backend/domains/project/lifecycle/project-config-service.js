import {
    expectedContentHashFrom,
    expectedRevisionFrom,
    getVersionStamp,
    projectFile,
    publishDomainChange,
    readRevision,
    requireObject,
    requireString,
    updateVersionedJson,
} from '../../../foundation/platform/index.js';

export async function updateProjectConfig(projectId, config = {}, options = {}) {
    const id = requireString(projectId, 'projectId', { maxLength: 100 });
    requireObject(config || {}, 'config');
    let previous;
    const candidate = stripControlFields(config);
    const merged = await updateVersionedJson(projectFile(id, 'novel.json'), existing => {
        previous = existing;
        return {
        ...existing,
        ...candidate,
        novelId: id,
        updated: Date.now(),
        };
    }, {
        defaultValue: {},
        expectedRevision: options.expectedRevision ?? expectedRevisionFrom(config),
        expectedContentHash: options.expectedContentHash ?? expectedContentHashFrom(config),
        resource: `project:${id}`,
        includeCurrent: true,
    });
    const version = getVersionStamp(merged);
    publishDomainChange({
        projectId: id,
        entityType: 'project',
        entityId: id,
        operation: previous && Object.keys(previous).length ? 'updated' : 'created',
        beforeRevision: readRevision(previous),
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
        changedFields: Object.keys(candidate),
        actor: options.actor || config.actor,
    });
    return {
        success: true,
        config: merged,
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
    };
}

function stripControlFields(value) {
    const next = { ...(value || {}) };
    for (const key of [
        'expectedRevision', 'baseRevision', 'expectedContentHash', 'baseContentHash',
        'actor', 'version', 'revision', 'updatedAt', 'contentHash',
    ]) delete next[key];
    return next;
}
