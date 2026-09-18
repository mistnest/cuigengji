import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function createWritingProjectServer({ bridgeUrl, token, projectId }) {
    const server = new McpServer({ name: 'writing-project', version: '0.1.0' }, { capabilities: { tools: {} } });
    const call = (tool, argumentsValue) => callBridge({ bridgeUrl, token, projectId, tool, argumentsValue });

    server.registerTool('manuscript_list', {
        title: 'List manuscript structure',
        description: 'List volumes and chapters with metadata only. Does not load full chapter text.',
        inputSchema: {},
    }, async () => result(await call('manuscript_list', {})));

    server.registerTool('manuscript_get', {
        title: 'Read manuscript chapter',
        description: 'Read one volume or chapter. Use includeContent=false for metadata, or start/maxChars for a bounded text window.',
        inputSchema: {
            chapterId: z.string().min(1).max(200),
            includeContent: z.boolean().optional(),
            start: z.number().int().min(0).optional(),
            maxChars: z.number().int().min(1).max(200_000).optional(),
        },
    }, async input => result(await call('manuscript_get', input)));

    server.registerTool('manuscript_create', {
        title: 'Create chapter or volume',
        description: 'Create a chapter, or pass type="volume" to create a volume. Agent writes are audited as agent mutations.',
        inputSchema: {
            type: z.enum(['chapter', 'volume']).optional(),
            title: z.string().max(200).optional(),
            content: z.string().max(2_000_000).optional(),
            volumeId: z.string().max(200).optional(),
            order: z.number().optional(),
        },
    }, async input => result(await call('manuscript_create', input)));

    server.registerTool('manuscript_update', {
        title: 'Update chapter or volume metadata',
        description: 'Update a chapter with optimistic concurrency. Always provide the revision/hash returned by manuscript_get.',
        inputSchema: {
            chapterId: z.string().min(1).max(200),
            expectedRevision: z.number().int().min(1),
            expectedContentHash: z.string().max(128).optional(),
            patch: z.object({
                title: z.string().max(200).optional(),
                content: z.string().max(2_000_000).optional(),
                summary: z.string().max(20_000).optional(),
                order: z.number().optional(),
                volumeId: z.string().max(200).optional(),
            }),
        },
    }, async input => result(await call('manuscript_update', input)));

    server.registerTool('manuscript_delete', {
        title: 'Delete chapter or volume',
        description: 'Destructive operation. The caller must explicitly pass confirmed=true and the current revision/hash.',
        inputSchema: {
            chapterId: z.string().min(1).max(200),
            confirmed: z.literal(true),
            expectedRevision: z.number().int().min(1),
            expectedContentHash: z.string().max(128).optional(),
        },
    }, async input => result(await call('manuscript_delete', input)));
    return server;
}

async function callBridge({ bridgeUrl, token, projectId, tool, argumentsValue }) {
    const response = await fetch(`${bridgeUrl}/v1/execute`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId, tool, arguments: argumentsValue }),
        signal: AbortSignal.timeout(30_000),
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error(`writing project bridge returned HTTP ${response.status}`); }
    if (!response.ok || payload?.ok !== true) {
        const error = payload?.error || {};
        const wrapped = new Error(error.message || `writing project bridge returned HTTP ${response.status}`);
        wrapped.code = error.code || 'bridge_error';
        wrapped.details = error.details;
        throw wrapped;
    }
    return payload.result;
}

function result(value) {
    return {
        content: [{ type: 'text', text: JSON.stringify(value) }],
        structuredContent: value,
    };
}
