import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { commitChapterMemory, commitSceneMemory } from '../memory-commit.js';
import { GraphStore } from '../store.js';
test('commits a handoff once and reuses its durable receipt on resume', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'novel-memory-commit-'));
    t.after(async () => rm(root, { recursive: true, force: true }));
    const handoffPath = join(root, 'handoff.json');
    const receiptPath = join(root, 'receipt.json');
    await writeFile(handoffPath, `${JSON.stringify({
        revision_sha256: 'revision-001',
        memory_delta: {
            upsert_nodes: [{
                    id: 'delta-1',
                    node_id: 'character:lin-wan',
                    kind: 'character_card',
                    name: '林晚',
                    summary: '决定亲自去镇上。',
                    body_append: '林晚保留信件，决定亲自去镇上。',
                    source_revision_id: 'revision-001',
                    confidence: 1,
                    evidence: { start: 0, end: 1, quote: '林' },
                }],
            upsert_edges: [],
        },
    })}\n`, 'utf8');
    const options = {
        handoffPath,
        receiptPath,
        novelId: 'moon-bridge',
        graphRoot: join(root, 'graphs'),
        serverPath: fileURLToPath(new URL('../bin.js', import.meta.url)),
    };
    const first = await commitSceneMemory(options);
    const resumed = await commitSceneMemory(options);
    assert.deepEqual(resumed, first);
    assert.equal(first.graph_version, 1);
    assert.equal(first.applied.length, 1);
    const node = await new GraphStore(options.graphRoot).getNode('moon-bridge', 'character:lin-wan');
    assert.equal(node.node.version, 1);
    assert.deepEqual(JSON.parse(await readFile(receiptPath, 'utf8')), first);
});
test('publishes all ordered chapter handoffs in one graph transaction', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'novel-chapter-memory-'));
    t.after(async () => rm(root, { recursive: true, force: true }));
    const paths = [];
    for (const [index, addition] of ['第一次选择。', '选择产生后果。'].entries()) {
        const path = join(root, `handoff-${index + 1}.json`);
        paths.push(path);
        await writeFile(path, JSON.stringify({ revision_sha256: `revision-${index + 1}`, memory_delta: { upsert_nodes: [{ id: `delta-${index + 1}`, node_id: 'character:lin-wan', kind: 'character_card', name: '林晚', summary: '选择已推进。', body_append: addition, source_revision_id: `revision-${index + 1}`, confidence: 1, evidence: { start: 0, end: 1, quote: '林' } }], upsert_edges: [] } }) + '\n');
    }
    const options = { handoffPaths: paths, receiptPath: join(root, 'chapter-receipt.json'), novelId: 'chapter-novel', graphRoot: join(root, 'graphs'), serverPath: fileURLToPath(new URL('../bin.js', import.meta.url)) };
    const first = await commitChapterMemory(options);
    const resumed = await commitChapterMemory(options);
    assert.deepEqual(resumed, first);
    assert.equal(first.graph_version, 1);
    assert.equal(first.transaction_id === null, false);
    assert.equal(first.handoff_sha256s.length, 2);
    await rm(options.receiptPath);
    const recovered = await commitChapterMemory(options);
    assert.equal(recovered.graph_version, 1);
    assert.equal(recovered.transaction_id, first.transaction_id);
    const node = await new GraphStore(options.graphRoot).getNode('chapter-novel', 'character:lin-wan');
    assert.equal(node.node.version, 1);
    assert.ok('body' in node.node);
    assert.match(node.node.body, /第一次选择/);
    assert.match(node.node.body, /选择产生后果/);
});
//# sourceMappingURL=memory-commit.test.js.map