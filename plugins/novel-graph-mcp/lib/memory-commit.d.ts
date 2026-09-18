/** Commit one validated scene handoff through the real stdio MCP tool surface. */
export interface MemoryCommitOptions {
    handoffPath: string;
    receiptPath: string;
    novelId: string;
    graphRoot: string;
    serverPath: string;
    nodeCommand?: string;
}
export interface MemoryCommitReceipt {
    schema_version: 1;
    novel_id: string;
    handoff_sha256: string;
    source_revision_id: string;
    base_graph_version: number;
    graph_version: number;
    transaction_id: string | null;
    recovered_existing_commit: boolean;
    applied: Array<{
        op: string;
        id: string;
        version: number;
        deleted: boolean;
    }>;
}
export interface ChapterMemoryCommitOptions {
    handoffPaths: string[];
    receiptPath: string;
    novelId: string;
    graphRoot: string;
    serverPath: string;
    nodeCommand?: string;
}
export interface ChapterMemoryCommitReceipt {
    schema_version: 1;
    novel_id: string;
    handoff_sha256s: string[];
    source_revision_ids: string[];
    base_graph_version: number;
    graph_version: number;
    transaction_id: string | null;
    recovered_existing_commit: boolean;
    applied: Array<{
        op: string;
        id: string;
        version: number;
        deleted: boolean;
    }>;
}
export declare function commitSceneMemory(options: MemoryCommitOptions): Promise<MemoryCommitReceipt>;
/** Merge an ordered chapter's handoffs and expose them in one graph transaction. */
export declare function commitChapterMemory(options: ChapterMemoryCommitOptions): Promise<ChapterMemoryCommitReceipt>;
