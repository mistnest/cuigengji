import { createHash } from 'node:crypto';
import path from 'node:path';

import { GraphStore, GraphStoreError } from '../../../../plugins/novel-graph-mcp/lib/store.js';
import { getDataRoot, publishDomainChange } from '../../foundation/platform/index.js';
import { getWorldBook, listCharacters, listWorldBooks } from './references/reference-service.js';

const VALID_KINDS = new Set(['world_book', 'world_entry', 'character_card']);
const stores = new Map();

export function graphRoot() {
    return path.resolve(process.env.CUIGENGJI_NOVEL_GRAPH_DB || path.join(getDataRoot(), 'novel-graphs'));
}

export function graphNovelId(projectId) {
    const value = String(projectId || '').trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value)) return value;
    return `project-${createHash('sha256').update(value).digest('hex').slice(0, 56)}`;
}

function store() {
    const root = graphRoot();
    if (!stores.has(root)) stores.set(root, new GraphStore(root));
    return stores.get(root);
}

export async function searchGraphNodes(projectId, query = '', kinds = [], limit = 100) {
    await syncLegacyReferences(projectId);
    return store().searchNodes(graphNovelId(projectId), query, normalizeKinds(kinds), limit);
}

export async function getGraphNode(projectId, nodeId, includeBody = true) {
    await syncLegacyReferences(projectId);
    return store().getNode(graphNovelId(projectId), nodeId, includeBody);
}

export async function getGraphEdge(projectId, edgeId) {
    return store().getEdge(graphNovelId(projectId), edgeId);
}

export async function listGraphEdges(projectId, nodeId, direction = 'both', types = [], limit = 200) {
    return store().listEdges(graphNovelId(projectId), nodeId, direction, types, limit);
}

export async function commitGraph(projectId, request, actor = { kind: 'human', id: 'renderer' }) {
    const result = await store().commit({ ...request, novelId: graphNovelId(projectId) });
    publishDomainChange({
        projectId,
        entityType: 'graph',
        entityId: result.transactionId,
        operation: 'updated',
        revision: result.graphVersion,
        beforeRevision: Math.max(0, result.graphVersion - 1),
        changedFields: request.operations.map(operation => operation.op),
        actor,
    });
    return { ...result, projectId };
}

/** Import legacy JSON references exactly once per missing node. */
export async function syncLegacyReferences(projectId) {
    const graphId = graphNovelId(projectId);
    const graph = await store().exportSnapshot(graphId);
    const known = new Map(graph.nodes.map(node => [node.id, node]));
    const operations = [];
    for (const entry of await listWorldBooks(projectId)) {
        const nodeId = graphNodeId('worldbook', entry.name);
        if (known.has(nodeId)) continue;
        const data = await getWorldBook(projectId, entry.name);
        operations.push({
            op: 'upsert_node', expectedVersion: 0,
            node: referenceNode(nodeId, 'world_book', entry.name, data, entry.contentHash || `legacy-${entry.name}`),
        });
    }
    for (const entry of await listCharacters(projectId)) {
        const nodeId = graphNodeId('character', entry.name);
        if (known.has(nodeId)) continue;
        operations.push({
            op: 'upsert_node', expectedVersion: 0,
            node: referenceNode(nodeId, 'character_card', entry.name, entry.data || {}, entry.data?.contentHash || `legacy-${entry.name}`),
        });
    }
    if (!operations.length) return graph;
    try {
        return await store().commit({ novelId: graphId, expectedGraphVersion: graph.graphVersion, operations });
    } catch (error) {
        if (error instanceof GraphStoreError && error.code === 'version_conflict') return store().exportSnapshot(graphId);
        throw error;
    }
}

export async function syncWorldBookNode(projectId, name, data, version = 0) {
    return syncReferenceNode(projectId, graphNodeId('worldbook', name), 'world_book', name, data, version);
}

export async function syncCharacterNode(projectId, name, data, version = 0) {
    return syncReferenceNode(projectId, graphNodeId('character', name), 'character_card', name, data, version);
}

async function syncReferenceNode(projectId, nodeId, kind, name, data, sourceRevisionId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const graph = await store().exportSnapshot(graphNovelId(projectId));
        const existing = graph.nodes.find(node => node.id === nodeId);
        try {
            return await commitGraph(projectId, {
                expectedGraphVersion: graph.graphVersion,
                operations: [{
                    op: 'upsert_node', expectedVersion: existing?.version || 0,
                    node: referenceNode(nodeId, kind, name, data, String(sourceRevisionId || '0')),
                }],
            }, { kind: 'system', id: 'legacy-reference-sync' });
        } catch (error) {
            if (error instanceof GraphStoreError && error.code === 'version_conflict') continue;
            throw error;
        }
    }
    throw new GraphStoreError('version_conflict', 'reference graph changed while synchronizing');
}

function referenceNode(id, kind, name, data, sourceRevisionId) {
    const body = JSON.stringify(data || {}, null, 2);
    const summary = kind === 'world_book'
        ? `世界书，包含 ${Object.keys(data?.entries || {}).length} 个条目`
        : String(data?.data?.description || data?.description || data?.summary || '').slice(0, 500) || '角色卡';
    return { id, kind, name: String(name).slice(0, 160), summary, body, sourceRevisionId: String(sourceRevisionId || '0') };
}

function graphNodeId(kind, name) {
    return `${kind}_${createHash('sha256').update(String(name || '')).digest('hex').slice(0, 24)}`;
}

function normalizeKinds(kinds) {
    if (!Array.isArray(kinds)) return [];
    return kinds.filter(kind => VALID_KINDS.has(kind));
}
