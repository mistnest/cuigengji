import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, _electron as electron } from 'playwright';

import { startServer } from '../src/server.js';

const root = process.cwd();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const closeServer = server => new Promise(resolve => server.close(resolve));

async function startFakeModelServer() {
    const requests = [];
    const server = http.createServer(async (req, res) => {
        if (!req.url.endsWith('/chat/completions')) {
            res.writeHead(404).end();
            return;
        }
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        await once(req, 'end');
        const body = JSON.parse(raw || '{}');
        requests.push({ stream: body.stream, model: body.model });

        if (!body.stream) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ABC' } }] }));
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        for (const part of ['A', 'B', 'C']) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
            await sleep(300);
        }
        res.write('data: [DONE]\n\n');
        res.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    return { server, requests, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function samplePage(page, fakeBase) {
    const samples = [];
    await page.locator('#btn-welcome-create').click();
    await page.locator('#welcome-modal-input').fill(`stream-diagnose-${Date.now()}`);
    await page.locator('#btn-welcome-modal-confirm').click();
    await page.waitForSelector('#app-main', { state: 'visible' });
    await page.locator('.sidebar-tab[data-panel="chat"]').click();
    await page.waitForSelector('#chat-input', { state: 'visible' });
    await page.evaluate(endpoint => {
        window.editorState.aiConfig = {
            provider: 'custom',
            endpoint,
            apiKey: 'test-key',
            model: 'fake-stream-model',
            temperature: 0.7,
            maxTokens: 128,
            stream: true,
            referenceTools: false,
            enableReferenceTools: false,
        };
        window.editorState.hasSavedApiKey = true;
        window.editorState.isConnected = true;
    }, `${fakeBase}/v1`);
    await page.locator('#btn-add-chapter').click();
    await page.fill('#chapter-editor', 'Current text.');
    await page.fill('#chat-input', 'Continue briefly.');
    await page.press('#chat-input', 'Enter');

    for (let i = 0; i < 8; i++) {
        await sleep(180);
        samples.push(await page.locator('.chat-msg-assistant .chat-msg-content').last().innerText().catch(() => ''));
    }
    return samples;
}

async function runBrowser(appUrl, fakeBase) {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
        return await samplePage(page, fakeBase);
    } finally {
        await browser.close();
    }
}

async function runElectron(fakeBase) {
    const dataRoot = path.join(root, 'test-results', 'electron-stream-diagnose');
    await fs.rm(dataRoot, { recursive: true, force: true });
    const env = { ...process.env, CUIGENGJI_DATA_ROOT: dataRoot };
    delete env.ELECTRON_RUN_AS_NODE;
    const electronApp = await electron.launch({ args: ['.'], cwd: root, env });
    try {
        const page = await electronApp.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        return await samplePage(page, fakeBase);
    } finally {
        await electronApp.close();
    }
}

const fake = await startFakeModelServer();
const appDataRoot = path.join(root, 'test-results', 'stream-diagnose-data');
await fs.rm(appDataRoot, { recursive: true, force: true });
const started = await startServer({ port: 0, dataRoot: appDataRoot });

try {
    const browser = await runBrowser(started.url, fake.baseUrl);
    const electronSamples = await runElectron(fake.baseUrl);
    console.log(JSON.stringify({
        ok: true,
        expectedProgression: ['A', 'AB', 'ABC'],
        browser,
        electron: electronSamples,
        upstreamRequests: fake.requests,
    }, null, 2));
} finally {
    await closeServer(started.server);
    await closeServer(fake.server);
}
