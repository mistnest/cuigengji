import { ensureCharacterSummaries, ensureWorldBookSummaries } from '../../knowledge/index.js';
import {
    migrateAiConfigSecrets,
    sanitizeAiConfig,
} from '../../../foundation/configuration/index.js';
import {
    projectFile,
    readJson,
    requireObject,
    writeJson,
} from '../../../foundation/platform/index.js';

export async function loadWorkspace(projectId) {
    const filePath = projectFile(projectId, 'workspace.json');
    const workspace = await readJson(filePath, { defaultValue: {} });
    if (!workspace.aiConfig || typeof workspace.aiConfig !== 'object') return workspace;
    const aiConfig = migrateAiConfigSecrets(workspace.aiConfig, workspace.presetName);
    if (!('apiKey' in workspace.aiConfig) && !('vertexServiceAccountJson' in workspace.aiConfig)) {
        return workspace;
    }
    const sanitized = { ...workspace, aiConfig };
    await writeJson(filePath, sanitized);
    return sanitized;
}

export async function saveWorkspace(projectId, input) {
    requireObject(input, 'workspace');
    const workspace = {
        ...input,
        schemaVersion: Number(input.schemaVersion || 1),
        novelId: projectId,
        savedAt: Date.now(),
    };
    if (workspace.aiConfig && typeof workspace.aiConfig === 'object') {
        workspace.aiConfig = sanitizeAiConfig(workspace.aiConfig);
    }
    if (workspace.worldBook?.entries) {
        workspace.worldBook = ensureWorldBookSummaries(workspace.worldBook).data;
    }
    if (Array.isArray(workspace.characters)) {
        workspace.characters = ensureCharacterSummaries(workspace.characters).data;
    }
    await writeJson(projectFile(projectId, 'workspace.json'), workspace);
    return { success: true, savedAt: workspace.savedAt };
}
