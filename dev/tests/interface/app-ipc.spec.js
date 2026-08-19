import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { registerAppIpcHandlers } from '../../../electron/ipc/app/index.js';
import { DESKTOP_API_VERSION } from '../../../shared/desktop-api/core/version.js';
import { APP_IPC_CHANNELS } from '../../../shared/desktop-api/app/index.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function createHarness() {
    const registered = new Map();
    const removed = [];
    const openedUrls = [];
    const webContents = { mainFrame: {} };
    const mainWindow = {
        isDestroyed: () => false,
        webContents,
    };
    const dispose = registerAppIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => registered.set(channel, handler),
            removeHandler: channel => removed.push(channel),
        },
        electronApp: {
            getVersion: () => '1.0.0-test',
            isPackaged: false,
        },
        electronShell: {
            openExternal: async url => openedUrls.push(url),
        },
        getMainWindow: () => mainWindow,
    });
    return { dispose, mainWindow, openedUrls, registered, removed, webContents };
}

test('@interface app IPC returns a versioned bootstrap envelope', async () => {
    const harness = createHarness();
    const handler = harness.registered.get(APP_IPC_CHANNELS.bootstrap);
    const response = await handler({
        sender: harness.webContents,
        senderFrame: harness.webContents.mainFrame,
    });

    expect(response).toMatchObject({
        ok: true,
        data: {
            apiVersion: DESKTOP_API_VERSION,
            runtimeVersion: '1.0.0-test',
            capabilities: {
                desktopApi: true,
                legacyHttp: false,
                automation: true,
                agentRuntime: true,
                dshWorkbench: true,
            },
        },
    });
    expect(response.requestId).toMatch(/^[0-9a-f-]{36}$/);

    harness.dispose();
    expect(harness.removed.sort()).toEqual([
        APP_IPC_CHANNELS.bootstrap,
        APP_IPC_CHANNELS.getVersion,
        APP_IPC_CHANNELS.openExternal,
    ].sort());
});

test('@interface app IPC rejects calls outside the main window frame', async () => {
    const harness = createHarness();
    const handler = harness.registered.get(APP_IPC_CHANNELS.getVersion);
    const response = await handler({
        sender: harness.webContents,
        senderFrame: {},
    });

    expect(response).toMatchObject({
        ok: false,
        error: {
            code: 'PERMISSION_DENIED',
            retryable: false,
        },
    });
});

test('@interface app IPC only opens validated HTTPS URLs', async () => {
    const harness = createHarness();
    const handler = harness.registered.get(APP_IPC_CHANNELS.openExternal);
    const event = {
        sender: harness.webContents,
        senderFrame: harness.webContents.mainFrame,
    };

    const accepted = await handler(event, { url: 'https://example.com/docs?q=1' });
    expect(accepted).toMatchObject({ ok: true, data: { opened: true } });
    expect(harness.openedUrls).toEqual(['https://example.com/docs?q=1']);

    const rejected = await handler(event, { url: 'file:///C:/Windows/System32/' });
    expect(rejected).toMatchObject({
        ok: false,
        error: {
            code: 'PERMISSION_DENIED',
            retryable: false,
        },
    });
    expect(harness.openedUrls).toHaveLength(1);
});

test('@interface sandboxed preload stays aligned with the public app contract', async () => {
    const preload = await fs.readFile(path.join(PROJECT_ROOT, 'electron', 'preload.cjs'), 'utf8');
    for (const channel of Object.values(APP_IPC_CHANNELS)) expect(preload).toContain(channel);
    expect(preload).toContain(`const DESKTOP_API_VERSION = ${DESKTOP_API_VERSION};`);
});
