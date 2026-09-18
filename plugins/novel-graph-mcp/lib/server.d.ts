/** MCP tool surface for one process-shared novel property graph. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphStore } from './store.js';
export declare function createNovelGraphServer(store: GraphStore, onCommit?: (input: {
    novelId: string;
    result: Record<string, unknown>;
}) => Promise<void> | void): McpServer;
