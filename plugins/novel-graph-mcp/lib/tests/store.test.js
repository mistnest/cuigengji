import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GraphStore, GraphStoreError } from '../store.js';
const linWan = {
    id: 'character:lin-wan',
    kind: 'character_card',
    name: '林晚',
    summary: '准备向哥哥说明家中变化。',
    body: '林晚住在山村，当前持有一封未寄出的信。',
    sourceRevisionId: 'revision-001',
};
const brother = {
    id: 'character:brother',
    kind: 'character_card',
    name: '哥哥',
    summary: '离家者，离家原因尚未揭示。',
    body: '不得推断其离家原因。',
    sourceRevisionId: 'revision-001',
};
const relationship = {
    id: 'relation:lin-wan-brother',
    type: 'sibling_of',
    fromNodeId: linWan.id,
    toNodeId: brother.id,
    summary: '林晚与哥哥是兄妹。',
    body: '关系存在；当前沟通尚未完成。',
    sourceRevisionId: 'revision-001',
};
async function temporaryStore(options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'novel-graph-'));
    return { root, store: new GraphStore(root, options) };
}
test('commits nodes and edges, searches summaries, and loads bodies on demand', async (t) => {
    const { root, store } = await temporaryStore();
    t.after(async () => rm(root, { recursive: true, force: true }));
    const created = await store.commit({
        novelId: 'moon-bridge',
        expectedGraphVersion: 0,
        operations: [
            { op: 'upsert_node', expectedVersion: 0, node: linWan },
            { op: 'upsert_node', expectedVersion: 0, node: brother },
            { op: 'upsert_edge', expectedVersion: 0, edge: relationship },
        ],
    });
    assert.equal(created.graphVersion, 1);
    assert.equal(created.applied.length, 3);
    const search = await store.searchNodes('moon-bridge', '家中变化');
    assert.equal(search.nodes.length, 1);
    assert.equal(search.nodes[0]?.id, linWan.id);
    assert.equal('body' in (search.nodes[0] ?? {}), false);
    const fetched = await store.getNode('moon-bridge', linWan.id, true);
    assert.ok('body' in fetched.node);
    assert.equal(fetched.node.body, linWan.body);
    const edges = await store.listEdges('moon-bridge', linWan.id, 'out');
    assert.deepEqual(edges.edges.map(edge => edge.id), [relationship.id]);
});
test('rejects stale graph/entity versions and leaves the full batch unapplied', async (t) => {
    const { root, store } = await temporaryStore();
    t.after(async () => rm(root, { recursive: true, force: true }));
    await store.commit({
        novelId: 'novel',
        expectedGraphVersion: 0,
        operations: [{ op: 'upsert_node', expectedVersion: 0, node: linWan }],
    });
    await assert.rejects(store.commit({
        novelId: 'novel',
        expectedGraphVersion: 1,
        operations: [
            { op: 'upsert_node', expectedVersion: 0, node: brother },
            { op: 'upsert_node', expectedVersion: 0, node: { ...linWan, summary: '错误覆盖' } },
        ],
    }), (error) => error instanceof GraphStoreError && error.code === 'version_conflict');
    const all = await store.searchNodes('novel', '');
    assert.deepEqual(all.nodes.map(node => node.id), [linWan.id]);
    assert.equal(all.graphVersion, 1);
});
test('serializes two process-style store instances so one stale commit loses', async (t) => {
    const { root } = await temporaryStore();
    t.after(async () => rm(root, { recursive: true, force: true }));
    const first = new GraphStore(root);
    const second = new GraphStore(root);
    const outcomes = await Promise.allSettled([
        first.commit({
            novelId: 'shared',
            expectedGraphVersion: 0,
            operations: [{ op: 'upsert_node', expectedVersion: 0, node: linWan }],
        }),
        second.commit({
            novelId: 'shared',
            expectedGraphVersion: 0,
            operations: [{ op: 'upsert_node', expectedVersion: 0, node: brother }],
        }),
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    const rejection = outcomes.find(result => result.status === 'rejected');
    assert.ok(rejection?.status === 'rejected' && rejection.reason instanceof GraphStoreError);
    assert.equal(rejection.reason.code, 'version_conflict');
});
test('recovers a stale lock directory left before owner metadata was written', async (t) => {
    const { root } = await temporaryStore();
    t.after(async () => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'orphaned', 'write.lock'), { recursive: true });
    const recovered = new GraphStore(root, { lockTimeoutMs: 250, staleLockMs: 0 });
    const committed = await recovered.commit({
        novelId: 'orphaned',
        expectedGraphVersion: 0,
        operations: [{ op: 'upsert_node', expectedVersion: 0, node: linWan }],
    });
    assert.equal(committed.graphVersion, 1);
    assert.equal((await recovered.getNode('orphaned', linWan.id)).node.id, linWan.id);
});
test('ignores and repairs a truncated journal tail before the next commit', async (t) => {
    const { root, store } = await temporaryStore();
    t.after(async () => rm(root, { recursive: true, force: true }));
    await store.commit({
        novelId: 'recover',
        expectedGraphVersion: 0,
        operations: [{ op: 'upsert_node', expectedVersion: 0, node: linWan }],
    });
    const journal = join(root, 'recover', 'journal.jsonl');
    await appendFile(journal, '{"truncated":', 'utf8');
    const recovered = new GraphStore(root);
    assert.equal((await recovered.getNode('recover', linWan.id)).graphVersion, 1);
    await recovered.commit({
        novelId: 'recover',
        expectedGraphVersion: 1,
        operations: [{ op: 'upsert_node', expectedVersion: 0, node: brother }],
    });
    const lines = (await readFile(journal, 'utf8')).trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.doesNotThrow(() => lines.map(line => JSON.parse(line)));
});
test('recovers the same graph from a snapshot plus retained journal', async (t) => {
    const { root, store } = await temporaryStore({ snapshotInterval: 1 });
    t.after(async () => rm(root, { recursive: true, force: true }));
    await store.commit({
        novelId: 'snapshot',
        expectedGraphVersion: 0,
        operations: [{ op: 'upsert_node', expectedVersion: 0, node: linWan }],
    });
    const reopened = new GraphStore(root, { snapshotInterval: 1 });
    const result = await reopened.searchNodes('snapshot', '');
    assert.equal(result.graphVersion, 1);
    assert.deepEqual(result.nodes.map(node => node.id), [linWan.id]);
});
test('uses tombstones and prevents active edges from pointing to deleted nodes', async (t) => {
    const { root, store } = await temporaryStore();
    t.after(async () => rm(root, { recursive: true, force: true }));
    await store.commit({
        novelId: 'delete',
        expectedGraphVersion: 0,
        operations: [
            { op: 'upsert_node', expectedVersion: 0, node: linWan },
            { op: 'upsert_node', expectedVersion: 0, node: brother },
            { op: 'upsert_edge', expectedVersion: 0, edge: relationship },
        ],
    });
    await assert.rejects(store.commit({
        novelId: 'delete',
        expectedGraphVersion: 1,
        operations: [{ op: 'delete_node', expectedVersion: 1, nodeId: linWan.id }],
    }), (error) => error instanceof GraphStoreError && error.code === 'referential_conflict');
    const deleted = await store.commit({
        novelId: 'delete',
        expectedGraphVersion: 1,
        operations: [
            { op: 'delete_edge', expectedVersion: 1, edgeId: relationship.id },
            { op: 'delete_node', expectedVersion: 1, nodeId: linWan.id },
        ],
    });
    assert.equal(deleted.graphVersion, 2);
    await assert.rejects(store.getNode('delete', linWan.id), /node not found/);
});
//# sourceMappingURL=store.test.js.map