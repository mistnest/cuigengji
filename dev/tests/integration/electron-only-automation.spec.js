import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { startServer } from '../../../src/server.js';

test('@regression embedded Renderer server exposes no business HTTP API', async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-electron-routes-'));
    const started = await startServer({ port: 0, dataRoot });
    try {
        for (const route of [
            '/api/ai/inspire',
            '/api/chat/write',
            '/api/debug/last-prompt',
            '/api/chapters',
            '/api/outline',
            '/api/import/worldbook',
            '/api/save/workspace/project',
            '/api/novels',
            '/api/sessions',
            '/api/update',
            '/api/version',
            '/api/ping',
        ]) {
            const response = await fetch(`${started.url}${route}`);
            expect(response.status, route).toBe(404);
        }
    } finally {
        await new Promise(resolve => started.server.close(resolve));
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
