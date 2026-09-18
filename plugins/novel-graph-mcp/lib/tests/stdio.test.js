import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
test('serves the five stable tools over real stdio and returns structured content', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'novel-graph-stdio-'));
    t.after(async () => rm(root, { recursive: true, force: true }));
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] !== undefined));
    environment.WRITING_NOVEL_GRAPH_DB = root;
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../bin.js', import.meta.url))],
        env: environment,
        stderr: 'pipe',
    });
    const client = new Client({ name: 'novel-graph-test', version: '1.0.0' });
    t.after(async () => client.close());
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [
        'commit_changes',
        'get_edge',
        'get_node',
        'list_edges',
        'search_nodes',
    ]);
    const committed = await client.callTool({
        name: 'commit_changes',
        arguments: {
            novelId: 'stdio-novel',
            expectedGraphVersion: 0,
            operations: [
                {
                    op: 'upsert_node',
                    expectedVersion: 0,
                    node: {
                        id: 'character:lin-wan',
                        kind: 'character_card',
                        name: '林晚',
                        summary: '决定亲自去镇上。',
                        body: '她把信收进外衣口袋。',
                        sourceRevisionId: 'revision-001',
                    },
                },
            ],
        },
    });
    assert.equal(committed.isError, undefined);
    assert.equal(committed.structuredContent.ok, true);
    const found = await client.callTool({
        name: 'search_nodes',
        arguments: { novelId: 'stdio-novel', query: '林晚' },
    });
    const structured = found.structuredContent;
    assert.equal(structured.ok, true);
    assert.equal(structured.nodes.length, 1);
    assert.equal('body' in (structured.nodes[0] ?? {}), false);
});
//# sourceMappingURL=stdio.test.js.map