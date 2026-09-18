export declare function resultsRoot(): string;
/** One catalog pointer, never recursively follow aliases. */
export declare function physicalNovelId(novelId: string, root?: string): Promise<string>;
