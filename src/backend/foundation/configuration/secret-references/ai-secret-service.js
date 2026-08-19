import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { AppError, getDataRoot, requireString } from '../../platform/index.js';

const LEGACY_SECRETS_FILE = 'ai-secrets.json';
const PROTECTED_SECRETS_FILE = 'ai-secrets.v2.json';
const DEFAULT_PROFILE = '__default__';
const MAX_SECRET_LENGTH = 1024 * 1024;

export const VERTEX_SERVICE_ACCOUNT_PROVIDER = 'google-vertex-service-account';

let protectionAdapter = null;

export function configureAiSecretProtection(adapter) {
    if (!adapter || typeof adapter.encrypt !== 'function' || typeof adapter.decrypt !== 'function') {
        throw new TypeError('AI secret protection adapter must provide encrypt and decrypt');
    }
    protectionAdapter = adapter;
}

export function clearAiSecretProtection() {
    protectionAdapter = null;
}

export function saveAiSecret({ provider, apiKey, profile }) {
    const providerName = normalizeProvider(provider);
    const secret = requireString(apiKey, 'apiKey', { maxLength: MAX_SECRET_LENGTH }).trim();
    const store = readProtectedStore();
    const profileName = normalizeProfile(profile);
    store.profiles[profileName] = store.profiles[profileName] || {};
    store.profiles[profileName][providerName] = protect(secret);
    writeProtectedStore(store);
    removeMigratedLegacyStore();
    return true;
}

export function readAiSecret(provider, profile) {
    const providerName = normalizeProvider(provider);
    const profileName = normalizeProfile(profile);
    const store = readProtectedStore({ migrateLegacy: true });
    const protectedValue = store.profiles[profileName]?.[providerName]
        || store.profiles[DEFAULT_PROFILE]?.[providerName]
        || '';
    return protectedValue ? unprotect(protectedValue) : '';
}

export function hasAiSecret(provider, profile) {
    return Boolean(readAiSecret(provider, profile));
}

export function deleteAiSecret(provider, profile) {
    const providerName = normalizeProvider(provider);
    const profileName = normalizeProfile(profile);
    const store = readProtectedStore({ migrateLegacy: true });
    if (!store.profiles[profileName]?.[providerName]) return { removed: false, hasKey: false };
    delete store.profiles[profileName][providerName];
    if (!Object.keys(store.profiles[profileName]).length) delete store.profiles[profileName];
    writeProtectedStore(store);
    return { removed: true, hasKey: false };
}

export function applyAiSecret(config = {}, profile) {
    if (!config || config.provider === 'ollama') return config;
    const profileName = profile || config.presetName;
    const result = sanitizeAiConfig(config);
    result.apiKey = readAiSecret(result.provider, profileName);
    if (
        result.provider === 'google-vertex'
        && String(result.vertexAuthMode || 'express') === 'full'
    ) {
        result.vertexServiceAccountJson = readAiSecret(
            VERTEX_SERVICE_ACCOUNT_PROVIDER,
            profileName,
        );
    }
    return result;
}

export function sanitizeAiConfig(config = {}) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
    const safe = { ...config };
    delete safe.apiKey;
    delete safe.vertexServiceAccountJson;
    return safe;
}

export function migrateAiConfigSecrets(config = {}, profile) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
    if (typeof config.apiKey === 'string' && config.apiKey.trim() && config.provider) {
        saveAiSecret({ provider: config.provider, apiKey: config.apiKey, profile });
    }
    if (typeof config.vertexServiceAccountJson === 'string' && config.vertexServiceAccountJson.trim()) {
        saveAiSecret({
            provider: VERTEX_SERVICE_ACCOUNT_PROVIDER,
            apiKey: config.vertexServiceAccountJson,
            profile,
        });
    }
    return sanitizeAiConfig(config);
}

export function sanitizePresetSecrets(value) {
    if (Array.isArray(value)) return value.map(sanitizePresetSecrets);
    if (!value || typeof value !== 'object') return value;
    const secretKeys = new Set([
        'apikey',
        'api_key',
        'vertexserviceaccountjson',
        'service_account_json',
        'accesstoken',
        'access_token',
    ]);
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !secretKeys.has(String(key).toLowerCase()))
        .map(([key, child]) => [key, sanitizePresetSecrets(child)]));
}

function readProtectedStore(options = {}) {
    ensureProtectionAvailable();
    const protectedFile = protectedSecretsPath();
    if (fs.existsSync(protectedFile)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(protectedFile, 'utf8'));
            if (parsed?.schemaVersion !== 2 || !parsed.profiles || typeof parsed.profiles !== 'object') {
                throw new Error('Unsupported protected secret store schema');
            }
            return parsed;
        } catch (error) {
            throw new AppError('SECRET_STORE_CORRUPT', 'Protected secret store is invalid', {
                status: 500,
                publicMessage: '本机密钥存储已损坏，请删除旧密钥后重新配置。',
                details: { cause: error.message },
            });
        }
    }
    if (options.migrateLegacy !== false) return migrateLegacyStore();
    return emptyStore();
}

function migrateLegacyStore() {
    const legacyFile = legacySecretsPath();
    if (!fs.existsSync(legacyFile)) return emptyStore();
    let legacy;
    try {
        legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    } catch (error) {
        throw new AppError('SECRET_STORE_CORRUPT', 'Legacy secret store is invalid', {
            status: 500,
            publicMessage: '旧版密钥存储已损坏，请重新配置密钥。',
            details: { cause: error.message },
        });
    }
    const store = emptyStore();
    for (const [profile, providers] of Object.entries(legacy?.profiles || {})) {
        if (!providers || typeof providers !== 'object') continue;
        const protectedProviders = {};
        for (const [provider, secret] of Object.entries(providers)) {
            if (typeof secret === 'string' && secret.trim()) protectedProviders[provider] = protect(secret.trim());
        }
        if (Object.keys(protectedProviders).length) store.profiles[profile] = protectedProviders;
    }
    writeProtectedStore(store);
    removeMigratedLegacyStore();
    return store;
}

function emptyStore() {
    return {
        schemaVersion: 2,
        protection: 'electron.safeStorage',
        profiles: {},
    };
}

function writeProtectedStore(store) {
    const file = protectedSecretsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomicSync(file, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function removeMigratedLegacyStore() {
    const legacyFile = legacySecretsPath();
    if (fs.existsSync(legacyFile)) fs.rmSync(legacyFile, { force: true });
}

function protect(secret) {
    ensureProtectionAvailable();
    try {
        return protectionAdapter.encrypt(secret);
    } catch (error) {
        throw new AppError('SECURE_STORAGE_ERROR', 'Failed to protect AI secret', {
            status: 500,
            publicMessage: '无法安全保存密钥，请检查系统密钥服务。',
            details: { cause: error.message },
        });
    }
}

function unprotect(value) {
    ensureProtectionAvailable();
    try {
        return protectionAdapter.decrypt(value);
    } catch (error) {
        throw new AppError('SECURE_STORAGE_ERROR', 'Failed to decrypt AI secret', {
            status: 500,
            publicMessage: '无法读取本机密钥，请重新配置。',
            details: { cause: error.message },
        });
    }
}

function ensureProtectionAvailable() {
    if (protectionAdapter) return;
    throw new AppError('SECURE_STORAGE_UNAVAILABLE', 'Electron safeStorage is unavailable', {
        status: 503,
        retryable: false,
        publicMessage: '系统安全存储当前不可用，无法读写 AI 密钥。',
    });
}

function protectedSecretsPath() {
    return path.join(getDataRoot(), PROTECTED_SECRETS_FILE);
}

function legacySecretsPath() {
    return path.join(getDataRoot(), LEGACY_SECRETS_FILE);
}

function normalizeProvider(provider) {
    return requireString(provider, 'provider', { maxLength: 100 }).trim();
}

function normalizeProfile(profile) {
    return String(profile || DEFAULT_PROFILE).trim().slice(0, 200) || DEFAULT_PROFILE;
}
