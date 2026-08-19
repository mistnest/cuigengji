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
