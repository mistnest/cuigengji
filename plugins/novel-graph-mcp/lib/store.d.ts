/** Crash-recoverable, process-shared property graph backed by snapshots and a journal. */
import type { CommitRequest, CommitResult, GraphEdge, GraphNode, GraphSnapshot, NodeKind } from './types.js';
export declare class GraphStoreError extends Error {
    readonly code: string;
    readonly details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export interface GraphStoreOptions {
    snapshotInterval?: number;
    lockTimeoutMs?: number;
    staleLockMs?: number;
}
export declare class GraphStore {
    readonly root: string;
    readonly snapshotInterval: number;
    readonly lockTimeoutMs: number;
    readonly staleLockMs: number;
    constructor(root: string, options?: GraphStoreOptions);
    private paths;
    private readJson;
    private load;
    private clearStaleLock;
    private withWriteLock;
    /** Revision control uses the same process-shared lock as ordinary commits. */
    revisionLock<T>(novelId: string, operation: () => Promise<T>): Promise<T>;
    exportSnapshot(novelId: string): Promise<GraphSnapshot>;
    installRevisionSnapshot(snapshot: GraphSnapshot): Promise<void>;
    searchNodes(novelId: string, query: string, kinds?: NodeKind[], limit?: number): Promise<{
        novelId: string;
        graphVersion: number;
        nodes: Array<Omit<GraphNode, 'body'>>;
    }>;
    getNode(novelId: string, nodeId: string, includeBody?: boolean): Promise<{
        novelId: string;
        graphVersion: number;
        node: GraphNode | Omit<GraphNode, 'body'>;
    }>;
    getEdge(novelId: string, edgeId: string): Promise<{
        novelId: string;
        graphVersion: number;
        edge: GraphEdge;
    }>;
    listEdges(novelId: string, nodeId: string, direction?: 'in' | 'out' | 'both', types?: string[], limit?: number): Promise<{
        novelId: string;
        graphVersion: number;
        edges: GraphEdge[];
    }>;
    commit(request: CommitRequest): Promise<CommitResult>;
}
