/** Durable property-graph records used by the novel memory server. */

export type NodeKind = 'world_book' | 'world_entry' | 'character_card'

export interface GraphNodeInput {
  id: string
  kind: NodeKind
  name: string
  summary: string
  body: string
  sourceRevisionId: string
}

export interface GraphEdgeInput {
  id: string
  type: string
  fromNodeId: string
  toNodeId: string
  summary: string
  body: string
  sourceRevisionId: string
}

export interface GraphNode extends GraphNodeInput {
  version: number
  createdAt: string
  updatedAt: string
  deleted: boolean
  deletedAt?: string
}

export interface GraphEdge extends GraphEdgeInput {
  version: number
  createdAt: string
  updatedAt: string
  deleted: boolean
  deletedAt?: string
}

export type CommitOperation =
  | { op: 'upsert_node'; expectedVersion: number; node: GraphNodeInput }
  | { op: 'delete_node'; expectedVersion: number; nodeId: string }
  | { op: 'upsert_edge'; expectedVersion: number; edge: GraphEdgeInput }
  | { op: 'delete_edge'; expectedVersion: number; edgeId: string }

export interface CommitRequest {
  requestId?: string
  novelId: string
  expectedGraphVersion: number
  operations: CommitOperation[]
}

export interface CommitResult {
  novelId: string
  graphVersion: number
  transactionId: string
  applied: Array<{ op: CommitOperation['op']; id: string; version: number; deleted: boolean }>
}

export interface GraphSnapshot {
  requests?: Record<string, { hash: string; result: CommitResult }>
  schemaVersion: 1
  novelId: string
  graphVersion: number
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface JournalTransaction {
  request?: { id: string; hash: string; result: CommitResult }
  schemaVersion: 1
  transactionId: string
  baseGraphVersion: number
  graphVersion: number
  committedAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}
