/** MCP tool surface for one process-shared novel property graph. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { GraphStore, GraphStoreError } from './store.js'
import { physicalNovelId } from './graph-routing.js'
import type { CommitOperation, CommitRequest, GraphEdgeInput, GraphNodeInput, NodeKind } from './types.js'

const nodeKind = z.enum(['world_book', 'world_entry', 'character_card'])
const nodeInput = z.object({
  id: z.string(),
  kind: nodeKind,
  name: z.string(),
  summary: z.string(),
  body: z.string(),
  sourceRevisionId: z.string(),
})
const edgeInput = z.object({
  id: z.string(),
  type: z.string(),
  fromNodeId: z.string(),
  toNodeId: z.string(),
  summary: z.string(),
  body: z.string(),
  sourceRevisionId: z.string(),
})
const operationInput = z.object({
  op: z.enum(['upsert_node', 'delete_node', 'upsert_edge', 'delete_edge']),
  expectedVersion: z.number().int().nonnegative(),
  node: nodeInput.optional(),
  nodeId: z.string().optional(),
  edge: edgeInput.optional(),
  edgeId: z.string().optional(),
})

function success(value: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  }
}

function failure(error: unknown) {
  const value = error instanceof GraphStoreError
    ? { ok: false, error: { code: error.code, message: error.message, details: error.details } }
    : { ok: false, error: { code: 'internal_error', message: error instanceof Error ? error.message : String(error) } }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
    isError: true,
  }
}

function parseOperation(input: z.infer<typeof operationInput>, index: number): CommitOperation {
  if (input.op === 'upsert_node') {
    if (input.node === undefined) throw new GraphStoreError('invalid_input', `operations[${index}].node is required`)
    return { op: input.op, expectedVersion: input.expectedVersion, node: input.node as GraphNodeInput }
  }
  if (input.op === 'delete_node') {
    if (input.nodeId === undefined) throw new GraphStoreError('invalid_input', `operations[${index}].nodeId is required`)
    return { op: input.op, expectedVersion: input.expectedVersion, nodeId: input.nodeId }
  }
  if (input.op === 'upsert_edge') {
    if (input.edge === undefined) throw new GraphStoreError('invalid_input', `operations[${index}].edge is required`)
    return { op: input.op, expectedVersion: input.expectedVersion, edge: input.edge as GraphEdgeInput }
  }
  if (input.edgeId === undefined) throw new GraphStoreError('invalid_input', `operations[${index}].edgeId is required`)
  return { op: input.op, expectedVersion: input.expectedVersion, edgeId: input.edgeId }
}

export function createNovelGraphServer(store: GraphStore, onCommit?: (input: {
  novelId: string
  result: Record<string, unknown>
}) => Promise<void> | void): McpServer {
  const server = new McpServer({ name: 'novel-graph', version: '0.1.0' }, { capabilities: { tools: {} } })

  server.registerTool('search_nodes', {
    title: 'Search novel graph nodes',
    description: 'Search world-book and character-card names and summaries. Returns summaries only; call get_node for full body text.',
    inputSchema: {
      novelId: z.string(),
      query: z.string(),
      kinds: z.array(nodeKind).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async input => {
    try {
      const result = await store.searchNodes(
        await physicalNovelId(input.novelId),
        input.query,
        (input.kinds ?? []) as NodeKind[],
        input.limit ?? 20,
      )
      return success({ ok: true, ...result, novelId: input.novelId })
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('get_node', {
    title: 'Get one novel graph node',
    description: 'Fetch one world-book or character-card node by stable id, optionally including its complete body.',
    inputSchema: {
      novelId: z.string(),
      nodeId: z.string(),
      includeBody: z.boolean().optional(),
    },
  }, async input => {
    try {
      return success({ ok: true, ...await store.getNode(await physicalNovelId(input.novelId), input.nodeId, input.includeBody ?? true), novelId: input.novelId })
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('get_edge', {
    title: 'Get one novel graph relationship',
    description: 'Fetch a relationship by stable id, including its complete body and version, without list truncation.',
    inputSchema: { novelId: z.string(), edgeId: z.string() },
  }, async input => {
    try {
      return success({ ok: true, ...await store.getEdge(await physicalNovelId(input.novelId), input.edgeId), novelId: input.novelId })
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('list_edges', {
    title: 'List relationships for one node',
    description: 'List incoming, outgoing, or both relationship directions for a novel graph node.',
    inputSchema: {
      novelId: z.string(),
      nodeId: z.string(),
      direction: z.enum(['in', 'out', 'both']).optional(),
      types: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, async input => {
    try {
      return success({
        ok: true,
        ...await store.listEdges(
          await physicalNovelId(input.novelId),
          input.nodeId,
          input.direction ?? 'both',
          input.types ?? [],
          input.limit ?? 50,
        ),
        novelId: input.novelId,
      })
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('commit_changes', {
    title: 'Commit novel graph changes',
    description: 'Atomically create, update, or tombstone nodes and edges with graph and entity optimistic-version checks.',
    inputSchema: {
      requestId: z.string().optional(),
      novelId: z.string(),
      expectedGraphVersion: z.number().int().nonnegative(),
      operations: z.array(operationInput).min(1).max(100),
    },
  }, async input => {
    try {
      const request: CommitRequest = {
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        novelId: await physicalNovelId(input.novelId),
        expectedGraphVersion: input.expectedGraphVersion,
        operations: input.operations.map(parseOperation),
      }
      const result = await store.commit(request)
      await onCommit?.({ novelId: input.novelId, result: result as unknown as Record<string, unknown> })
      return success({ ok: true, ...result, novelId: input.novelId })
    } catch (error) {
      return failure(error)
    }
  })

  return server
}
