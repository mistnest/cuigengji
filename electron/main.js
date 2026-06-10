/**
 * Novel AI Editor - Electron Main Process
 * 桌面应用入口
 */
import { app, BrowserWindow, Menu, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { serverEvents, EVENT_NAMES } from '../src/server-events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const cliArgs = yargs(hideBin(process.argv))
    .option('width', { type: 'number', default: 1400, describe: 'Window width' })
    .option('height', { type: 'number', default: 900, describe: 'Window height' })
    .option('dev', { type: 'boolean', default: false, describe: 'Dev mode (open DevTools)' })
    .parseSync();

/** @type {string} */
let appUrl;

/** @type {BrowserWindow} */
let mainWindow;

function createWindow() {
    if (!appUrl) {
        console.error('Server not started yet.');
        return;
    }

    mainWindow = new BrowserWindow({
        width: cliArgs.width,
        height: cliArgs.height,
        minWidth: 900,
        minHeight: 600,
        title: 'Novel AI Editor',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        icon: path.join(PROJECT_ROOT, 'public', 'favicon.ico'),
    });

    // Application menu
    const menuTemplate = [
        {
            label: 'File',
            submenu: [
                { label: 'New Novel', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu:new-novel') },
                { label: 'Open Novel...', accelerator: 'CmdOrCtrl+O', click: () => mainWindow.webContents.send('menu:open-novel') },
                { type: 'separator' },
                { label: 'Import', submenu: [
                    { label: 'Import World Book (.json)...', click: () => mainWindow.webContents.send('menu:import-worldbook') },
                    { label: 'Import Character Card (.png)...', click: () => mainWindow.webContents.send('menu:import-character') },
                    { label: 'Import Preset (.json)...', click: () => mainWindow.webContents.send('menu:import-preset') },
                ]},
                { type: 'separator' },
                { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => mainWindow.webContents.send('menu:settings') },
                { type: 'separator' },
                { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
                { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
                { type: 'separator' },
                { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
                { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
                { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { label: 'Toggle DevTools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
                { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
            ],
        },
        {
            label: 'Help',
            submenu: [
                { label: 'About', click: () => {
                    dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: 'About Novel AI Editor',
                        message: 'Novel AI Editor v0.1.0',
                        detail: '专为网文作者打造的 AI 灵感引导写作工具\n\n基于 SillyTavern 开源项目 (AGPL-3.0) 改造',
                    });
                }},
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    mainWindow.loadURL(appUrl);

    if (cliArgs.dev) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startServer() {
    return new Promise((_resolve) => {
        serverEvents.addListener(EVENT_NAMES.SERVER_STARTED, ({ url }) => {
            appUrl = url.toString();
            createWindow();
        });

        // Change to project root and import the server
        process.chdir(PROJECT_ROOT);
        import('../src/server.js');
    });
}

app.whenReady().then(() => {
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    startServer();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
