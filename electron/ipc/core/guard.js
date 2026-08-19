import { desktopFailure, desktopSuccess, permissionDenied } from './result.js';
import { parseDesktopInput } from '../../../shared/desktop-api/core/schema.js';

export function isTrustedMainFrame(event, getMainWindow) {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return false;
    return event.sender === window.webContents
        && event.senderFrame === event.sender.mainFrame;
}

export function createGuardedHandler(getMainWindow, handler, label = 'IPC handler', inputSchema) {
    return async (event, payload) => {
        if (!isTrustedMainFrame(event, getMainWindow)) return permissionDenied();
        try {
            return desktopSuccess(await handler(parseDesktopInput(inputSchema, payload)));
        } catch (error) {
            if (!error?.code) console.error(`[IPC] ${label} failed`, error);
            return desktopFailure(error || {});
        }
    };
}

export function registerHandlers(ipcMain, handlers) {
    for (const [channel, handler] of handlers) ipcMain.handle(channel, handler);
    return () => {
        for (const channel of handlers.keys()) ipcMain.removeHandler(channel);
    };
}
