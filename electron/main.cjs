/**
 * 催更姬 — Electron Main Process
 * Legacy CommonJS entry. Server must be started separately: node src/server.js
 */
const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');

let mainWindow;
const APP_URL = 'http://127.0.0.1:8765';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400, height: 900, minWidth: 900, minHeight: 600,
        title: '催更姬',
        icon: path.join(__dirname, '..', 'public', 'avatar.png'),
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    mainWindow.setMenuBarVisibility(false);

    const tpl = [
        { label: '文件', submenu: [
            {
                label: '保存',
                accelerator: 'CmdOrCtrl+S',
                click: () => mainWindow.webContents.executeJavaScript(
                    "document.querySelector('#btn-save')?.click()",
                ),
            },
            { type: 'separator' },
            { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
        ]},
        { label: '编辑', submenu: [
            { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
            { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        ]},
        { label: '视图', submenu: [
            { label: '开发者工具', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
            { role: 'reload' },
        ]},
        { label: '帮助', submenu: [
            { label: '关于', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: '关于', message: '催更姬 v0.1.0', detail: 'AI 小说创作助手' }) },
        ]},
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
    mainWindow.loadURL(APP_URL);
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
