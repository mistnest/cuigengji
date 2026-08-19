import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('@smoke @regression Electron launches the current workspace home', async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-electron-smoke-'));
    const env = { ...process.env, CUIGENGJI_DATA_ROOT: dataRoot };
    delete env.ELECTRON_RUN_AS_NODE;

    const pageErrors = [];
    let electronApp;
    try {
        electronApp = await electron.launch({
            args: ['.'],
            cwd: PROJECT_ROOT,
            env,
        });
        const page = await electronApp.firstWindow();
        page.on('pageerror', error => pageErrors.push(error.message));

        await expect(page).toHaveTitle(/催更姬/);
        await expect(page.locator('#welcome-page')).toBeVisible();
        await expect(page.locator('#btn-welcome-create')).toBeVisible();
        await expect(page.locator('#welcome-novel-list')).not.toContainText('加载中...');
        const desktopApi = await page.evaluate(async () => ({
            exposedKeys: Object.keys(window.cuigengji || {}),
            appKeys: Object.keys(window.cuigengji?.app || {}).sort(),
            version: window.cuigengji?.version,
            bootstrap: await window.cuigengji?.app.bootstrap(),
            appVersion: await window.cuigengji?.app.getVersion(),
            automationRuntimeKind: window.AutomationRuntimePort?.kind,
            hasLegacyAgentRuntime: Boolean(window.AgentRuntimePort),
        }));
        expect(desktopApi.exposedKeys).toEqual([
            'version',
            'app',
            'project',
            'knowledge',
            'configuration',
            'models',
            'agent',
            'automation',
            'exchange',
        ]);
        expect(desktopApi.appKeys).toEqual(['bootstrap', 'getVersion', 'onMenuCommand', 'openExternal']);
        expect(desktopApi.version).toBe(1);
        expect(desktopApi.bootstrap).toMatchObject({
            apiVersion: 1,
            platform: process.platform,
            capabilities: {
                desktopApi: true,
                legacyHttp: false,
                automation: true,
                agentRuntime: true,
                dshWorkbench: true,
            },
        });
        expect(desktopApi.bootstrap.app.name).toBe('cuigengji');
        expect(desktopApi.appVersion.name).toBe('cuigengji');
        expect(desktopApi.automationRuntimeKind).toBe('electron-ipc-automation');
        expect(desktopApi.hasLegacyAgentRuntime).toBe(false);
        expect(pageErrors).toEqual([]);
    } finally {
        await electronApp?.close();
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
