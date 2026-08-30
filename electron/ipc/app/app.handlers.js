import { getPublicAppSignature } from '../../../src/backend/foundation/platform/index.js';
import {
    APP_IPC_CHANNELS,
    APP_INPUT_SCHEMAS,
} from '../../../shared/desktop-api/app/index.js';
import { DESKTOP_API_VERSION } from '../../../shared/desktop-api/core/version.js';
import { DESKTOP_ERROR_CODES } from '../../../shared/desktop-api/core/errors.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

function requireHttpsUrl(input) {
    if (!input || typeof input.url !== 'string') {
        const error = new Error('A URL is required.');
        error.code = DESKTOP_ERROR_CODES.validation;
        error.publicMessage = '外部链接格式无效。';
        throw error;
    }

    let url;
    try {
        url = new URL(input.url);
    } catch {
        const error = new Error('The URL cannot be parsed.');
        error.code = DESKTOP_ERROR_CODES.validation;
        error.publicMessage = '外部链接格式无效。';
        throw error;
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
        const error = new Error(`External protocol is not allowed: ${url.protocol}`);
        error.code = DESKTOP_ERROR_CODES.permissionDenied;
        error.publicMessage = '仅允许打开 HTTPS 外部链接。';
        throw error;
    }
    return url.href;
}

export function registerAppIpcHandlers({ ipcMain, electronApp, electronShell, getMainWindow }) {
    const handlers = new Map([
        [APP_IPC_CHANNELS.bootstrap, createGuardedHandler(getMainWindow, async () => ({
            apiVersion: DESKTOP_API_VERSION,
            app: getPublicAppSignature(),
            runtimeVersion: electronApp.getVersion(),
            platform: process.platform,
            architecture: process.arch,
            packaged: electronApp.isPackaged,
            dataSchemaVersion: 1,
            capabilities: {
                desktopApi: true,
                legacyHttp: false,
                automation: true,
                agentRuntime: true,
                dshWorkbench: true,
            },
        }), 'app.bootstrap', APP_INPUT_SCHEMAS.bootstrap)],
        [APP_IPC_CHANNELS.getVersion, createGuardedHandler(getMainWindow, async () => ({
            ...getPublicAppSignature(),
            runtimeVersion: electronApp.getVersion(),
        }), 'app.getVersion', APP_INPUT_SCHEMAS.getVersion)],
        [APP_IPC_CHANNELS.openExternal, createGuardedHandler(getMainWindow, async input => {
            const url = requireHttpsUrl(input);
            await electronShell.openExternal(url);
            return { opened: true };
        }, 'app.openExternal', APP_INPUT_SCHEMAS.openExternal)],
    ]);
    return registerHandlers(ipcMain, handlers);
}
