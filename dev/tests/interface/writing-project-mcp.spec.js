import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { createWritingProjectBridge } from '../../../electron/intelligence/agent/dsh/writing-project-bridge.js';
import { createProject } from '../../../src/backend/domains/project/index.js';

test('@interface writing project bridge exposes bounded manuscript CRUD with CAS', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigenji-writing-project-bridge-'));
    globalThis.DATA_ROOT = dataRoot;
    const project = await createProject({ title: 'Agent正文工具' });
    const bridge = createWritingProjectBridge();
    const capability = await bridge.issueCapability({ projectId: project.id, sessionId: 'test-session' });
    const request = (tool, argumentsValue = {}) => fetch(`${capability.url}/v1/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${capability.token}` },
        body: JSON.stringify({ tool, arguments: argumentsValue }),
    }).then(response => response.json());
    try {
        const created = await request('manuscript_create', { title: '第一章', content: '甲乙丙丁戊己' });
        expect(created.ok).toBe(true);
        const chapter = created.result;
        const bounded = await request('manuscript_get', {
            chapterId: chapter.id, start: 1, maxChars: 2,
        });
        expect(bounded.result.chapter.content).toBe('乙丙');
        expect(bounded.result.chapter.contentWindow).toMatchObject({ start: 1, maxChars: 2, truncated: true });

        const updated = await request('manuscript_update', {
            chapterId: chapter.id, expectedRevision: chapter.revision,
            expectedContentHash: chapter.contentHash, patch: { content: '新正文' },
        });
        expect(updated.ok).toBe(true);
        const conflict = await request('manuscript_update', {
            chapterId: chapter.id, expectedRevision: chapter.revision, patch: { content: '过期' },
        });
        expect(conflict.ok).toBe(false);
        expect(conflict.error.code).toBe('REVISION_CONFLICT');
        const unauthorized = await fetch(`${capability.url}/v1/execute`, { method: 'POST' }).then(response => response.json());
        expect(unauthorized.ok).toBe(false);
    } finally {
        await bridge.stop();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
