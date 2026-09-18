#!/usr/bin/env node
/** Start the novel graph MCP server over stdio. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNovelGraphServer } from './server.js';
import { GraphStore } from './store.js';
const root = process.env.WRITING_NOVEL_GRAPH_DB?.trim();
if (!root) {
    process.stderr.write('novel-graph-mcp: WRITING_NOVEL_GRAPH_DB is required\n');
    process.exitCode = 2;
}
else {
    const callbackUrl = process.env.WRITING_PROJECT_BRIDGE_URL?.trim();
    const callbackToken = process.env.WRITING_PROJECT_BRIDGE_TOKEN?.trim();
    const server = createNovelGraphServer(new GraphStore(root), callbackUrl && callbackToken
        ? async ({ novelId, result }) => {
            try {
                await fetch(`${callbackUrl}/v1/graph-changed`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        authorization: `Bearer ${callbackToken}`,
                    },
                    body: JSON.stringify({
                        entityType: 'graph',
                        entityId: result.transactionId || 'graph',
                        graphVersion: result.graphVersion || 0,
                        changedFields: result.applied || [],
                        novelId,
                    }),
                    signal: AbortSignal.timeout(2_000),
                });
            }
            catch (error) {
                process.stderr.write(`novel-graph-mcp: callback failed: ${String(error)}\n`);
            }
        }
        : undefined);
    await server.connect(new StdioServerTransport());
}
//# sourceMappingURL=bin.js.map