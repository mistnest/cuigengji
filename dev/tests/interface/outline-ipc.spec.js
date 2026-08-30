import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerOutlineIpcHandlers } from '../../../electron/ipc/project/index.js';
import {
    createOutlineNode,
    createProject,
    updateOutlineNode,
} from '../../../src/backend/domains/project/index.js';
import { projectFile, readJson } from '../../../src/backend/foundation/platform/index.js';
import { OUTLINE_IPC_CHANNELS } from '../../../shared/desktop-api/project/index.js';

test('@interface outline IPC owns nodes and guards revisions', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-outline-ipc-'));
    globalThis.DATA_ROOT = dataRoot;
    await createProject({ title: '大纲契约' });

    const handlers = new Map();
    const webContents = { mainFrame: {} };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const dispose = registerOutlineIpcHandlers({
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: channel => handlers.delete(channel),
        },
        getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    });

    try {
        const empty = await handlers.get(OUTLINE_IPC_CHANNELS.get)(event, { projectId: '大纲契约' });
        expect(empty).toMatchObject({ ok: true, data: { revision: 0, nodes: [] } });

        const created = await handlers.get(OUTLINE_IPC_CHANNELS.createNode)(event, {
            projectId: '大纲契约', node: { title: '主线' },
        });
        const nodeId = created.data.id;
        expect(created).toMatchObject({ ok: true, data: { title: '主线' } });

        const updated = await handlers.get(OUTLINE_IPC_CHANNELS.updateNode)(event, {
            projectId: '大纲契约', nodeId, patch: { completed: true, expectedRevision: 1 },
        });
        expect(updated).toMatchObject({ ok: true, data: { completed: true } });

        const conflict = await handlers.get(OUTLINE_IPC_CHANNELS.updateNode)(event, {
            projectId: '大纲契约', nodeId, patch: { title: '过期标题', expectedRevision: 1 },
        });
        expect(conflict).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });

        const deleted = await handlers.get(OUTLINE_IPC_CHANNELS.deleteNode)(event, {
            projectId: '大纲契约', nodeId, confirmed: true, expectedRevision: 2,
        });
        expect(deleted).toMatchObject({ ok: true, data: { success: true, revision: 3 } });

        const patched = await handlers.get(OUTLINE_IPC_CHANNELS.applyPatch)(event, {
            projectId: '大纲契约',
            patch: {
                expectedRevision: 3,
                confirmed: true,
                operations: [
                    {
                        kind: 'create',
                        ref: 'main_arc',
                        title: '主线重建',
                        description: '新的主线节点',
                        type: 'plot',
                    },
                    {
                        kind: 'create',
                        ref: 'first_payoff',
                        parentRef: 'main_arc',
                        title: '第一次兑现',
                        type: 'plot',
                    },
                    {
                        kind: 'update',
                        nodeRef: 'main_arc',
                        patch: { description: '修改后的主线说明' },
                    },
                    {
                        kind: 'reorder',
                        nodeRef: 'first_payoff',
                        beforeRef: 'main_arc',
                    },
                ],
            },
        });
        expect(patched).toMatchObject({
            ok: true,
            data: {
                success: true,
                revision: 4,
                operationCount: 4,
                nodes: [
                    expect.objectContaining({ title: '第一次兑现', order: 0 }),
                    expect.objectContaining({
                        title: '主线重建', description: '修改后的主线说明', order: 1,
                    }),
                ],
            },
        });
        expect(patched.data.nodes[0].parentId).toBe(patched.data.nodes[1].id);

        const stale = await handlers.get(OUTLINE_IPC_CHANNELS.applyPatch)(event, {
            projectId: '大纲契约',
            patch: {
                expectedRevision: 3,
                confirmed: true,
                operations: [{ kind: 'delete', nodeId: patched.data.nodes[1].id }],
            },
        });
        expect(stale).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });

        const invalid = await handlers.get(OUTLINE_IPC_CHANNELS.applyPatch)(event, {
            projectId: '大纲契约',
            patch: {
                expectedRevision: 4,
                operations: [{ kind: 'create', ref: 'broken' }],
            },
        });
        expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
        const unchanged = await handlers.get(OUTLINE_IPC_CHANNELS.get)(event, {
            projectId: '大纲契约',
        });
        expect(unchanged).toMatchObject({ ok: true, data: { revision: 4 } });
        expect(unchanged.data.nodes).toHaveLength(2);

        const unconfirmedDelete = await handlers.get(OUTLINE_IPC_CHANNELS.applyPatch)(event, {
            projectId: '大纲契约',
            patch: {
                expectedRevision: 4,
                confirmed: false,
                operations: [{ kind: 'delete', nodeId: patched.data.nodes[1].id }],
            },
        });
        expect(unconfirmedDelete).toMatchObject({
            ok: false, error: { code: 'CONFLICT' },
        });

        const confirmedDelete = await handlers.get(OUTLINE_IPC_CHANNELS.applyPatch)(event, {
            projectId: '大纲契约',
            patch: {
                expectedRevision: 4,
                confirmed: true,
                operations: [{ kind: 'delete', nodeId: patched.data.nodes[1].id }],
            },
        });
        expect(confirmedDelete).toMatchObject({
            ok: true,
            data: { success: true, revision: 5, nodes: [] },
        });
    } finally {
        dispose();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test('@interface outline single-node writes reject invalid parent graphs and strip CAS metadata', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-outline-graph-'));
    globalThis.DATA_ROOT = dataRoot;
    try {
        const project = await createProject({ title: '澶х翰鍥惧舰' });
        const node = await createOutlineNode(project.id, { title: '鑺傜偣' });
        await expect(updateOutlineNode(project.id, node.id, {
            parentId: node.id,
            expectedRevision: node.revision,
        })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

        const updated = await updateOutlineNode(project.id, node.id, {
            title: '鏂版爣棰?',
            expectedRevision: node.revision,
            expectedContentHash: node.contentHash,
            actor: { kind: 'human', id: 'test' },
        });
        expect(updated).toMatchObject({ revision: node.revision + 1 });
        const stored = await readJson(projectFile(project.id, 'outline.json'));
        expect(stored).not.toHaveProperty('expectedRevision');
        expect(stored).not.toHaveProperty('expectedContentHash');
        expect(stored).not.toHaveProperty('actor');
    } finally {
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
