import path from 'node:path';

import { AppError, getDataRoot, readJson, requireObject, writeJson } from '../../platform/index.js';
import { sanitizePresetSecrets } from '../secret-references/ai-secret-service.js';

const PREFERENCES_FILE = 'preferences.json';
const MAX_PREFERENCES_BYTES = 1024 * 1024;
const ALLOWED_KEYS = new Set([
    'appSettings',
    'lastSuccessfulAiConfig',
    'selectedProvider',
    'connectedProvider',
    'recentProjectAccess',
    'lastWorkspace',
    'summaryHeight',
    'rightSidebarTab',
    'aiOnboardingComplete',
    'provenance',
]);

export async function getPreferences() {
    const stored = await readJson(preferencesPath(), { defaultValue: defaultPreferences() });
    return normalizePreferences(stored);
}

export async function updatePreferences(patch) {
    requireObject(patch, 'patch');
    const unknown = Object.keys(patch).filter(key => !ALLOWED_KEYS.has(key));
    if (unknown.length) {
        throw new AppError('VALIDATION_ERROR', 'Unknown preference key', {
            status: 400,
            details: { keys: unknown },
        });
    }
    const current = await getPreferences();
    const next = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) delete next[key];
        else next[key] = sanitizePresetSecrets(value);
    }
    next.schemaVersion = 1;
    next.updatedAt = Date.now();
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_PREFERENCES_BYTES) {
        throw new AppError('VALIDATION_ERROR', 'Preferences are too large', {
            status: 400,
            details: { maxBytes: MAX_PREFERENCES_BYTES },
        });
    }
    await writeJson(preferencesPath(), next);
    return next;
}

function normalizePreferences(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultPreferences();
    return {
        ...Object.fromEntries(Object.entries(value).filter(([key]) => ALLOWED_KEYS.has(key))),
        schemaVersion: 1,
        updatedAt: Number(value.updatedAt || 0),
    };
}

function defaultPreferences() {
    return { schemaVersion: 1, updatedAt: 0 };
}

function preferencesPath() {
    return path.join(getDataRoot(), PREFERENCES_FILE);
}
