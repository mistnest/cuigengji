import { EventEmitter } from 'node:events';

import { expect, test } from '@playwright/test';

import { configureWindowSecurity } from '../../../electron/window/security.js';

function createHarness() {
    const webContents = new EventEmitter();
    let windowOpenHandler;
    let permissionHandler;
    webContents.setWindowOpenHandler = handler => { windowOpenHandler = handler; };
    webContents.session = {
        setPermissionRequestHandler: handler => { permissionHandler = handler; },
    };
    configureWindowSecurity({ webContents }, {
        getAllowedOrigin: () => 'http://127.0.0.1:4567',
    });
    return {
        permissionHandler: () => permissionHandler,
        webContents,
        windowOpenHandler: () => windowOpenHandler,
    };
}

test('@interface browser window denies popups, webviews and permissions', () => {
    const harness = createHarness();
    expect(harness.windowOpenHandler()()).toEqual({ action: 'deny' });

    let webviewPrevented = false;
    harness.webContents.emit('will-attach-webview', {
        preventDefault: () => { webviewPrevented = true; },
    });
    expect(webviewPrevented).toBe(true);

    let permissionGranted;
    harness.permissionHandler()(harness.webContents, 'camera', value => {
        permissionGranted = value;
    });
    expect(permissionGranted).toBe(false);
});

test('@interface browser window only navigates inside the application origin', () => {
    const harness = createHarness();
    let sameOriginPrevented = false;
    harness.webContents.emit('will-navigate', {
        preventDefault: () => { sameOriginPrevented = true; },
    }, 'http://127.0.0.1:4567/editor');
    expect(sameOriginPrevented).toBe(false);

    let externalPrevented = false;
    harness.webContents.emit('will-navigate', {
        preventDefault: () => { externalPrevented = true; },
    }, 'https://example.com/');
    expect(externalPrevented).toBe(true);
});
