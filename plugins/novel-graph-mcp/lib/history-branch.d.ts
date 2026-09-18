export interface HistoryBranchOptions {
    sourceNovelId: string;
    branchNovelId: string;
    runId: string;
    manifestPath: string;
    graphRoot: string;
    resultsRoot: string;
    receiptPath: string;
}
export declare function prepareHistoryGraph(options: HistoryBranchOptions): Promise<{
    schema_version: number;
    status: string;
    source_novel_id: string;
    source_graph_novel_id: string;
    source_graph_version: number;
    branch_novel_id: string;
    branch_initial_graph_version: number;
    run_id: string;
    manifest_sha256: string;
    graph_root: string;
}>;
/** Freeze the completed branch until the catalog atomically adopts it. */
export declare function sealHistoryGraph(receiptPath: string): Promise<any>;
export declare function unsealPublishedHistoryGraph(receiptPath: string, resultsRoot: string): Promise<any>;
export declare function sealHistoryRollback(receiptPath: string): Promise<any>;
export declare function unsealHistoryRollback(receiptPath: string, resultsRoot: string): Promise<any>;
