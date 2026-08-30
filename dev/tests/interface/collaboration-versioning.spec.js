import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { createProject } from '../../../src/backend/domains/project/index.js';
import {
    getWorldBook,
    saveWorldBook,
} from '../../../src/backend/domains/knowledge/index.js';
import {
    createDomainEventBus,
    getVersionStamp,
    projectFile,
    readJson,
    writeJson,
} from '../../../src/backend/foundation/platform/index.js';
import { loadWorkspace, saveWorkspace } from '../../../src/backend/domains/project/index.js';

test('@interface collaboration guards external edits with revision and content hash', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-versioning-'));
    globalThis.DATA_ROOT = dataRoot;
    try {
        await createProject({ title: '版本校验' });

        const first = await saveWorkspace('版本校验', {
            title: '版本校验',
            worldBook: { entries: {} },
            characters: [],
        });
        const loaded = await loadWorkspace('版本校验');
        expect(loaded).toMatchObject({ revision: first.revision, contentHash: first.contentHash });

        // Simulate an editor outside the app changing content while retaining
        // the legacy revision field.  Hash-aware clients must not overwrite it.
        const workspacePath = projectFile('版本校验', 'workspace.json');
        const external = await readJson(workspacePath);
        await writeJson(workspacePath, {
            ...external,
            title: '外部编辑',
            contentHash: '0'.repeat(64),
        });
        const conflict = await saveWorkspace('版本校验', {
            title: '旧客户端写入',
            worldBook: { entries: {} },
            characters: [],
            expectedRevision: loaded.revision,
            expectedContentHash: loaded.contentHash,
        }).catch(error => error);
        expect(conflict).toMatchObject({
            code: 'REVISION_CONFLICT',
            details: {
                conflictOn: 'contentHash',
                expectedContentHash: loaded.contentHash,
                currentRevision: loaded.revision,
            },
        });
        expect(conflict.details).not.toHaveProperty('current');
        expect((await loadWorkspace('版本校验')).title).toBe('外部编辑');

        const book = await saveWorldBook('版本校验', '设定', {
            entries: { one: { key: ['城'], content: '旧设定' } },
        });
        const bookData = await getWorldBook('版本校验', '设定');
        expect(bookData).toMatchObject({ revision: book.revision, contentHash: book.contentHash });

        const writes = await Promise.allSettled([
            saveWorldBook('版本校验', '设定', {
                entries: { one: { key: ['城'], content: '并发 A' } },
                expectedRevision: bookData.revision,
                expectedContentHash: bookData.contentHash,
            }),
            saveWorldBook('版本校验', '设定', {
                entries: { one: { key: ['城'], content: '并发 B' } },
                expectedRevision: bookData.revision,
                expectedContentHash: bookData.contentHash,
            }),
        ]);
        expect(writes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
        expect(writes.filter(item => item.status === 'rejected')[0].reason)
            .toMatchObject({ code: 'REVISION_CONFLICT' });

        const stamp = getVersionStamp({ revision: 7, contentHash: 'f'.repeat(64), value: '真实内容' });
        expect(stamp.contentHash).not.toBe('f'.repeat(64));
    } finally {
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test('@interface collaboration replay asks for a snapshot after bounded history expires', () => {
    const bus = createDomainEventBus({ historyLimit: 2, streamId: 'bounded-stream' });
    bus.publishChange({ projectId: 'p', entityType: 'chapter', entityId: 'a', revision: 1 });
    bus.publishChange({ projectId: 'p', entityType: 'chapter', entityId: 'a', revision: 2 });
    bus.publishChange({ projectId: 'p', entityType: 'chapter', entityId: 'a', revision: 3 });
    expect(bus.getSince('p', 0, 'bounded-stream')).toMatchObject({
        resetRequired: true,
        lastSeq: 3,
        oldestSeq: 2,
        events: [],
    });
    expect(bus.getSince('p', 1, 'bounded-stream')).toMatchObject({
        resetRequired: false,
        events: [expect.objectContaining({ seq: 2 }), expect.objectContaining({ seq: 3 })],
    });
});
