import { app, BrowserWindow, Menu, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { startServer } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;
let embeddedServer;
let currentAppUrl = '';

const startupStartedAt = Date.now();

function logStartup(label) {
    console.log(`[Startup +${Date.now() - startupStartedAt}ms] ${label}`);
}

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

    logStartup('Migrating Electron user data into project data root');
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
    logStartup('Starting embedded server');
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
    logStartup(`Embedded server ready at ${started.url}`);
    return started.url;
}

function loadingPage() {
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Cuigengji</title>
  <style>
    body {
      margin: 0;
      height: 100vh;
      display: grid;
      place-items: center;
      background: #111827;
      color: #f9fafb;
      font-family: "Microsoft YaHei", system-ui, sans-serif;
    }
    .card {
      width: min(420px, calc(100vw - 48px));
      padding: 32px;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 18px;
      background: rgba(255,255,255,.06);
      box-shadow: 0 20px 80px rgba(0,0,0,.35);
      text-align: center;
    }
    .title { font-size: 26px; font-weight: 700; margin-bottom: 12px; }
    .hint { color: #cbd5e1; line-height: 1.7; }
    .bar {
      height: 4px;
      margin-top: 24px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(255,255,255,.12);
    }
    .bar::before {
      content: "";
      display: block;
      width: 40%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #93c5fd, #c4b5fd);
      animation: move 1.2s ease-in-out infinite;
    }
    @keyframes move {
      0% { transform: translateX(-110%); }
      100% { transform: translateX(260%); }
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="title">催更姬正在启动</div>
    <div class="hint">第一次开机启动可能需要预热本地服务，请稍等片刻。</div>
    <div class="bar"></div>
  </main>
</body>
</html>`);
}

function createWindow() {
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
    mainWindow.loadURL(currentAppUrl || loadingPage());
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
    logStartup('Electron ready');
    createWindow();
    ensureServer()
        .then(appUrl => {
            currentAppUrl = appUrl;
            if (!mainWindow) return;
            mainWindow.loadURL(appUrl);
            logStartup('Main window loaded app URL');
        })
        .catch(error => {
            console.error('[Startup] Failed to start embedded server', error);
            if (mainWindow) {
                mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<h1>启动失败</h1><pre>${String(error?.stack || error)}</pre>`));
            }
        });
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('before-quit', () => {
    embeddedServer?.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
