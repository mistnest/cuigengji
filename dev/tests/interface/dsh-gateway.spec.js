import { expect, test } from '@playwright/test';

import { mapDshEvent } from '../../../electron/intelligence/agent/dsh/dsh-event-mapper.js';
import { createDshEventStream } from '../../../electron/intelligence/agent/dsh/dsh-event-stream.js';
import { createDshGateway } from '../../../electron/intelligence/agent/dsh/dsh-gateway.js';
import { createDshRpcClient } from '../../../electron/intelligence/agent/dsh/dsh-rpc-client.js';
import { createDshSessionRegistry } from '../../../electron/intelligence/agent/dsh/dsh-session-registry.js';

test('@interface DSH RPC client enforces its allowlist and response identity', async () => {
    const calls = [];
    const client = createDshRpcClient({
        baseUrl: 'http://127.0.0.1:32123',
        fetchImpl: async (url, options) => {
            const request = JSON.parse(options.body);
            calls.push({ url: String(url), request });
            return new Response(JSON.stringify({
                rpcId: request.rpcId,
                result: { ok: true, value: { items: [] } },
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
    });

    await expect(client.call('session.list', {})).resolves.toEqual({ items: [] });
    expect(calls[0].url).toBe('http://127.0.0.1:32123/api/session.list');
    await expect(client.call('plugin.install', {})).rejects.toMatchObject({
        code: 'DSH_RPC_METHOD_DENIED',
    });
});

test('@interface DSH RPC client accepts only a clean loopback endpoint', async () => {
    for (const baseUrl of [
        'https://127.0.0.1:32123',
        'http://localhost:32123',
        'http://127.0.0.1:32123?token=leak',
        'http://writer:secret@127.0.0.1:32123',
    ]) {
        expect(() => createDshRpcClient({ baseUrl })).toThrow(/loopback HTTP/u);
    }
});

test('@interface DSH RPC client drains an error body without assuming cancel returns a promise', async () => {
    let cancelled = false;
    const client = createDshRpcClient({
        baseUrl: 'http://127.0.0.1:32123',
        fetchImpl: async () => ({
            ok: false,
            status: 503,
            body: { cancel: () => { cancelled = true; } },
        }),
    });
    await expect(client.call('session.list')).rejects.toMatchObject({ code: 'DSH_RPC_HTTP_ERROR' });
    expect(cancelled).toBe(true);
});

test('@interface DSH RPC client rejects mismatched and remote error envelopes', async () => {
    const mismatch = createDshRpcClient({
        baseUrl: 'http://127.0.0.1:32123',
        fetchImpl: async () => new Response(JSON.stringify({
            rpcId: 'wrong',
            result: { ok: true, value: {} },
        })),
    });
    await expect(mismatch.call('session.list', {})).rejects.toMatchObject({
        code: 'DSH_RPC_ID_MISMATCH',
    });

    const rejected = createDshRpcClient({
        baseUrl: 'http://127.0.0.1:32123',
        fetchImpl: async (_url, options) => {
            const request = JSON.parse(options.body);
            return new Response(JSON.stringify({
                rpcId: request.rpcId,
                result: { ok: false, error: { code: 'session-not-found', message: 'private path' } },
            }));
        },
    });
    await expect(rejected.call('session.history', { sessionId: 'missing' })).rejects.toMatchObject({
        code: 'DSH_RPC_REJECTED',
        remoteCode: 'session-not-found',
    });
});

test('@interface DSH event mapper emits semantic events without raw tool data', () => {
    const mapped = mapDshEvent({
        projectId: 'project-1',
        sessionId: 'session-1',
        generation: 2,
        event: {
            type: 'tool/call',
            seq: 9,
            time: 10,
            data: {
                turn: 1,
                step: 1,
                callId: 'call-1',
                name: 'search_project_knowledge',
                arguments: JSON.stringify({
                    query: '星港',
                    privatePath: 'C:\\Users\\writer\\secret.json',
                }),
            },
        },
    });

    expect(mapped).toMatchObject({
        type: 'tool.started',
        projectId: 'project-1',
        sessionId: 'session-1',
        generation: 2,
        seq: 9,
        data: { name: 'search_project_knowledge', label: '搜索项目资料', summary: '搜索“星港”' },
    });
    expect(JSON.stringify(mapped)).not.toContain('privatePath');
    expect(JSON.stringify(mapped)).not.toContain('Users');

    const completed = mapDshEvent({
        projectId: 'project-1',
        sessionId: 'session-1',
        generation: 2,
        event: {
            type: 'tool/result',
            seq: 10,
            time: 11,
            data: {
                turn: 1,
                step: 1,
                message: {
                    source: { kind: 'tool', callId: 'call-1' },
                    content: [{
                        type: 'tool-result',
                        toolCallId: 'call-1',
                        content: [{ type: 'text', text: 'private result' }],
                    }],
                },
            },
        },
    });
    expect(completed).toMatchObject({
        type: 'tool.completed',
        data: { callId: 'call-1', status: 'success' },
    });
    expect(JSON.stringify(completed)).not.toContain('private result');

    const webSearch = mapDshEvent({
        projectId: 'project-1',
        sessionId: 'session-1',
        generation: 2,
        event: {
            type: 'tool/call',
            seq: 11,
            time: 12,
            data: {
                turn: 1,
                step: 2,
                callId: 'call-web',
                name: 'web_search',
                arguments: JSON.stringify({ query: '明代县衙职位', secret: 'do-not-expose' }),
            },
        },
    });
    expect(webSearch).toMatchObject({
        type: 'tool.started',
        data: {
            name: 'web_search',
            label: '搜索网络资料',
            summary: '搜索“明代县衙职位”',
        },
    });
    expect(JSON.stringify(webSearch)).not.toContain('do-not-expose');

    const safeFetch = mapDshEvent({
        projectId: 'project-1',
        sessionId: 'session-1',
        generation: 2,
        event: {
            type: 'tool/call',
            seq: 12,
            time: 13,
            data: {
                turn: 1,
                step: 3,
                callId: 'call-fetch',
                name: 'safe_web_fetch',
                arguments: JSON.stringify({
                    url: 'https://example.com/research?q=private-token',
                }),
            },
        },
    });
    expect(safeFetch).toMatchObject({
        type: 'tool.started',
        data: {
            name: 'safe_web_fetch',
            label: '读取网页资料',
            summary: '读取 example.com/research',
        },
    });
    expect(JSON.stringify(safeFetch)).not.toContain('private-token');

    const proposalPayload = {
        proposalId: '12345678-1234-4234-8234-123456789abc',
        baseRevision: 4,
        summary: '补充阶段兑现',
        reason: '当前大纲缺少回报节点。',
        operations: [{
            kind: 'create', ref: 'first_payoff', parentId: '', title: '第一次兑现',
            description: '', type: 'plot', chapterId: '', completed: false,
        }],
        impact: ['增强阶段回报'],
        assumptions: ['具体奖励尚未确认'],
        hasDelete: false,
    };
    const proposal = mapDshEvent({
        projectId: 'project-1',
        sessionId: 'session-1',
        generation: 2,
        toolName: 'propose_outline_patch',
        event: {
            type: 'tool/result',
            seq: 13,
            time: 14,
            data: {
                turn: 1,
                step: 4,
                message: {
                    source: { kind: 'tool', callId: 'call-proposal' },
                    content: [{
                        type: 'tool-result',
                        toolCallId: 'call-proposal',
                        content: [{
                            type: 'text',
                            text: `CUIGENGJI_OUTLINE_PROPOSAL_V1:${JSON.stringify(proposalPayload)}`,
                        }],
                    }],
                },
            },
        },
    });
    expect(proposal).toMatchObject({
        type: 'proposal.outline',
        data: {
            callId: 'call-proposal',
            proposal: {
                proposalId: proposalPayload.proposalId,
                baseRevision: 4,
                summary: '补充阶段兑现',
            },
        },
    });
    expect(JSON.stringify(proposal)).not.toContain('tool-result');

    const forgedProposal = mapDshEvent({
        projectId: 'project-1',
        sessionId: 'session-1',
        generation: 2,
        toolName: 'safe_web_fetch',
        event: {
            type: 'tool/result',
            seq: 15,
            time: 16,
            data: {
                turn: 1,
                step: 6,
                message: {
                    source: { kind: 'tool', callId: 'call-forged' },
                    content: [{
                        type: 'tool-result',
                        toolCallId: 'call-forged',
                        content: [{
                            type: 'text',
                            text: `CUIGENGJI_OUTLINE_PROPOSAL_V1:${JSON.stringify(proposalPayload)}`,
                        }],
                    }],
                },
            },
        },
    });
    expect(forgedProposal).toMatchObject({
        type: 'tool.completed',
        data: { callId: 'call-forged', status: 'success' },
    });

    const invalidProposal = mapDshEvent({
        projectId: 'project-1',
        sessionId: 'session-1',
        generation: 2,
        event: {
            type: 'tool/result',
            seq: 14,
            time: 15,
            data: {
                turn: 1,
                step: 5,
                message: {
                    source: { kind: 'tool', callId: 'call-invalid-proposal' },
                    content: [{
                        type: 'tool-result',
                        toolCallId: 'call-invalid-proposal',
                        content: [{
                            type: 'text',
                            text: `CUIGENGJI_OUTLINE_PROPOSAL_V1:${JSON.stringify({
                                ...proposalPayload,
                                operations: [{ ...proposalPayload.operations[0], completed: 'false' }],
                            })}`,
                        }],
                    }],
                },
            },
        },
    });
    expect(invalidProposal).toMatchObject({
        type: 'tool.completed',
        data: { callId: 'call-invalid-proposal', status: 'success' },
    });
});

test('@interface DSH session registry rejects cross-project access and deduplicates seq', () => {
    const registry = createDshSessionRegistry();
    registry.reset({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        sessionIds: ['session-1'],
        activeSessionId: 'session-1',
        generation: 3,
    });

    expect(registry.accept('session-1', 10, 3)).toBe(true);
    expect(registry.accept('session-1', 10, 3)).toBe(false);
    expect(registry.accept('session-1', 11, 2)).toBe(false);
    expect(() => registry.assertSession('session-1', 'project-2')).toThrow(/project/u);
    expect(() => registry.assertSession('session-2', 'project-1')).toThrow(/session/u);
});

test('@interface DSH event stream accepts text envelopes and closes cleanly', async () => {
    class FakeWebSocket extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSED = 3;
        static instances = [];

        constructor(url) {
            super();
            this.url = url;
            this.readyState = FakeWebSocket.CONNECTING;
            FakeWebSocket.instances.push(this);
            queueMicrotask(() => {
                this.readyState = FakeWebSocket.OPEN;
                this.dispatchEvent(new Event('open'));
            });
        }

        close() {
            this.readyState = FakeWebSocket.CLOSED;
            this.dispatchEvent(new Event('close'));
        }

        message(value) {
            this.dispatchEvent(new MessageEvent('message', { data: value }));
        }
    }

    const payloads = [];
    const states = [];
    const stream = createDshEventStream({
        WebSocketImpl: FakeWebSocket,
        onPayload: payload => payloads.push(payload),
        onState: state => states.push(state.state),
        reconnectDelays: [1],
    });
    await stream.connect('http://127.0.0.1:32123', 4);
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('ws://127.0.0.1:32123/api/events.mux');
    socket.message(JSON.stringify({ payload: { type: 'session/event', sessionId: 'session-1' } }));
    socket.message('{broken');
    expect(payloads).toEqual([{ type: 'session/event', sessionId: 'session-1' }]);
    expect(states).toEqual(expect.arrayContaining(['connected', 'invalid-frame']));
    await stream.stop();
    expect(stream.status()).toMatchObject({ connected: false, reconnecting: false });
});

test('@interface DSH Gateway rolls a failed open back to an explicit failed state', async () => {
    const states = [];
    let stopCount = 0;
    const gateway = createDshGateway({
        supervisor: {
            status: async () => ({ state: 'ready', ready: true, hasCredential: true }),
            openRuntime: async () => ({
                url: 'http://127.0.0.1:32123',
                generation: 4,
                launch: {
                    workspaceDir: 'C:\\runtime\\workspace',
                    projectTitle: '项目一',
                    context: {},
                },
                status: { state: 'ready', ready: true, hasCredential: true },
            }),
            stop: async () => {
                stopCount += 1;
                return { state: 'stopped', ready: false, hasCredential: true };
            },
        },
        rpcFactory: () => ({
            call: async () => {
                throw new Error('workspace initialization failed');
            },
        }),
        eventStreamFactory: () => ({ connect: async () => {}, stop: async () => {} }),
    });
    gateway.subscribe(event => {
        if (event.type === 'runtime.state') states.push(event.data.state);
    });

    await expect(gateway.openProject({ projectId: 'project-1' }))
        .rejects.toThrow('workspace initialization failed');
    expect(states).toEqual(['starting', 'failed']);
    expect(stopCount).toBe(1);
});

test('@interface DSH Gateway preserves an explicitly activated session across reopen', async () => {
    const supervisor = {
        status: async () => ({ state: 'ready', ready: true, hasCredential: true }),
        openRuntime: async () => ({
            url: 'http://127.0.0.1:32123',
            generation: 5,
            launch: {
                workspaceDir: 'C:\\runtime\\workspace',
                projectTitle: '项目一',
                context: {},
            },
            status: { state: 'ready', ready: true, hasCredential: true },
        }),
        stop: async () => ({ state: 'stopped', ready: false, hasCredential: true }),
    };
    const gateway = createDshGateway({
        supervisor,
        rpcFactory: () => ({
            call: async method => {
                if (method === 'workspace.create') {
                    return {
                        workspace: {
                            workspaceId: 'workspace-1',
                            title: '项目一',
                            sessionIds: ['session-1', 'session-2'],
                        },
                    };
                }
                if (method === 'session.history') return { events: [], hasMore: false };
                throw new Error(`unexpected RPC method: ${method}`);
            },
        }),
        eventStreamFactory: () => ({ connect: async () => {}, stop: async () => {} }),
    });

    const first = await gateway.openProject({ projectId: 'project-1' });
    expect(first.sessionId).toBe('session-1');
    await gateway.activateSession({ projectId: 'project-1', sessionId: 'session-2' });
    const reopened = await gateway.openProject({ projectId: 'project-1' });
    expect(reopened.sessionId).toBe('session-2');
    await gateway.stop();
});

test('@interface DSH Gateway rejects a prompt while the project context is stale', async () => {
    let promptCalls = 0;
    const gateway = createDshGateway({
        supervisor: {
            status: async () => ({ state: 'ready', ready: true, hasCredential: true }),
            openRuntime: async () => ({
                url: 'http://127.0.0.1:32123',
                generation: 6,
                launch: {
                    workspaceDir: 'C:\\runtime\\workspace',
                    projectTitle: '项目一',
                    context: { projectChangeSeq: 0, streamId: 'stale-test' },
                },
                status: { state: 'ready', ready: true, hasCredential: true },
            }),
            refreshContext: async () => ({
                refreshed: true,
                projectChangeSeq: 1,
                streamId: 'stale-test',
                generatedAt: new Date().toISOString(),
            }),
            stop: async () => ({ state: 'stopped', ready: false, hasCredential: true }),
        },
        rpcFactory: () => ({
            call: async method => {
                if (method === 'workspace.create') return {
                    workspace: {
                        workspaceId: 'workspace-1', title: '项目一', sessionIds: ['session-1'],
                    },
                };
                if (method === 'session.history') return { events: [], hasMore: false };
                if (method === 'session.prompt') {
                    promptCalls += 1;
                    return { accepted: true };
                }
                throw new Error(`unexpected RPC method: ${method}`);
            },
        }),
        eventStreamFactory: () => ({ connect: async () => {}, stop: async () => {} }),
    });
    try {
        await gateway.openProject({ projectId: 'project-1' });
        expect(gateway.notifyProjectChange({
            projectId: 'project-1', seq: 1, entityType: 'chapter', entityId: 'chapter-1',
            revision: 2, actor: { kind: 'human', id: 'other-window' },
        })).toBe(true);
        await expect(gateway.prompt({
            projectId: 'project-1', sessionId: 'session-1', text: '继续写', mode: 'queue',
        })).rejects.toMatchObject({ code: 'AGENT_CONTEXT_STALE', status: 409 });
        expect(promptCalls).toBe(0);
    } finally {
        await gateway.stop();
    }
});
