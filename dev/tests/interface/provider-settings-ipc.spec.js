import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerSettingsIpcHandlers } from '../../../electron/ipc/configuration/index.js';
import {
    clearAiSecretProtection,
    configureAiSecretProtection,
    readAiSecret,
} from '../../../src/backend/foundation/configuration/index.js';
import { AI_PROVIDER_IPC_CHANNELS } from '../../../shared/desktop-api/models/index.js';
import { SETTINGS_IPC_CHANNELS } from '../../../shared/desktop-api/configuration/index.js';

function testProtection() {
    return {
        encrypt: value => Buffer.from(`protected:${value}`, 'utf8').toString('base64'),
        decrypt: value => {
            const decoded = Buffer.from(value, 'base64').toString('utf8');
            if (!decoded.startsWith('protected:')) throw new Error('invalid test ciphertext');
            return decoded.slice('protected:'.length);
        },
    };
}

test('@interface provider settings encrypt secrets and never expose their values over IPC', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-provider-ipc-'));
    globalThis.DATA_ROOT = dataRoot;
    configureAiSecretProtection(testProtection());

    const handlers = new Map();
    const webContents = { mainFrame: {} };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const dispose = registerSettingsIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: channel => handlers.delete(channel),
        },
        getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    });

    try {
        const saved = await handlers.get(SETTINGS_IPC_CHANNELS.saveSecret)(event, {
            provider: 'deepseek',
            profile: 'drafting',
            secret: 'sk-sensitive-value',
        });
        expect(saved).toMatchObject({ ok: true, data: { saved: true, hasKey: true } });
        expect(JSON.stringify(saved)).not.toContain('sk-sensitive-value');

        const diskValue = await fs.readFile(path.join(dataRoot, 'ai-secrets.v2.json'), 'utf8');
        expect(diskValue).not.toContain('sk-sensitive-value');
        expect(JSON.parse(diskValue)).toMatchObject({
            schemaVersion: 2,
            protection: 'electron.safeStorage',
        });

        const status = await handlers.get(SETTINGS_IPC_CHANNELS.secretStatus)(event, {
            provider: 'deepseek', profile: 'drafting',
        });
        expect(status).toEqual(expect.objectContaining({ ok: true, data: { hasKey: true } }));
        expect(status.data).not.toHaveProperty('secret');
        expect(status.data).not.toHaveProperty('apiKey');

        const rejected = await handlers.get(SETTINGS_IPC_CHANNELS.secretStatus)({
            sender: webContents,
            senderFrame: {},
        }, { provider: 'deepseek', profile: 'drafting' });
        expect(rejected).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });

        const removed = await handlers.get(SETTINGS_IPC_CHANNELS.deleteSecret)(event, {
            provider: 'deepseek', profile: 'drafting',
        });
        expect(removed).toMatchObject({ ok: true, data: { removed: true, hasKey: false } });

        const preferences = await handlers.get(SETTINGS_IPC_CHANNELS.updatePreferences)(event, {
            patch: {
                appSettings: { theme: 'dark' },
                lastSuccessfulAiConfig: { provider: 'deepseek', apiKey: 'must-not-persist' },
            },
        });
        expect(preferences).toMatchObject({
            ok: true,
            data: {
                schemaVersion: 1,
                appSettings: { theme: 'dark' },
                lastSuccessfulAiConfig: { provider: 'deepseek' },
            },
        });
        expect(JSON.stringify(preferences)).not.toContain('must-not-persist');
        const loadedPreferences = await handlers.get(SETTINGS_IPC_CHANNELS.getPreferences)(event);
        expect(loadedPreferences).toMatchObject({ ok: true, data: { appSettings: { theme: 'dark' } } });
    } finally {
        dispose();
        clearAiSecretProtection();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test('@interface provider/settings preload channels stay aligned with the shared contract', async () => {
    const preload = await fs.readFile(path.join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');
    for (const channel of Object.values(SETTINGS_IPC_CHANNELS)) expect(preload).toContain(channel);
    for (const channel of Object.values(AI_PROVIDER_IPC_CHANNELS)) expect(preload).toContain(channel);
});

test('@interface legacy plaintext AI secrets migrate once into the protected store', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-secret-migration-'));
    globalThis.DATA_ROOT = dataRoot;
    configureAiSecretProtection(testProtection());
    await fs.writeFile(path.join(dataRoot, 'ai-secrets.json'), JSON.stringify({
        profiles: { __default__: { deepseek: 'legacy-secret' } },
    }), 'utf8');

    try {
        expect(readAiSecret('deepseek')).toBe('legacy-secret');
        await expect(fs.access(path.join(dataRoot, 'ai-secrets.json'))).rejects.toThrow();
        const migrated = await fs.readFile(path.join(dataRoot, 'ai-secrets.v2.json'), 'utf8');
        expect(migrated).not.toContain('legacy-secret');
    } finally {
        clearAiSecretProtection();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
