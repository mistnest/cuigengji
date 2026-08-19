import sanitize from 'sanitize-filename';

import { projectFile, requireObject, requireString, writeJson } from '../../platform/index.js';
import { sanitizePresetSecrets } from '../secret-references/ai-secret-service.js';

export async function savePreset(projectId, name, data) {
    const id = requireString(projectId, 'projectId', { maxLength: 100 });
    requireObject(data, 'data');
    const safeName = safePresetName(name || 'preset');
    const filePath = projectFile(id, 'assets', 'presets', `${safeName}.json`);
    await writeJson(filePath, sanitizePresetSecrets(data));
    return { success: true, name: safeName, path: filePath };
}

function safePresetName(name) {
    const safe = sanitize(String(name || '')).substring(0, 100);
    if (!safe) throw new Error('Invalid preset name');
    return safe;
}
