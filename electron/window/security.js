function allowedNavigation(url, getAllowedOrigin) {
    try {
        const allowedOrigin = getAllowedOrigin();
        return Boolean(allowedOrigin) && new URL(url).origin === allowedOrigin;
    } catch {
        return false;
    }
}

export function configureWindowSecurity(browserWindow, { getAllowedOrigin }) {
    const { webContents } = browserWindow;

    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    webContents.on('will-attach-webview', event => event.preventDefault());
    webContents.on('will-navigate', (event, url) => {
        if (!allowedNavigation(url, getAllowedOrigin)) event.preventDefault();
    });
    webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
    });
}
