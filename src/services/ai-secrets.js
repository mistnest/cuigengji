import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { getDataRoot } from '../config.js';

const SECRETS_FILE = 'ai-secrets.json';
const DEFAULT_PROFILE = '__default__';

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
    if (!config || config.apiKey || config.provider === 'ollama') return config;
    const apiKey = readAiSecret(config.provider, profile || config.presetName);
    return apiKey ? { ...config, apiKey } : config;
}

export function hasAiSecret(provider, profile) {
    return !!readAiSecret(provider, profile);
}
