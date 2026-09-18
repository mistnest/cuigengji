/** Conservative provenance replay: never infer how to undo a manual edit. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GraphStore, GraphStoreError } from './store.js';
import { physicalNovelId } from './graph-routing.js';
async function atomic(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
    await rename(tmp, path);
}
const append = (old, addition) => old === undefined ? addition : old.includes(addition) ? old : `${old.trimEnd()}\n\n${addition}`;
function replay(handoffs) {
    const nodes = new Map();
    const edges = new Map();
    const now = new Date().toISOString();
    for (const handoff of handoffs) {
        for (const d of handoff.memory_delta.upsert_nodes) {
            const old = nodes.get(d.node_id);
            if (old?.sourceRevisionId === d.source_revision_id)
                continue;
            nodes.set(d.node_id, { id: d.node_id, kind: d.kind, name: d.name, summary: d.summary,
                body: append(old?.body, d.body_append), sourceRevisionId: d.source_revision_id,
                version: 1, createdAt: now, updatedAt: now, deleted: false });
        }
        for (const d of handoff.memory_delta.upsert_edges) {
            const old = edges.get(d.edge_id);
            if (old?.sourceRevisionId === d.source_revision_id)
                continue;
            edges.set(d.edge_id, { id: d.edge_id, type: d.relation, fromNodeId: d.from_node_id,
                toNodeId: d.to_node_id, summary: d.summary, body: append(old?.body, d.body_append),
                sourceRevisionId: d.source_revision_id, version: 1, createdAt: now, updatedAt: now, deleted: false });
        }
    }
    return { nodes, edges };
}
function content(record) {
    const { version, createdAt, updatedAt, deletedAt, ...value } = record;
    return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}
export async function prepareHistoryGraph(options) {
    const manifestText = await readFile(options.manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    if (!Array.isArray(manifest.handoffs) || manifest.handoffs.some(x => typeof x.path !== 'string' || typeof x.retire !== 'boolean'))
        throw new Error('invalid original handoffs manifest');
    const texts = await Promise.all(manifest.handoffs.map(x => readFile(x.path, 'utf8')));
    const handoffs = texts.map(x => JSON.parse(x));
    const sourceId = await physicalNovelId(options.sourceNovelId, options.resultsRoot);
    if (sourceId === options.branchNovelId || options.sourceNovelId === options.branchNovelId)
        throw new Error('branch must differ from source');
    const store = new GraphStore(options.graphRoot);
    const manifestSha = createHash('sha256').update(manifestText).update(JSON.stringify(texts)).digest('hex');
    const fencePath = join(store.root, sourceId, 'history-fence.json');
    return store.revisionLock(sourceId, async () => {
        const snapshot = await store.exportSnapshot(sourceId);
        const receipt = { schema_version: 1, status: 'ready', source_novel_id: options.sourceNovelId,
            source_graph_novel_id: sourceId, source_graph_version: snapshot.graphVersion,
            branch_novel_id: options.branchNovelId, branch_initial_graph_version: 0,
            run_id: options.runId, manifest_sha256: manifestSha, graph_root: store.root };
        try {
            const existing = JSON.parse(await readFile(fencePath, 'utf8'));
            if (JSON.stringify(existing) !== JSON.stringify(receipt))
                throw new Error('source graph reserved by another historical revision');
            const prior = JSON.parse(await readFile(join(store.root, options.branchNovelId, 'history-prepare.json'), 'utf8'));
            if (JSON.stringify(prior) !== JSON.stringify(receipt))
                throw new Error('branch preparation identity mismatch');
            await atomic(options.receiptPath, receipt);
            return receipt;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        const all = replay(handoffs);
        const retained = replay(handoffs.filter((_, i) => !manifest.handoffs[i].retire));
        for (const [kind, actual, expected] of [['node', snapshot.nodes, all.nodes], ['edge', snapshot.edges, all.edges]]) {
            const byId = new Map(actual.map(x => [x.id, x]));
            for (const [id, value] of expected) {
                const current = byId.get(id);
                if (!current || content(current) !== content(value))
                    throw new GraphStoreError('unsafe_history_retraction', `cannot safely retract ${kind} ${id}: manual or untracked changes overlap pipeline memory`);
            }
        }
        const branch = { schemaVersion: 1, novelId: options.branchNovelId, graphVersion: 0,
            nodes: [...snapshot.nodes.filter(x => !all.nodes.has(x.id)), ...retained.nodes.values()],
            edges: [...snapshot.edges.filter(x => !all.edges.has(x.id)), ...retained.edges.values()] };
        const live = new Set(branch.nodes.filter(x => !x.deleted).map(x => x.id));
        if (branch.edges.some(x => !x.deleted && (!live.has(x.fromNodeId) || !live.has(x.toNodeId))))
            throw new GraphStoreError('unsafe_history_retraction', 'retirement would orphan a retained relationship');
        await store.revisionLock(options.branchNovelId, async () => {
            // Snapshot precedes fence: an interrupted unpublished branch is harmless.
            const preparePath = join(store.root, options.branchNovelId, 'history-prepare.json');
            let recovering = false;
            try {
                const prior = JSON.parse(await readFile(preparePath, 'utf8'));
                if (JSON.stringify(prior) !== JSON.stringify(receipt))
                    throw new Error('branch preparation identity mismatch');
                recovering = true;
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            await atomic(preparePath, receipt);
            try {
                await store.installRevisionSnapshot(branch);
            }
            catch (error) {
                if (!recovering || !(error instanceof GraphStoreError) || error.code !== 'revision_conflict')
                    throw error;
                const existing = await store.exportSnapshot(options.branchNovelId);
                const fingerprint = (value) => JSON.stringify([value.graphVersion, value.nodes.map(content).sort(), value.edges.map(content).sort()]);
                if (fingerprint(existing) !== fingerprint(branch))
                    throw new Error('interrupted branch was modified; refusing recovery');
            }
            await atomic(join(store.root, options.branchNovelId, 'history-source-snapshot.json'), snapshot);
            await atomic(fencePath, receipt);
            await atomic(options.receiptPath, receipt);
        });
        return receipt;
    });
}
/** Freeze the completed branch until the catalog atomically adopts it. */
export async function sealHistoryGraph(receiptPath) {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const store = new GraphStore(receipt.graph_root);
    return store.revisionLock(receipt.branch_novel_id, async () => {
        const sourceFence = JSON.parse(await readFile(join(store.root, receipt.source_graph_novel_id, 'history-fence.json'), 'utf8'));
        if (sourceFence.run_id !== receipt.run_id || sourceFence.branch_novel_id !== receipt.branch_novel_id || sourceFence.source_graph_version !== receipt.source_graph_version)
            throw new Error('source fence mismatch');
        const branch = await store.exportSnapshot(receipt.branch_novel_id);
        const sealed = { ...receipt, branch_sealed: true, branch_graph_version: branch.graphVersion };
        const path = join(store.root, receipt.branch_novel_id, 'history-fence.json');
        try {
            const prior = JSON.parse(await readFile(path, 'utf8'));
            if (JSON.stringify(prior) !== JSON.stringify(sealed))
                throw new Error('branch already fenced for another revision');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        await atomic(path, sealed);
        await atomic(receiptPath, sealed);
        return sealed;
    });
}
export async function unsealPublishedHistoryGraph(receiptPath, resultsRoot) {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (!receipt.branch_sealed)
        throw new Error('branch not sealed');
    const store = new GraphStore(receipt.graph_root);
    return store.revisionLock(receipt.branch_novel_id, async () => {
        if (await physicalNovelId(receipt.source_novel_id, resultsRoot) !== receipt.branch_novel_id)
            throw new Error('catalog has not adopted this branch');
        const path = join(store.root, receipt.branch_novel_id, 'history-fence.json');
        try {
            const fence = JSON.parse(await readFile(path, 'utf8'));
            if (JSON.stringify(fence) !== JSON.stringify(receipt))
                throw new Error('branch fence identity mismatch');
            await rm(path);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        return receipt;
    });
}
export async function sealHistoryRollback(receiptPath) {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (!receipt.branch_sealed)
        throw new Error('missing publication seal');
    const store = new GraphStore(receipt.graph_root);
    return store.revisionLock(receipt.branch_novel_id, async () => {
        const graph = await store.exportSnapshot(receipt.branch_novel_id);
        if (graph.graphVersion !== receipt.branch_graph_version)
            throw new Error('rollback refused: branch graph changed after publication');
        const fencePath = join(store.root, receipt.branch_novel_id, 'history-fence.json');
        try {
            const fence = JSON.parse(await readFile(fencePath, 'utf8'));
            if (JSON.stringify(fence) !== JSON.stringify(receipt))
                throw new Error('another revision owns the branch fence');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        await atomic(fencePath, receipt);
        return receipt;
    });
}
export async function unsealHistoryRollback(receiptPath, resultsRoot) {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const store = new GraphStore(receipt.graph_root);
    return store.revisionLock(receipt.source_graph_novel_id, async () => {
        if (await physicalNovelId(receipt.source_novel_id, resultsRoot) !== receipt.source_graph_novel_id)
            throw new Error('catalog has not restored the original graph');
        const catalog = JSON.parse(await readFile(join(resultsRoot, '.novels', receipt.source_novel_id, 'catalog.json'), 'utf8'));
        if (catalog.last_history_rollback?.run_id !== receipt.run_id)
            throw new Error('catalog has no matching rollback decision');
        const branchFence = JSON.parse(await readFile(join(store.root, receipt.branch_novel_id, 'history-fence.json'), 'utf8'));
        if (JSON.stringify(branchFence) !== JSON.stringify(receipt))
            throw new Error('rollback branch fence mismatch');
        const path = join(store.root, receipt.source_graph_novel_id, 'history-fence.json');
        try {
            const fence = JSON.parse(await readFile(path, 'utf8'));
            if (fence.run_id !== receipt.run_id || fence.branch_novel_id !== receipt.branch_novel_id || fence.source_graph_version !== receipt.source_graph_version)
                throw new Error('source fence identity mismatch');
            await rm(path);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        return receipt;
    });
}
//# sourceMappingURL=history-branch.js.map