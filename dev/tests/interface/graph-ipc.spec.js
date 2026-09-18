import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { registerReferenceIpcHandlers } from '../../../electron/ipc/knowledge/index.js';
import { createProject } from '../../../src/backend/domains/project/index.js';
import { REFERENCE_IPC_CHANNELS } from '../../../shared/desktop-api/knowledge/index.js';

test('@interface graph IPC migrates references and supports node/edge CAS CRUD', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigenji-graph-ipc-'));
    globalThis.DATA_ROOT = dataRoot;
    const project = await createProject({ title: '图谱契约' });
    const handlers = new Map();
    const webContents = { mainFrame: {} };
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    const dispose = registerReferenceIpcHandlers({
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) },
        getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    });
    try {
        const saved = await handlers.get(REFERENCE_IPC_CHANNELS.saveWorldBook)(event, {
            projectId: project.id, name: '都市传说', data: { entries: { 1: { comment: '雨夜', content: '雨夜会出现一盏不灭的灯。' } } }, clientId: 'test',
        });
        expect(saved.ok).toBe(true);
        const found = await handlers.get(REFERENCE_IPC_CHANNELS.searchGraphNodes)(event, {
            projectId: project.id, query: '都市传说', limit: 20,
        });
        expect(found.ok).toBe(true);
        expect(found.data.nodes).toHaveLength(1);
        const node = found.data.nodes[0];
        const detail = await handlers.get(REFERENCE_IPC_CHANNELS.getGraphNode)(event, { projectId: project.id, nodeId: node.id });
        expect(detail.data.node.body).toContain('雨夜会出现');

        const created = await handlers.get(REFERENCE_IPC_CHANNELS.commitGraph)(event, {
            projectId: project.id,
            request: { expectedGraphVersion: detail.data.graphVersion, operations: [{
                op: 'upsert_node', expectedVersion: 0,
                node: { id: 'character_test', kind: 'character_card', name: '灯下人', summary: '守灯者', body: '守灯者只在雨夜出现。', sourceRevisionId: 'manual' },
            }] },
        });
        expect(created.ok).toBe(true);
        const nextVersion = created.data.graphVersion;
        const edge = await handlers.get(REFERENCE_IPC_CHANNELS.commitGraph)(event, {
            projectId: project.id,
            request: { expectedGraphVersion: nextVersion, operations: [{
                op: 'upsert_edge', expectedVersion: 0,
                edge: { id: 'edge_test', type: 'appears_with', fromNodeId: node.id, toNodeId: 'character_test', summary: '同现', body: '雨夜与守灯者相连。', sourceRevisionId: 'manual' },
            }] },
        });
        expect(edge.ok).toBe(true);
        const listed = await handlers.get(REFERENCE_IPC_CHANNELS.listGraphEdges)(event, { projectId: project.id, nodeId: node.id });
        expect(listed.data.edges).toHaveLength(1);
    } finally {
        dispose();
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
