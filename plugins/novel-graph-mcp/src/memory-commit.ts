/** Commit one validated scene handoff through the real stdio MCP tool surface. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

interface Evidence {
  start: number
  end: number
  quote: string
}

interface NodeDelta {
  id: string
  node_id: string
  kind: 'world_entry' | 'character_card'
  name: string
  summary: string
  body_append: string
  source_revision_id: string
  confidence: number
  evidence: Evidence
}

interface EdgeDelta {
  id: string
  edge_id: string
  from_node_id: string
  to_node_id: string
  relation: string
  summary: string
  body_append: string
  source_revision_id: string
  confidence: number
  evidence: Evidence
}

interface SceneHandoff {
  revision_sha256: string
  memory_delta: { upsert_nodes: NodeDelta[]; upsert_edges: EdgeDelta[] }
}

interface ExistingNode {
  id: string
  kind: NodeDelta['kind']
  name: string
  summary: string
  body: string
  sourceRevisionId: string
  version: number
}

interface ExistingEdge {
  id: string
  type: string
  fromNodeId: string
  toNodeId: string
  summary: string
  body: string
  sourceRevisionId: string
  version: number
}

interface ToolValue {
  ok: boolean
  graphVersion?: number
  node?: ExistingNode
  edge?: ExistingEdge
  edges?: ExistingEdge[]
  transactionId?: string
  applied?: Array<{ op: string; id: string; version: number; deleted: boolean }>
  error?: { code: string; message: string; details?: Record<string, unknown> }
}

export interface MemoryCommitOptions {
  handoffPath: string
  receiptPath: string
  novelId: string
  graphRoot: string
  serverPath: string
  nodeCommand?: string
}

export interface MemoryCommitReceipt {
  schema_version: 1
  novel_id: string
  handoff_sha256: string
  source_revision_id: string
  base_graph_version: number
  graph_version: number
  transaction_id: string | null
  recovered_existing_commit: boolean
  applied: Array<{ op: string; id: string; version: number; deleted: boolean }>
}

export interface ChapterMemoryCommitOptions {
  handoffPaths: string[]
  receiptPath: string
  novelId: string
  graphRoot: string
  serverPath: string
  nodeCommand?: string
}

export interface ChapterMemoryCommitReceipt {
  schema_version: 1
  novel_id: string
  handoff_sha256s: string[]
  source_revision_ids: string[]
  base_graph_version: number
  graph_version: number
  transaction_id: string | null
  recovered_existing_commit: boolean
  applied: Array<{ op: string; id: string; version: number; deleted: boolean }>
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

function appendFact(existing: string, addition: string): string {
  return existing.includes(addition) ? existing : `${existing.trimEnd()}\n\n${addition}`
}

function environment(graphRoot: string): Record<string, string> {
  const values = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  values.WRITING_NOVEL_GRAPH_DB = graphRoot
  return values
}

async function tool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolValue> {
  const result = await client.callTool({ name, arguments: args })
  const value = result.structuredContent as unknown as ToolValue
  if (result.isError || !value?.ok) {
    throw new Error(`novel graph ${name} failed: ${JSON.stringify(value?.error ?? result.content)}`)
  }
  return value
}

async function optionalNode(client: Client, novelId: string, nodeId: string): Promise<ExistingNode | undefined> {
  const result = await client.callTool({ name: 'get_node', arguments: { novelId, nodeId, includeBody: true } })
  const value = result.structuredContent as unknown as ToolValue
  if (!result.isError && value?.ok) return value.node
  if (value?.error?.code === 'not_found') return undefined
  throw new Error(`novel graph get_node failed: ${JSON.stringify(value?.error ?? result.content)}`)
}

async function optionalEdge(client: Client, novelId: string, edgeId: string): Promise<ExistingEdge | undefined> {
  const result = await client.callTool({ name: 'get_edge', arguments: { novelId, edgeId } })
  const value = result.structuredContent as unknown as ToolValue
  if (!result.isError && value?.ok) return value.edge
  if (value?.error?.code === 'not_found') return undefined
  throw new Error(`novel graph get_edge failed: ${JSON.stringify(value?.error ?? result.content)}`)
}

export async function commitSceneMemory(options: MemoryCommitOptions): Promise<MemoryCommitReceipt> {
  const handoffText = await readFile(options.handoffPath, 'utf8')
  const handoffSha = sha256(handoffText)
  const handoff = JSON.parse(handoffText) as SceneHandoff
  try {
    const existingReceipt = JSON.parse(await readFile(options.receiptPath, 'utf8')) as MemoryCommitReceipt
    if (existingReceipt.handoff_sha256 !== handoffSha || existingReceipt.novel_id !== options.novelId) {
      throw new Error('existing memory receipt refers to a different handoff or novel')
    }
    return existingReceipt
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const transport = new StdioClientTransport({
    command: options.nodeCommand ?? process.execPath,
    args: [options.serverPath],
    env: environment(options.graphRoot),
    stderr: 'pipe',
  })
  const client = new Client({ name: 'novel-graph-memory-commit', version: '0.1.0' })
  await client.connect(transport)
  try {
    const graph = await tool(client, 'search_nodes', { novelId: options.novelId, query: '', limit: 1 })
    const baseGraphVersion = graph.graphVersion ?? 0
    const operations: Array<Record<string, unknown>> = []

    for (const delta of handoff.memory_delta.upsert_nodes) {
      const existing = await optionalNode(client, options.novelId, delta.node_id)
      if (existing?.sourceRevisionId === delta.source_revision_id) continue
      operations.push({
        op: 'upsert_node',
        expectedVersion: existing?.version ?? 0,
        node: {
          id: delta.node_id,
          kind: delta.kind,
          name: delta.name,
          summary: delta.summary,
          body: existing === undefined ? delta.body_append : appendFact(existing.body, delta.body_append),
          sourceRevisionId: delta.source_revision_id,
        },
      })
    }

    for (const delta of handoff.memory_delta.upsert_edges) {
      const existing = await optionalEdge(client, options.novelId, delta.edge_id)
      if (existing?.sourceRevisionId === delta.source_revision_id) continue
      operations.push({
        op: 'upsert_edge',
        expectedVersion: existing?.version ?? 0,
        edge: {
          id: delta.edge_id,
          type: delta.relation,
          fromNodeId: delta.from_node_id,
          toNodeId: delta.to_node_id,
          summary: delta.summary,
          body: existing === undefined ? delta.body_append : appendFact(existing.body, delta.body_append),
          sourceRevisionId: delta.source_revision_id,
        },
      })
    }

    let value: ToolValue = { ok: true, graphVersion: baseGraphVersion, applied: [] }
    if (operations.length > 0) {
      value = await tool(client, 'commit_changes', {
        novelId: options.novelId,
        expectedGraphVersion: baseGraphVersion,
        operations,
      })
    }
    const receipt: MemoryCommitReceipt = {
      schema_version: 1,
      novel_id: options.novelId,
      handoff_sha256: handoffSha,
      source_revision_id: handoff.revision_sha256,
      base_graph_version: baseGraphVersion,
      graph_version: value.graphVersion ?? baseGraphVersion,
      transaction_id: value.transactionId ?? null,
      recovered_existing_commit: operations.length === 0,
      applied: value.applied ?? [],
    }
    await atomicJson(options.receiptPath, receipt)
    return receipt
  } finally {
    await client.close()
  }
}

/** Merge an ordered chapter's handoffs and expose them in one graph transaction. */
export async function commitChapterMemory(options: ChapterMemoryCommitOptions): Promise<ChapterMemoryCommitReceipt> {
  if (options.handoffPaths.length === 0) throw new Error('chapter memory commit requires handoffs')
  const texts = await Promise.all(options.handoffPaths.map(path => readFile(path, 'utf8')))
  const hashes = texts.map(sha256); const handoffs = texts.map(text => JSON.parse(text) as SceneHandoff)
  try {
    const receipt = JSON.parse(await readFile(options.receiptPath, 'utf8')) as ChapterMemoryCommitReceipt
    if (receipt.novel_id !== options.novelId || JSON.stringify(receipt.handoff_sha256s) !== JSON.stringify(hashes)) throw new Error('existing chapter memory receipt refers to another input')
    return receipt
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const transport = new StdioClientTransport({command:options.nodeCommand ?? process.execPath,args:[options.serverPath],env:environment(options.graphRoot),stderr:'pipe'})
  const client = new Client({name:'novel-graph-chapter-memory-commit',version:'0.1.0'}); await client.connect(transport)
  try {
    const requestId = 'chapter-' + sha256(JSON.stringify([options.novelId, hashes]))
    const requestPath = options.receiptPath + '.request.json'
    const writeReceipt = async (value: ToolValue, base: number, recovered: boolean) => {
      const receipt: ChapterMemoryCommitReceipt = {
        schema_version: 1, novel_id: options.novelId, handoff_sha256s: hashes,
        source_revision_ids: handoffs.map(x => x.revision_sha256),
        base_graph_version: base, graph_version: value.graphVersion ?? base,
        transaction_id: value.transactionId ?? null, recovered_existing_commit: recovered,
        applied: value.applied ?? [],
      }
      await atomicJson(options.receiptPath, receipt)
      return receipt
    }
    try {
      const pending = JSON.parse(await readFile(requestPath, 'utf8')) as Record<string, unknown>
      if (pending.requestId !== requestId || pending.novelId !== options.novelId) throw new Error('pending chapter request identifies different input')
      const value = await tool(client, 'commit_changes', pending)
      return await writeReceipt(value, pending.expectedGraphVersion as number, true)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const graph=await tool(client,'search_nodes',{novelId:options.novelId,query:'',limit:1}); const base=graph.graphVersion ?? 0
    const desiredNodes=new Map<string,{existing:ExistingNode|undefined,delta:NodeDelta,body:string}>()
    for (const handoff of handoffs) for (const delta of handoff.memory_delta.upsert_nodes) {
      let current=desiredNodes.get(delta.node_id)
      if (!current) { const existing=await optionalNode(client,options.novelId,delta.node_id); current={existing,delta,body:existing?.body ?? ''} }
      current={...current,delta,body:appendFact(current.body,delta.body_append)}; desiredNodes.set(delta.node_id,current)
    }
    const operations:Array<Record<string,unknown>>=[]
    for (const [id,value] of desiredNodes) operations.push({op:'upsert_node',expectedVersion:value.existing?.version ?? 0,node:{id,kind:value.delta.kind,name:value.delta.name,summary:value.delta.summary,body:value.body.trim(),sourceRevisionId:value.delta.source_revision_id}})
    const desiredEdges=new Map<string,{existing:ExistingEdge|undefined,delta:EdgeDelta,body:string}>()
    for (const handoff of handoffs) for (const delta of handoff.memory_delta.upsert_edges) {
      let current=desiredEdges.get(delta.edge_id)
      if (!current) {
        const existing=await optionalEdge(client,options.novelId,delta.edge_id); current={existing,delta,body:existing?.body ?? ''}
      }
      current={...current,delta,body:appendFact(current.body,delta.body_append)}; desiredEdges.set(delta.edge_id,current)
    }
    for (const [id,value] of desiredEdges) operations.push({op:'upsert_edge',expectedVersion:value.existing?.version ?? 0,edge:{id,type:value.delta.relation,fromNodeId:value.delta.from_node_id,toNodeId:value.delta.to_node_id,summary:value.delta.summary,body:value.body.trim(),sourceRevisionId:value.delta.source_revision_id}})
    let value: ToolValue = {ok:true,graphVersion:base,applied:[]}
    if (operations.length) {
      const pending = {requestId,novelId:options.novelId,expectedGraphVersion:base,operations}
      await atomicJson(requestPath, pending)
      value = await tool(client,'commit_changes',pending)
    }
    return await writeReceipt(value, base, false)
  } finally { await client.close() }
}
