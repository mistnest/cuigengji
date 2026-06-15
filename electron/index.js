import { app, BrowserWindow, Menu, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { startServer } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;
let embeddedServer;

async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function mergeNewerFiles(sourceRoot, targetRoot, backupRoot, relative = '') {
    const sourceDir = path.join(sourceRoot, relative);
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        const nextRelative = path.join(relative, entry.name);
        const source = path.join(sourceRoot, nextRelative);
        const target = path.join(targetRoot, nextRelative);
        if (entry.isDirectory()) {
            await fs.mkdir(target, { recursive: true });
            await mergeNewerFiles(sourceRoot, targetRoot, backupRoot, nextRelative);
            continue;
        }
        if (!entry.isFile()) continue;

        const targetExists = await pathExists(target);
        if (targetExists) {
            const [sourceStat, targetStat] = await Promise.all([fs.stat(source), fs.stat(target)]);
            if (sourceStat.mtimeMs <= targetStat.mtimeMs) continue;
            const backup = path.join(backupRoot, nextRelative);
            await fs.mkdir(path.dirname(backup), { recursive: true });
            await fs.copyFile(target, backup);
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
    }
}

async function prepareDevelopmentDataRoot() {
    const projectDataRoot = path.join(__dirname, '..', 'data');
    const electronDataRoot = path.join(app.getPath('userData'), 'data');
    const marker = path.join(projectDataRoot, '.migrations', 'electron-user-data-v1.json');
    if (await pathExists(marker) || !await pathExists(electronDataRoot)) return projectDataRoot;

    const migratedAt = Date.now();
    const backupRoot = path.join(projectDataRoot, 'backups', `electron-data-migration-${migratedAt}`);
    await fs.mkdir(projectDataRoot, { recursive: true });
    await mergeNewerFiles(electronDataRoot, projectDataRoot, backupRoot);
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, JSON.stringify({
        migratedAt,
        source: electronDataRoot,
        target: projectDataRoot,
        backup: backupRoot,
    }, null, 2), 'utf8');
    return projectDataRoot;
}

async function ensureServer() {
    const dataRoot = process.env.CUIGENGJI_DATA_ROOT
        ? path.resolve(process.env.CUIGENGJI_DATA_ROOT)
        : app.isPackaged
            ? path.join(app.getPath('userData'), 'data')
            : await prepareDevelopmentDataRoot();
    const started = await startServer({
        port: 0,
        dataRoot,
    });
    console.log(`[Data] ${dataRoot}`);
    embeddedServer = started.server;
    return started.url;
}

function createWindow(appUrl) {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: '催更姬',
        icon: path.join(__dirname, '..', 'public', 'avatar.png'),
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    mainWindow.setMenuBarVisibility(false);

    const tpl = [
        {
            label: '文件',
            submenu: [
                {
                    label: '保存',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => mainWindow.webContents.executeJavaScript(
                        "document.querySelector('#btn-save')?.click()",
                    ),
                },
                { type: 'separator' },
                { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
            ],
        },
        {
            label: '编辑',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
            ],
        },
        {
            label: '视图',
            submenu: [
                { label: '开发者工具', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
                { role: 'reload' },
            ],
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '关于',
                    click: () => dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: '关于',
                        message: '催更姬 v0.1.0',
                        detail: 'AI 小说创作助手',
                    }),
                },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
    mainWindow.loadURL(appUrl);
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
    const appUrl = await ensureServer();
    createWindow(appUrl);
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(appUrl);
    });
});

app.on('before-quit', () => {
    embeddedServer?.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
