import { projectFile, requireObject, requireString, updateJson } from '../../../foundation/platform/index.js';

export async function updateProjectConfig(projectId, config) {
    const id = requireString(projectId, 'projectId', { maxLength: 100 });
    requireObject(config || {}, 'config');
    const merged = await updateJson(projectFile(id, 'novel.json'), existing => ({
        ...existing,
        ...config,
        novelId: id,
        updated: Date.now(),
    }), { defaultValue: {} });
    return { success: true, config: merged };
}
