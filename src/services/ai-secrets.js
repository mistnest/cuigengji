import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { getDataRoot } from '../config.js';

const SECRETS_FILE = 'ai-secrets.json';
const DEFAULT_PROFILE = '__default__';
export const VERTEX_SERVICE_ACCOUNT_PROVIDER = 'google-vertex-service-account';

function secretsPath() {
    return path.join(getDataRoot(), SECRETS_FILE);
}

function readStore() {
    const file = secretsPath();
    if (!fs.existsSync(file)) return { profiles: {} };
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return data && typeof data === 'object' ? { profiles: data.profiles || {} } : { profiles: {} };
    } catch {
        return { profiles: {} };
    }
}

function writeStore(store) {
    const file = secretsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomicSync(file, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeProfile(profile) {
    return String(profile || DEFAULT_PROFILE).trim() || DEFAULT_PROFILE;
}

export function saveAiSecret({ provider, apiKey, profile }) {
    if (!provider || typeof apiKey !== 'string' || !apiKey.trim()) return false;
    const store = readStore();
    const profileName = normalizeProfile(profile);
    store.profiles[profileName] = store.profiles[profileName] || {};
    store.profiles[profileName][provider] = apiKey.trim();
    writeStore(store);
    return true;
}

export function readAiSecret(provider, profile) {
    if (!provider) return '';
    const store = readStore();
    const profileName = normalizeProfile(profile);
    return store.profiles[profileName]?.[provider] || store.profiles[DEFAULT_PROFILE]?.[provider] || '';
}

export function applyAiSecret(config = {}, profile) {
    if (!config || config.provider === 'ollama') return config;
    const profileName = profile || config.presetName;
    const result = { ...config };
    if (!result.apiKey) {
        const apiKey = readAiSecret(result.provider, profileName);
        if (apiKey) result.apiKey = apiKey;
    }
    if (
        result.provider === 'google-vertex'
        && String(result.vertexAuthMode || 'express') === 'full'
        && !result.vertexServiceAccountJson
    ) {
        const serviceAccountJson = readAiSecret(VERTEX_SERVICE_ACCOUNT_PROVIDER, profileName);
        if (serviceAccountJson) result.vertexServiceAccountJson = serviceAccountJson;
    }
    return result;
}

export function hasAiSecret(provider, profile) {
    return !!readAiSecret(provider, profile);
}
