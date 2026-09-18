import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { commitChapterMemory } from '../memory-commit.js';
import { GraphStore } from '../store.js';
const node = { id: 'a', kind: 'character_card', name: '林晚', summary: '出发', body: '保管信件', sourceRevisionId: 'r0' };
const edge = { id: 'zz-target', type: 'knows', fromNodeId: 'a', toNodeId: 'b', summary: '相识', body: '旧的关系事实', sourceRevisionId: 'r0' };
const initial = { novelId: 'novel', requestId: 'initial', expectedGraphVersion: 0, operations: [
        { op: 'upsert_node', expectedVersion: 0, node },
        { op: 'upsert_node', expectedVersion: 0, node: { ...node, id: 'b' } },
        { op: 'upsert_edge', expectedVersion: 0, edge },
    ] };
for (const snapshotInterval of [1, 100])
    test(`request replay survives ${snapshotInterval === 1 ? 'snapshot' : 'journal'} reload and rejects changed payload`, async (t) => {
        const root = await mkdtemp(join(tmpdir(), 'graph-replay-'));
        t.after(() => rm(root, { recursive: true, force: true }));
        const first = await new GraphStore(root, { snapshotInterval }).commit(initial);
        const reopened = new GraphStore(root);
        assert.deepEqual(await reopened.commit(initial), first);
        await assert.rejects(reopened.commit({ ...initial, operations: [{ op: 'upsert_node', expectedVersion: 0, node: { ...node, body: 'changed' } }] }), /requestId was reused/);
        await assert.rejects(reopened.commit({ ...initial, expectedGraphVersion: 1 }), /requestId was reused/);
        assert.equal((await reopened.getEdge('novel', edge.id)).edge.version, 1);
        assert.equal((await reopened.getNode('novel', 'a')).graphVersion, 1);
    });
test('chapter merges nodes and edges beyond listing limit, restores lost receipt across MCP processes and snapshot', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chapter-replay-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const graphRoot = join(root, 'graphs');
    const store = new GraphStore(graphRoot, { snapshotInterval: 1 });
    await store.commit(initial);
    for (let batch = 0; batch < 3; batch++) {
        await store.commit({ novelId: 'novel', expectedGraphVersion: batch + 1, operations: Array.from({ length: 70 }, (_, i) => ({
                op: 'upsert_edge', expectedVersion: 0, edge: { ...edge, id: `edge-${batch}-${i.toString().padStart(2, '0')}` },
            })) });
    }
    assert.equal((await store.listEdges('novel', 'a', 'both', [], 200)).edges.some(x => x.id === edge.id), false);
    const paths = [];
    for (let i = 1; i <= 2; i++) {
        const path = join(root, `handoff-${i}.json`);
        paths.push(path);
        await writeFile(path, JSON.stringify({ revision_sha256: `r${i}`, memory_delta: {
                upsert_nodes: [{ id: `n${i}`, node_id: 'a', kind: node.kind, name: node.name, summary: `状态${i}`, body_append: `新事实${i}`, source_revision_id: `r${i}` }],
                upsert_edges: [{ id: `e${i}`, edge_id: edge.id, from_node_id: 'a', to_node_id: 'b', relation: i === 1 ? 'knows' : 'trusts', summary: `关系${i}`, body_append: `关系进展${i}`, source_revision_id: `r${i}` }],
            } }));
    }
    const options = { handoffPaths: paths, receiptPath: join(root, 'receipt.json'), graphRoot, novelId: 'novel', serverPath: fileURLToPath(new URL('../bin.js', import.meta.url)) };
    const first = await commitChapterMemory(options);
    assert.equal(first.graph_version, 5);
    assert.equal(first.applied.length, 2);
    const updated = (await store.getEdge('novel', edge.id)).edge;
    assert.equal(updated.version, 2);
    assert.equal(updated.type, 'trusts');
    assert.equal(updated.body, '旧的关系事实\n\n关系进展1\n\n关系进展2');
    assert.equal((await store.getNode('novel', 'a')).node.version, 2);
    // Compact to a newer snapshot through another store, then restore receipt via a fresh stdio child.
    await store.commit({ novelId: 'novel', expectedGraphVersion: 5, operations: [{ op: 'upsert_node', expectedVersion: 1, node: { ...node, id: 'b', summary: 'later change' } }] });
    await rm(options.receiptPath);
    const recovered = await commitChapterMemory(options);
    assert.equal(recovered.graph_version, first.graph_version);
    assert.equal(recovered.transaction_id, first.transaction_id);
    assert.equal(recovered.recovered_existing_commit, true);
    assert.deepEqual(recovered.applied, first.applied);
    assert.equal((await store.getEdge('novel', edge.id)).edge.version, 2);
    assert.equal((await store.getNode('novel', 'a')).graphVersion, 6);
    const pending = JSON.parse(await readFile(options.receiptPath + '.request.json', 'utf8'));
    pending.operations[0].node.body = 'tampered';
    await writeFile(options.receiptPath + '.request.json', JSON.stringify(pending));
    await rm(options.receiptPath);
    await assert.rejects(commitChapterMemory(options), /requestId was reused/);
});
test('concurrent store instances replay the same request without applying twice', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'graph-concurrent-replay-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const results = await Promise.all([new GraphStore(root).commit(initial), new GraphStore(root).commit(initial)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await new GraphStore(root).getEdge('novel', edge.id)).edge.version, 1);
});
test('replays journal commit after a crash before manifest publication', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'graph-pre-manifest-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await new GraphStore(root).commit(initial);
    // Model journal-fsynced / manifest-not-yet-written crash boundary.
    await rm(join(root, 'novel', 'manifest.json'));
    assert.deepEqual(await new GraphStore(root).commit(initial), first);
    assert.equal((await new GraphStore(root).getEdge('novel', edge.id)).edge.version, 1);
});
test('a failed chapter transaction leaves neither partial nodes nor a successful request record', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'graph-failed-batch-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const invalid = { ...initial, operations: [initial.operations[0], initial.operations[2]] };
    await assert.rejects(new GraphStore(root).commit(invalid), /references a missing node/);
    assert.equal((await new GraphStore(root).searchNodes('novel', '')).graphVersion, 0);
    assert.equal((await new GraphStore(root).commit(initial)).graphVersion, 1);
});
//# sourceMappingURL=chapter-recovery.test.js.map