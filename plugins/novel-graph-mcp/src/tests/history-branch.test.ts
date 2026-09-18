import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GraphStore } from '../store.js'
import { prepareHistoryGraph, sealHistoryGraph, unsealPublishedHistoryGraph, sealHistoryRollback, unsealHistoryRollback } from '../history-branch.js'
import { physicalNovelId } from '../graph-routing.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'history-graph-'))
  const store = new GraphStore(join(root, 'graph'))
  const node = { id: 'person', kind: 'character_card' as const, name: '林', summary: '旧事实', body: '旧事实', sourceRevisionId: 'rev1' }
  const manual = { ...node, id: 'manual', body: '作者设定', summary: '作者设定', sourceRevisionId: 'author' }
  const edge = { id: 'knows', type: 'knows', fromNodeId: 'person', toNodeId: 'manual', summary: '认识', body: '认识', sourceRevisionId: 'rev1' }
  await store.commit({ novelId: 'book', expectedGraphVersion: 0, operations: [
    { op: 'upsert_node', expectedVersion: 0, node }, { op: 'upsert_node', expectedVersion: 0, node: manual },
    { op: 'upsert_edge', expectedVersion: 0, edge } ] })
  const handoff = join(root, 'handoff.json'); const manifest = join(root, 'manifest.json')
  await writeFile(handoff, JSON.stringify({ memory_delta: {
    upsert_nodes: [{ node_id: 'person', kind: node.kind, name: node.name, summary: node.summary, body_append: node.body, source_revision_id: 'rev1' }],
    upsert_edges: [{ edge_id: 'knows', relation: 'knows', from_node_id: 'person', to_node_id: 'manual', summary: '认识', body_append: '认识', source_revision_id: 'rev1' }] } }))
  await writeFile(manifest, JSON.stringify({ handoffs: [{ path: handoff, retire: true }] }))
  const options = { sourceNovelId: 'book', branchNovelId: 'history-test', runId: 'run1', manifestPath: manifest, graphRoot: store.root, resultsRoot: root, receiptPath: join(root, 'receipt.json') }
  return { root, store, options, node }
}

test('history branch retires pipeline nodes/edges, preserves manual memory, fences and routes publication', async () => {
  const { root, store, options, node } = await fixture()
  await prepareHistoryGraph(options)
  await prepareHistoryGraph(options)
  const manual = (await store.getNode('history-test', 'manual')).node
  assert.equal('body' in manual && manual.body, '作者设定')
  await assert.rejects(store.getNode('history-test', 'person'), /not found/)
  await assert.rejects(store.getEdge('history-test', 'knows'), /not found/)
  await assert.rejects(store.commit({ novelId: 'book', expectedGraphVersion: 1, operations: [{ op: 'upsert_node', expectedVersion: 1, node }] }), /fenced/)
  const receipt = await sealHistoryGraph(options.receiptPath)
  assert.equal(receipt.branch_sealed, true)
  await assert.rejects(unsealPublishedHistoryGraph(options.receiptPath, root), /not adopted/)
  await mkdir(join(root, '.novels/book'), { recursive: true })
  await writeFile(join(root, '.novels/book/catalog.json'), JSON.stringify({ graph_novel_id: 'history-test' }))
  assert.equal(await physicalNovelId('book', root), 'history-test')
  await unsealPublishedHistoryGraph(options.receiptPath, root)
  await unsealPublishedHistoryGraph(options.receiptPath, root)
  await store.commit({ novelId: 'history-test', expectedGraphVersion: 0, operations: [{ op: 'upsert_node', expectedVersion: 0, node }] })
  await assert.rejects(sealHistoryRollback(options.receiptPath), /changed after publication/)
  assert.ok(await readFile(join(store.root, 'book/history-fence.json'), 'utf8'))
})

test('retained pipeline nodes and edges survive; rollback safely restores source writes', async () => {
  const { root, store, options, node } = await fixture()
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8'))
  manifest.handoffs[0].retire = false
  await writeFile(options.manifestPath, JSON.stringify(manifest))
  await prepareHistoryGraph(options)
  assert.equal((await store.getEdge('history-test', 'knows')).edge.body, '认识')
  await sealHistoryGraph(options.receiptPath)
  await mkdir(join(root, '.novels/book'), { recursive: true })
  await writeFile(join(root, '.novels/book/catalog.json'), JSON.stringify({ graph_novel_id: 'history-test' }))
  await unsealPublishedHistoryGraph(options.receiptPath, root)
  await sealHistoryRollback(options.receiptPath)
  await writeFile(join(root, '.novels/book/catalog.json'), JSON.stringify({ graph_novel_id: 'book', last_history_rollback: { run_id: 'run1' } }))
  await unsealHistoryRollback(options.receiptPath, root)
  await store.commit({ novelId: 'book', expectedGraphVersion: 1, operations: [{ op: 'upsert_node', expectedVersion: 1, node }] })
  await assert.rejects(store.commit({ novelId: 'history-test', expectedGraphVersion: 0, operations: [{ op: 'upsert_node', expectedVersion: 1, node }] }), /fenced/)
})

test('manual edits overlapping pipeline contributions fail without fencing source', async () => {
  const { store, options, node } = await fixture()
  await store.commit({ novelId: 'book', expectedGraphVersion: 1, operations: [{ op: 'upsert_node', expectedVersion: 1, node: { ...node, body: '人工改写' } }] })
  await assert.rejects(prepareHistoryGraph(options), /cannot safely retract/)
  await store.commit({ novelId: 'book', expectedGraphVersion: 2, operations: [{ op: 'upsert_node', expectedVersion: 2, node }] })
})
