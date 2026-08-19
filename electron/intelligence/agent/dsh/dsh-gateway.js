import { AppError } from '../../../../src/backend/foundation/platform/index.js';
import {
    mapDshEvent,
    runtimeStateEvent,
    sessionReadyEvent,
} from './dsh-event-mapper.js';
import { createDshEventStream } from './dsh-event-stream.js';
import { createDshRpcClient, DshRpcError } from './dsh-rpc-client.js';
import { createDshSessionRegistry } from './dsh-session-registry.js';

const MAX_PROMPT_CODE_POINTS = 50_000;

export function createDshGateway({
    supervisor,
    rpcFactory = options => createDshRpcClient(options),
    eventStreamFactory = options => createDshEventStream(options),
}) {
    const listeners = new Set();
    let registry = createDshSessionRegistry();
    let rpc = null;
    let stream = null;
    let lifecycle = Promise.resolve();
    let context = { chapterId: '', generatedAt: '', knowledgeEntries: 0 };
    let shuttingDown = false;

    async function status() {
        const runtime = await supervisor.status();
        const snapshot = registry.snapshot();
        return publicStatus(runtime, snapshot.generation);
    }

    function openProject(input = {}) {
        return enqueue(() => openProjectUnlocked(input, false));
    }

    async function openProjectUnlocked(input, forceRestart) {
        validateProject(input?.projectId);
        shuttingDown = false;
        const previous = registry.snapshot();
        emit(runtimeStateEvent({
            projectId: input.projectId,
            generation: previous.generation,
            state: 'starting',
        }));

        let handle;
        let nextStream = null;
        let committed = false;
        const bufferedPayloads = [];
        try {
            handle = forceRestart
                ? await supervisor.restartRuntime(input)
                : await supervisor.openRuntime(input);
            const nextRpc = rpcFactory({ baseUrl: handle.url });
            let workspace = (await callWith(nextRpc, 'workspace.create', {
                path: handle.launch.workspaceDir,
            }, 'AGENT_RUNTIME_UNREACHABLE')).workspace;
            const title = cleanText(handle.launch.projectTitle, 200);
            if (title && workspace.title !== title) {
                workspace = (await callWith(nextRpc, 'workspace.rename', {
                    workspaceId: workspace.workspaceId,
                    title,
                }, 'AGENT_RUNTIME_UNREACHABLE')).workspace;
            }

            let sessionIds = [...workspace.sessionIds];
            if (sessionIds.length === 0) {
                const created = await callWith(nextRpc, 'session.create', {
                    workspaceId: workspace.workspaceId,
                    agentPreset: 'cuigenji',
                }, 'AGENT_SESSION_NOT_FOUND');
                sessionIds = [created.sessionId];
            }
            const activeSessionId = previous.projectId === input.projectId
                && sessionIds.includes(previous.activeSessionId)
                ? previous.activeSessionId
                : sessionIds[0];
            const nextRegistry = createDshSessionRegistry();
            nextRegistry.reset({
                projectId: input.projectId,
                workspaceId: workspace.workspaceId,
                sessionIds,
                activeSessionId,
                generation: handle.generation,
            });

            const tail = await callWith(nextRpc, 'session.history', {
                sessionId: activeSessionId,
                maxMessages: 30,
            }, 'AGENT_SESSION_NOT_FOUND');
            nextRegistry.remember(activeSessionId, tail.events);

            nextStream = eventStreamFactory({
                onPayload: (payload, payloadGeneration) => {
                    if (!committed) {
                        bufferedPayloads.push([payload, payloadGeneration]);
                        return;
                    }
                    handlePayload(payload, payloadGeneration);
                },
                onState: state => {
                    if (committed) handleStreamState(state, input.projectId);
                },
            });
            try {
                await nextStream.connect(handle.url, handle.generation);
            } catch {
                throw agentError(
                    'AGENT_STREAM_DISCONNECTED',
                    'Agent 实时事件连接失败，请重试。',
                    true,
                );
            }

            await stream?.stop();
            rpc = nextRpc;
            registry = nextRegistry;
            stream = nextStream;
            context = { ...handle.launch.context };
            committed = true;
            emit(runtimeStateEvent({
                projectId: input.projectId,
                generation: handle.generation,
                status: handle.status,
                state: 'ready',
            }));
            emit(sessionReadyEvent({
                projectId: input.projectId,
                sessionId: activeSessionId,
                generation: handle.generation,
                lastSeq: registry.snapshot().lastSeqBySession[activeSessionId] ?? -1,
            }));
            for (const [payload, payloadGeneration] of bufferedPayloads) {
                handlePayload(payload, payloadGeneration);
            }
            return {
                projectId: input.projectId,
                sessionId: activeSessionId,
                status: publicStatus(handle.status, handle.generation),
                context: { ...context },
            };
        } catch (error) {
            await nextStream?.stop().catch(() => {});
            await stream?.stop().catch(() => {});
            stream = null;
            rpc = null;
            registry.clear();
            context = { chapterId: '', generatedAt: '', knowledgeEntries: 0 };
            let status;
            try {
                status = await supervisor.stop();
            } catch {
                status = await supervisor.status().catch(() => undefined);
            }
            emit(runtimeStateEvent({
                projectId: input.projectId,
                generation: handle?.generation ?? previous.generation,
                status,
                state: 'failed',
            }));
            throw error;
        }
    }

    async function listSessions(input = {}) {
        registry.assertProject(input?.projectId);
        const result = await call('session.list', {}, 'AGENT_SESSION_NOT_FOUND');
        const snapshot = registry.snapshot();
        return result.items
            .filter(item => snapshot.knownSessionIds.includes(item.sessionId))
            .map(item => ({
                sessionId: item.sessionId,
                updatedAt: Number(item.updatedAt || 0),
                running: Boolean(item.running),
                blank: Boolean(item.blank),
                active: item.sessionId === snapshot.activeSessionId,
            }))
            .sort((left, right) => right.updatedAt - left.updatedAt);
    }

    async function createSession(input = {}) {
        registry.assertProject(input?.projectId);
        const snapshot = registry.snapshot();
        const created = await call('session.create', {
            workspaceId: snapshot.workspaceId,
            agentPreset: 'cuigenji',
        }, 'AGENT_SESSION_NOT_FOUND');
        registry.addSession(created.sessionId);
        registry.setActive(created.sessionId);
        emit(sessionReadyEvent({
            projectId: snapshot.projectId,
            sessionId: created.sessionId,
            generation: snapshot.generation,
        }));
        return {
            sessionId: created.sessionId,
            updatedAt: Date.now(),
            running: false,
            blank: true,
            active: true,
        };
    }

    async function activateSession(input = {}) {
        registry.assertSession(input?.sessionId, input?.projectId);
        registry.setActive(input.sessionId);
        return { sessionId: input.sessionId, active: true };
    }

    async function getHistory(input = {}) {
        registry.assertSession(input?.sessionId, input?.projectId);
        const payload = {
            sessionId: input.sessionId,
            maxMessages: boundedInteger(input.maxMessages, 1, 100, 30),
        };
        if (input.beforeSeq !== undefined) {
            payload.beforeSeq = boundedInteger(input.beforeSeq, 0, Number.MAX_SAFE_INTEGER, 0);
        }
        const result = await call('session.history', payload, 'AGENT_SESSION_NOT_FOUND');
        const snapshot = registry.snapshot();
        const events = result.events
            .map(item => mapDshEvent({
                projectId: snapshot.projectId,
                sessionId: input.sessionId,
                generation: snapshot.generation,
                event: item.event,
            }))
            .filter(Boolean);
        const seqs = events.map(event => event.seq).filter(Number.isInteger);
        return {
            sessionId: input.sessionId,
            events,
            hasMore: Boolean(result.hasMore),
            ...(seqs.length ? { oldestSeq: Math.min(...seqs), newestSeq: Math.max(...seqs) } : {}),
        };
    }

    async function prompt(input = {}) {
        if (shuttingDown) throw agentError('AGENT_PROMPT_REJECTED', 'Agent 正在关闭。', true);
        registry.assertSession(input?.sessionId, input?.projectId);
        const text = validatePrompt(input?.text);
        const mode = input?.mode === 'steer' ? 'steer' : input?.mode === 'queue' ? 'queue' : '';
        if (!mode) throw agentError('VALIDATION_ERROR', '发送模式无效。', false, 400);
        await call('session.prompt', {
            sessionId: input.sessionId,
            mode,
            content: [{ type: 'text', text }],
            clientTimeZone: cleanTimeZone(input.clientTimeZone),
        }, 'AGENT_PROMPT_REJECTED');
        return { accepted: true, mode };
    }

    async function cancel(input = {}) {
        registry.assertSession(input?.sessionId, input?.projectId);
        await call('session.cancel', { sessionId: input.sessionId }, 'AGENT_CANCEL_REJECTED');
        return { accepted: true };
    }

    async function refreshContext(input = {}) {
        registry.assertProject(input?.projectId);
        const result = await supervisor.refreshContext(input);
        if (result.refreshed) {
            context = {
                ...context,
                chapterId: input.chapterId || '',
                generatedAt: result.generatedAt || context.generatedAt,
            };
        }
        return { ...result, context: { ...context } };
    }

    function restart(input = {}) {
        return enqueue(() => openProjectUnlocked(input, true));
    }

    function stop() {
        return enqueue(async () => {
            shuttingDown = true;
            const snapshot = registry.snapshot();
            await stream?.stop();
            stream = null;
            rpc = null;
            registry.clear();
            const result = await supervisor.stop();
            emit(runtimeStateEvent({
                projectId: snapshot.projectId,
                generation: snapshot.generation,
                status: result,
                state: 'stopped',
            }));
            return publicStatus(result, snapshot.generation);
        });
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        listeners.add(listener);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            listeners.delete(listener);
        };
    }

    function handlePayload(payload, payloadGeneration) {
        if (payload?.type !== 'session/event' || typeof payload.sessionId !== 'string') return;
        const event = payload.event;
        if (!registry.accept(payload.sessionId, event?.seq, payloadGeneration)) return;
        const snapshot = registry.snapshot();
        const mapped = mapDshEvent({
            projectId: snapshot.projectId,
            sessionId: payload.sessionId,
            generation: snapshot.generation,
            event,
        });
        if (mapped) emit(mapped);
    }

    function handleStreamState(streamState, projectId) {
        const snapshot = registry.snapshot();
        if (streamState.generation !== snapshot.generation) return;
        if (streamState.state === 'reconnecting') {
            emit(runtimeStateEvent({
                projectId,
                generation: snapshot.generation,
                state: 'reconnecting',
            }));
        }
        if (streamState.state === 'connected' && streamState.reconnected) {
            void recoverMissedEvents();
        }
    }

    async function recoverMissedEvents() {
        const snapshot = registry.snapshot();
        for (const sessionId of snapshot.knownSessionIds) {
            let history;
            try {
                history = await call('session.history', { sessionId, maxMessages: 100 }, 'AGENT_SESSION_NOT_FOUND');
            } catch {
                continue;
            }
            for (const item of history.events) handlePayload({
                type: 'session/event',
                sessionId,
                event: item.event,
            }, snapshot.generation);
        }
        emit(runtimeStateEvent({
            projectId: snapshot.projectId,
            generation: snapshot.generation,
            state: 'ready',
            status: await supervisor.status(),
        }));
    }

    async function call(method, payload, publicCode) {
        return callWith(rpc, method, payload, publicCode);
    }

    async function callWith(client, method, payload, publicCode) {
        if (!client) throw agentError('AGENT_RUNTIME_UNREACHABLE', 'Agent 尚未启动。', true);
        try {
            return await client.call(method, payload);
        } catch (error) {
            if (error instanceof DshRpcError) {
                const code = error.remoteCode === 'session-not-found'
                    ? 'AGENT_SESSION_NOT_FOUND'
                    : publicCode;
                throw agentError(code, publicMessage(code), error.retryable || code !== 'VALIDATION_ERROR');
            }
            throw error;
        }
    }

    function emit(event) {
        for (const listener of listeners) {
            try {
                listener(event);
            } catch {
                // A diagnostic consumer cannot break the runtime event path.
            }
        }
    }

    function enqueue(operation) {
        const result = lifecycle.then(operation, operation);
        lifecycle = result.catch(() => {});
        return result;
    }

    return {
        status,
        openProject,
        listSessions,
        createSession,
        activateSession,
        getHistory,
        prompt,
        cancel,
        refreshContext,
        restart,
        stop,
        subscribe,
    };
}

function publicStatus(status, generation) {
    const state = status?.state || 'idle';
    return {
        kind: 'deepseek-harness',
        version: status?.version || '',
        state,
        ready: state === 'ready' && Boolean(status?.ready),
        hasCredential: Boolean(status?.hasCredential),
        retryable: state === 'failed',
        message: state === 'failed'
            ? 'Agent Runtime 已停止，请重试。'
            : state === 'starting'
                ? '正在启动 Agent…'
                : '',
        generation: Number(generation || 0),
    };
}

function validateProject(projectId) {
    if (typeof projectId !== 'string' || !projectId.trim() || projectId.includes('\0')) {
        throw agentError('VALIDATION_ERROR', '请先打开一个小说项目。', false, 400);
    }
}

function validatePrompt(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw agentError('VALIDATION_ERROR', '请输入要发送的内容。', false, 400);
    }
    const text = value.trim();
    if ([...text].length > MAX_PROMPT_CODE_POINTS) {
        throw agentError('VALIDATION_ERROR', '单次输入不能超过 50000 个字符。', false, 400);
    }
    return text;
}

function cleanText(value, limit) {
    return typeof value === 'string' ? [...value.trim()].slice(0, limit).join('') : '';
}

function cleanTimeZone(value) {
    const zone = cleanText(value, 100);
    return zone || 'Asia/Shanghai';
}

function boundedInteger(value, minimum, maximum, fallback) {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
        throw agentError('VALIDATION_ERROR', '分页参数无效。', false, 400);
    }
    return number;
}

function agentError(code, message, retryable, status = 503) {
    return new AppError(code, message, {
        status,
        retryable,
        publicMessage: message,
    });
}

function publicMessage(code) {
    const messages = {
        AGENT_RUNTIME_UNREACHABLE: 'Agent Runtime 暂时无法连接，请重试。',
        AGENT_SESSION_NOT_FOUND: 'Agent 会话不存在或已经失效。',
        AGENT_PROMPT_REJECTED: '当前输入未被 Agent 接收，请重试。',
        AGENT_CANCEL_REJECTED: '暂时无法停止当前回复，请重试。',
    };
    return messages[code] || 'Agent 操作失败，请重试。';
}
