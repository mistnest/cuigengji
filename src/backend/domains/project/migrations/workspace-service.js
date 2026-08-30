import { ensureCharacterSummaries, ensureWorldBookSummaries } from '../../knowledge/index.js';
import {
    migrateAiConfigSecrets,
    sanitizeAiConfig,
} from '../../../foundation/configuration/index.js';
import {
    projectFile,
    readJson,
    requireObject,
    updateVersionedJson,
    expectedRevisionFrom,
    expectedContentHashFrom,
    getVersionStamp,
    publishDomainChange,
    readRevision,
    readUpdatedAt,
    withVersion,
} from '../../../foundation/platform/index.js';

export async function loadWorkspace(projectId) {
    const filePath = projectFile(projectId, 'workspace.json');
    let workspace = await readJson(filePath, { defaultValue: {} });
    if (!workspace.aiConfig || typeof workspace.aiConfig !== 'object') {
        return withVersion(workspace, readRevision(workspace), readUpdatedAt(workspace));
    }
    if (!hasLegacyAiSecrets(workspace.aiConfig)) {
        return withVersion(workspace, readRevision(workspace), readUpdatedAt(workspace));
    }

    // Move legacy inline credentials to protected storage before removing
    // them from the workspace.  The workspace write itself is a CAS update:
    // a renderer/Agent save that wins the race must never be overwritten by
    // this migration's stale snapshot.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const expectedRevision = readRevision(workspace);
        const expectedContentHash = getVersionStamp(workspace).contentHash;
        let previous;
        try {
            const migrated = await updateVersionedJson(filePath, current => {
                previous = current;
                const currentConfig = current?.aiConfig && typeof current.aiConfig === 'object'
                    ? current.aiConfig
                    : {};
                return {
                    ...current,
                    aiConfig: migrateAiConfigSecrets(currentConfig, current.presetName),
                };
            }, {
                defaultValue: {},
                expectedRevision,
                expectedContentHash,
                resource: `workspace:${projectId}:secret-migration`,
                includeCurrent: true,
            });
            const version = getVersionStamp(migrated);
            publishDomainChange({
                projectId,
                entityType: 'workspace',
                entityId: projectId,
                operation: 'updated',
                beforeRevision: readRevision(previous),
                revision: version.revision,
                updatedAt: version.updatedAt,
                contentHash: version.contentHash,
                changedFields: changedFields(previous, migrated),
                actor: { kind: 'system', id: 'workspace-secret-migration' },
            });
            return migrated;
        } catch (error) {
            if (error?.code !== 'REVISION_CONFLICT' || attempt >= 2) throw error;
            // Re-read the winner and retry only if it still contains legacy
            // credentials.  If the concurrent save already sanitized it,
            // return that authoritative version without another write.
            workspace = await readJson(filePath, { defaultValue: {} });
            if (!workspace.aiConfig || typeof workspace.aiConfig !== 'object'
                || !hasLegacyAiSecrets(workspace.aiConfig)) {
                return withVersion(workspace, readRevision(workspace), readUpdatedAt(workspace));
            }
        }
    }
    return withVersion(workspace, readRevision(workspace), readUpdatedAt(workspace));
}

export async function saveWorkspace(projectId, input) {
    requireObject(input, 'workspace');
    const expectedRevision = expectedRevisionFrom(input);
    const actor = input.actor;
    const candidate = stripControlFields(input);
    const filePath = projectFile(projectId, 'workspace.json');
    let previous;
    const workspace = await updateVersionedJson(filePath, current => {
        previous = current;
        const next = {
            ...candidate,
            schemaVersion: Number(candidate.schemaVersion || current.schemaVersion || 1),
            novelId: projectId,
            savedAt: Date.now(),
        };
        if (next.aiConfig && typeof next.aiConfig === 'object') {
            next.aiConfig = sanitizeAiConfig(next.aiConfig);
        }
        if (next.worldBook?.entries) {
            next.worldBook = ensureWorldBookSummaries(next.worldBook).data;
        }
        if (Array.isArray(next.characters)) {
            next.characters = ensureCharacterSummaries(next.characters).data;
        }
        return next;
    }, {
        defaultValue: { schemaVersion: 1, novelId: projectId },
        expectedRevision,
        expectedContentHash: expectedContentHashFrom(input),
        resource: `workspace:${projectId}`,
        includeCurrent: true,
    });
    const version = getVersionStamp(workspace);
    publishDomainChange({
        projectId,
        entityType: 'workspace',
        entityId: projectId,
        operation: previous?.novelId ? 'updated' : 'created',
        beforeRevision: readRevision(previous),
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
        changedFields: changedFields(previous, workspace),
        actor,
    });
    return {
        success: true,
        savedAt: workspace.savedAt || version.updatedAt,
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
    };
}

function stripControlFields(value) {
    const next = { ...value };
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

function changedFields(previous, next) {
    const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
    return [...keys].filter(key => !['revision', 'updatedAt', 'savedAt', 'contentHash'].includes(key)
        && JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key]));
}

function hasLegacyAiSecrets(config) {
    return Boolean(config && typeof config === 'object'
        && (Object.prototype.hasOwnProperty.call(config, 'apiKey')
            || Object.prototype.hasOwnProperty.call(config, 'vertexServiceAccountJson')));
}
