import {
    app,
    BrowserWindow,
    Menu,
    dialog,
    ipcMain,
    safeStorage,
    shell,
} from 'electron';
import { spawn } from 'node:child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import { startServer } from '../src/server.js';
import { configureAiSecretProtection } from '../src/backend/foundation/configuration/index.js';
import {
    createAgentCoordinator,
} from '../src/backend/intelligence/agent/index.js';
import { getDomainEventBus } from '../src/backend/foundation/platform/index.js';
import { APP_IPC_CHANNELS, APP_MENU_COMMANDS } from '../shared/desktop-api/app/index.js';
import { createDshSupervisor } from './intelligence/agent/dsh/dsh-supervisor.js';
import { createDshGateway } from './intelligence/agent/dsh/dsh-gateway.js';
import {
    registerChapterIpcHandlers,
    registerOutlineIpcHandlers,
    registerProjectIpcHandlers,
    registerWorkspaceIpcHandlers,
} from './ipc/project/index.js';
import { registerReferenceIpcHandlers } from './ipc/knowledge/index.js';
import { registerAgentIpcHandlers, registerSessionIpcHandlers } from './ipc/agent/index.js';
import { registerAiIpcHandlers } from './ipc/models/index.js';
import { registerExportIpcHandlers, registerImportIpcHandlers } from './ipc/exchange/index.js';
import { registerPresetIpcHandlers, registerSettingsIpcHandlers } from './ipc/configuration/index.js';
import { registerAppIpcHandlers } from './ipc/app/index.js';
import { registerAutomationIpcHandlers } from './ipc/automation/index.js';
import { createSafeStorageAdapter } from './security/safe-storage-adapter.js';
import { configureWindowSecurity } from './window/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;
let embeddedServer;
let currentAppUrl = '';
let shutdownPromise = null;
let shutdownComplete = false;

const dshSupervisor = createDshSupervisor({
    electronApp: app,
    spawnProcess: spawn,
});
let dshGateway;
const agentCoordinator = createAgentCoordinator({
    eventBus: getDomainEventBus(),
    onProjectChange: event => dshGateway?.notifyProjectChange(event),
});
dshGateway = createDshGateway({
    supervisor: dshSupervisor,
    coordinator: agentCoordinator,
});

const unregisterAppIpcHandlers = registerAppIpcHandlers({
    ipcMain,
    electronApp: app,
    electronShell: shell,
    getMainWindow: () => mainWindow,
});
const unregisterProjectIpcHandlers = registerProjectIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
    eventBus: getDomainEventBus(),
});
const unregisterChapterIpcHandlers = registerChapterIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
});
const unregisterOutlineIpcHandlers = registerOutlineIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
});
const unregisterSessionIpcHandlers = registerSessionIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
});
const unregisterWorkspaceIpcHandlers = registerWorkspaceIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
});
const unregisterReferenceIpcHandlers = registerReferenceIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
});
const unregisterPresetIpcHandlers = registerPresetIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
});
const unregisterImportIpcHandlers = registerImportIpcHandlers({
    ipcMain,
    dialog,
    getMainWindow: () => mainWindow,
});
const unregisterExportIpcHandlers = registerExportIpcHandlers({
    ipcMain,
    dialog,
    getMainWindow: () => mainWindow,
});
const unregisterSettingsIpcHandlers = registerSettingsIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
    onSecretChanged: () => dshSupervisor.invalidateCredentials(),
});
const unregisterAiIpcHandlers = registerAiIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
});
const unregisterAgentIpcHandlers = registerAgentIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
    gateway: dshGateway,
});
const unregisterAutomationIpcHandlers = registerAutomationIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
});

const startupStartedAt = Date.now();

function logStartup(label) {
    console.log(`[Startup +${Date.now() - startupStartedAt}ms] ${label}`);
}

async function ensureServer() {
    logStartup('Starting embedded server');
    const dataRoot = process.env.CUIGENGJI_DATA_ROOT
        ? path.resolve(process.env.CUIGENGJI_DATA_ROOT)
        : path.join(app.getPath('userData'), app.isPackaged ? 'data' : 'development-data');
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

function startupFailurePage() {
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>催更姬启动失败</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px">
  <h1>启动失败</h1>
  <p>本地服务未能启动。请重新打开应用；如果问题持续，请查看主进程日志。</p>
</body>
</html>`);
}

function closeEmbeddedServer() {
    const server = embeddedServer;
    embeddedServer = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve();
        };
        const timeout = setTimeout(() => {
            server.closeAllConnections?.();
            finish(new Error('Embedded server shutdown timed out'));
        }, 3_000);
        timeout.unref?.();
        server.closeIdleConnections?.();
        server.close(finish);
        server.closeAllConnections?.();
    });
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
            sandbox: true,
            preload: path.join(__dirname, 'preload.cjs'),
        },
    });
    configureWindowSecurity(mainWindow, {
        getAllowedOrigin: () => {
            try {
                return currentAppUrl ? new URL(currentAppUrl).origin : '';
            } catch {
                return '';
            }
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
                    click: () => mainWindow?.webContents.send(
                        APP_IPC_CHANNELS.menuCommand,
                        APP_MENU_COMMANDS.save,
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
                        message: '催更姬 v1.0',
                        detail: 'AI 小说创作助手',
                    }),
                },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
    mainWindow.loadURL(currentAppUrl || loadingPage());
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(async () => {
    logStartup('Electron ready');
    configureAiSecretProtection(createSafeStorageAdapter(safeStorage));
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
                mainWindow.loadURL(startupFailurePage());
            }
        });
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shutdownPromise) return;
    shutdownPromise = Promise.allSettled([
        closeEmbeddedServer(),
        dshGateway.stop(),
    ]).then(results => {
        for (const result of results) {
            if (result.status === 'rejected') console.error('[Shutdown] Cleanup failed', result.reason);
        }
    }).finally(() => {
        shutdownComplete = true;
        app.quit();
    });
});

app.on('will-quit', unregisterAppIpcHandlers);
app.on('will-quit', () => agentCoordinator.dispose());
app.on('will-quit', () => dshSupervisor.projectBridge?.stop?.());
app.on('will-quit', unregisterProjectIpcHandlers);
app.on('will-quit', unregisterChapterIpcHandlers);
app.on('will-quit', unregisterOutlineIpcHandlers);
app.on('will-quit', unregisterSessionIpcHandlers);
app.on('will-quit', unregisterWorkspaceIpcHandlers);
app.on('will-quit', unregisterReferenceIpcHandlers);
app.on('will-quit', unregisterPresetIpcHandlers);
app.on('will-quit', unregisterImportIpcHandlers);
app.on('will-quit', unregisterExportIpcHandlers);
app.on('will-quit', unregisterSettingsIpcHandlers);
app.on('will-quit', unregisterAiIpcHandlers);
app.on('will-quit', unregisterAgentIpcHandlers);
app.on('will-quit', unregisterAutomationIpcHandlers);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
