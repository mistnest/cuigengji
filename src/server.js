/**
 * Electron Renderer 静态资源服务。
 *
 * 业务能力只通过 preload + IPC 暴露；这里不再承载 HTTP 业务 API。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import express from 'express';

import {
    getSignatureHeaders,
    PROJECT_ROOT,
} from './backend/foundation/platform/index.js';

function defaultDataRoot() {
    if (process.env.CUIGENGJI_DATA_ROOT) return path.resolve(process.env.CUIGENGJI_DATA_ROOT);
    const packaged = PROJECT_ROOT.endsWith('.asar') || PROJECT_ROOT.includes(`${path.sep}app.asar`);
    const platformDataRoot = process.env.APPDATA
        || process.env.XDG_DATA_HOME
        || process.env.LOCALAPPDATA
        || process.env.HOME
        || process.cwd();
    return path.join(platformDataRoot, 'cuigengji', packaged ? 'data' : 'development-data');
}

// ---- Ensure Data Directories ----
function ensureDataDirs() {
    const dirs = ['worlds', 'characters', 'novels', 'presets', 'backups'];
    for (const d of dirs) {
        const p = path.join(globalThis.DATA_ROOT, d);
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }
}
// ---- Initialize Express ----
const app = express();

app.use((_req, res, next) => {
    for (const [key, value] of Object.entries(getSignatureHeaders())) {
        res.setHeader(key, value);
    }
    next();
});

// ---- Static Files ----
app.use(express.static(path.join(PROJECT_ROOT, 'public'), {
    setHeaders(res, filePath) {
        if (/\.(?:html|js|css)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-store');
        }
    },
}));

app.get('/', (_req, res) => {
    res.sendFile('index.html', { root: path.join(PROJECT_ROOT, 'public') });
});

// ---- 404 ----
app.use((_req, res) => res.sendStatus(404));

// ---- Start Server ----
async function startServer(options = {}) {
    const port = options.port ?? 0;
    const host = options.host ?? '127.0.0.1';
    globalThis.DATA_ROOT = path.resolve(options.dataRoot || defaultDataRoot());
    ensureDataDirs();
    return new Promise((resolve) => {
        const server = app.listen(port, host, () => {
            const address = server.address();
            const actualPort = typeof address === 'object' && address ? address.port : port;
            const url = `http://${host}:${actualPort}`;
            console.log(`\n  📖 催更姬 v1.0`);
            console.log(`  🚀 Server running at ${url}\n`);

            resolve({ server, url });
        });
    });
}

export { app, startServer };
export { PROJECT_ROOT } from './backend/foundation/platform/index.js';
