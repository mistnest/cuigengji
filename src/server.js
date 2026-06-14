#!/usr/bin/env node
/**
 * Novel AI Editor - Server Entry Point
 * 精简版 Express 服务器，专为小说创作优化
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'url';

import cors from 'cors';
import express from 'express';
import bodyParser from 'body-parser';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { PROJECT_ROOT } from './config.js';
import { serverEvents, EVENT_NAMES } from './server-events.js';
import { errorHandler, notFoundHandler } from './lib/http.js';

// ---- CLI Arguments ----
const cliArgs = yargs(hideBin(process.argv))
    .option('port', {
        type: 'number',
        default: 8765,
        describe: 'Server port',
    })
    .option('host', {
        type: 'string',
        default: '127.0.0.1',
        describe: 'Server host',
    })
    .option('dataRoot', {
        type: 'string',
        default: path.join(PROJECT_ROOT, 'data'),
        describe: 'Data storage directory',
    })
    .parseSync();

globalThis.DATA_ROOT = cliArgs.dataRoot;

// ---- Ensure Data Directories ----
function ensureDataDirs() {
    const dirs = ['worlds', 'characters', 'novels', 'presets', 'backups'];
    for (const d of dirs) {
        const p = path.join(globalThis.DATA_ROOT, d);
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }
}
ensureDataDirs();

// ---- Initialize Express ----
const app = express();

// app.use(compression()); // Disabled: causes ERR_INVALID_CHUNKED_ENCODING on some browsers
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));

// ---- Static Files ----
app.use(express.static(path.join(PROJECT_ROOT, 'public')));

app.get('/', (_req, res) => {
    res.sendFile('index.html', { root: path.join(PROJECT_ROOT, 'public') });
});

// ---- Health Check ----
app.get('/api/ping', (_req, res) => res.sendStatus(204));
app.get('/api/version', (_req, res) => res.json({
    name: 'novel-ai-editor',
    version: '0.1.0',
}));

// ---- Mount API Endpoints ----
import { router as chaptersRouter } from './endpoints/chapters.js';
import { router as outlineRouter } from './endpoints/outline.js';
import { router as aiRouter } from './endpoints/ai.js';
import { router as importRouter } from './endpoints/import.js';
import { router as chatRouter } from './endpoints/chat.js';
import { router as persistenceRouter } from './endpoints/persistence.js';
import { router as novelsRouter } from './endpoints/novels.js';
import { router as sessionsRouter } from './endpoints/sessions.js';
import { router as debugRouter } from './endpoints/debug.js';
import { router as aiSecretsRouter } from './endpoints/ai-secrets.js';

app.use('/api/chapters', chaptersRouter);
app.use('/api/outline', outlineRouter);
app.use('/api/ai', aiRouter);
app.use('/api/import', importRouter);
app.use('/api/chat', chatRouter);
app.use('/api/save', persistenceRouter);
app.use('/api/novels', novelsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/debug', debugRouter);
app.use('/api/ai-secrets', aiSecretsRouter);

// ---- 404 ----
app.use(notFoundHandler);
app.use(errorHandler);

// ---- Start Server ----
async function startServer(options = {}) {
    const port = options.port ?? cliArgs.port;
    const host = options.host ?? cliArgs.host;
    if (options.dataRoot) {
        globalThis.DATA_ROOT = options.dataRoot;
        ensureDataDirs();
    }
    return new Promise((resolve) => {
        const server = app.listen(port, host, () => {
            const url = `http://${host}:${port}`;
            console.log(`\n  📖 Novel AI Editor v0.1.0`);
            console.log(`  🚀 Server running at ${url}\n`);

            serverEvents.emit(EVENT_NAMES.SERVER_STARTED, {
                url: new URL(url),
                port,
                host,
            });

            resolve({ server, url });
        });
    });
}

// If run directly (not imported by Electron)
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMainModule) {
    startServer();
}

export { app, startServer, cliArgs };
export { PROJECT_ROOT } from './config.js';
