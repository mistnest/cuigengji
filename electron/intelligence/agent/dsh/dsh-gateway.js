import { randomUUID } from 'node:crypto';

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
    coordinator = null,
}) {
    const listeners = new Set();
    let registry = createDshSessionRegistry();
    let rpc = null;
    let stream = null;
    // A supervisor generation is allowed to stay stable when the same
    // project is reopened.  Keep a gateway-local connection token as well so
    // late callbacks/reconnect recovery from the previous WebSocket cannot
    // be accepted by the freshly rebuilt session registry.
    let streamToken = 0;
    let lifecycle = Promise.resolve();
    let context = {
        chapterId: '',
        generatedAt: '',
        knowledgeEntries: 0,
        snapshotId: '',
        projectChangeSeq: 0,
        streamId: '',
        contextState: 'idle',
        lastChangeSeq: 0,
    };
    const toolNamesByCall = new Map();
    // A prompt is accepted before DSH emits turn/start. Keep a small FIFO per
    // session so the coordinator can compare the run's context snapshot with
    // project events that arrive while the model is thinking.
    const pendingRunsBySession = new Map();
    const activeRunsByTurn = new Map();
    const pendingProjectChanges = new Map();
    let shuttingDown = false;
    let contextRefreshTimer = null;

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
        const previousRpc = rpc;
        const previousStream = stream;
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

            const candidateStreamToken = streamToken + 1;
            nextStream = eventStreamFactory({
                onPayload: (payload, payloadGeneration) => {
                    if (!committed) {
                        bufferedPayloads.push([payload, payloadGeneration]);
                        return;
                    }
                    if (candidateStreamToken !== streamToken) return;
                    handlePayload(payload, payloadGeneration, candidateStreamToken);
                },
                onState: state => {
                    if (committed && candidateStreamToken === streamToken) {
                        handleStreamState(state, input.projectId, candidateStreamToken);
                    }
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
            clearTrackedRuns();
            rpc = nextRpc;
            registry = nextRegistry;
            stream = nextStream;
            streamToken = candidateStreamToken;
            toolNamesByCall.clear();
            const launchContext = handle.launch.context || {};
            context = {
                chapterId: '',
                generatedAt: '',
                knowledgeEntries: 0,
                snapshotId: '',
                projectChangeSeq: 0,
                streamId: '',
                contextState: 'synced',
                lastChangeSeq: 0,
                ...launchContext,
                contextState: 'synced',
                lastChangeSeq: Number(
                    launchContext.lastChangeSeq ?? launchContext.projectChangeSeq ?? 0,
                ),
            };
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
                handlePayload(payload, payloadGeneration, candidateStreamToken);
            }
            const pendingChange = pendingProjectChanges.get(input.projectId);
            if (pendingChange && Number(pendingChange.seq || 0) > Number(context.projectChangeSeq || 0)) {
                invalidateContext(pendingChange);
            } else if (pendingChange) {
                pendingProjectChanges.delete(input.projectId);
            }
            return {
                projectId: input.projectId,
                sessionId: activeSessionId,
                status: publicStatus(handle.status, handle.generation),
                context: { ...context },
            };
        } catch (error) {
            await nextStream?.stop().catch(() => {});
            // Opening the same project can fail while the existing runtime is
            // still healthy (for example, a transient history RPC failure).
            // Keep that committed runtime alive instead of turning a failed
            // refresh into an unnecessary global disconnect.  A project
            // switch/restart has a new generation and is cleaned up below.
            const preservePrevious = Boolean(
                !forceRestart
                && previous.projectId === input.projectId
                && previous.projectId
                && handle?.generation === previous.generation
                && rpc === previousRpc
                && stream === previousStream,
            );
            if (preservePrevious) {
                emit(runtimeStateEvent({
                    projectId: previous.projectId,
                    generation: previous.generation,
                    state: 'ready',
                    status: await supervisor.status().catch(() => undefined),
                }));
                throw error;
            }
            // Invalidate any in-flight reconnect recovery before tearing down
            // the committed stream.  A same-generation reopen can otherwise
            // let an old recovery promise write into the newly cleared
            // registry after this failure path completes.
            streamToken += 1;
            await stream?.stop().catch(() => {});
            stream = null;
            rpc = null;
            registry.clear();
            toolNamesByCall.clear();
            clearTrackedRuns();
            context = {
                chapterId: '', generatedAt: '', knowledgeEntries: 0,
                snapshotId: '', projectChangeSeq: 0, streamId: '', contextState: 'idle', lastChangeSeq: 0,
            };
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
        const before = registry.snapshot();
        const result = await call('session.list', {}, 'AGENT_SESSION_NOT_FOUND');
        const snapshot = assertSnapshotCurrent(before);
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
        assertSnapshotCurrent(snapshot);
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
        const before = registry.snapshot();
        const result = await call('session.history', payload, 'AGENT_SESSION_NOT_FOUND');
        const snapshot = assertSnapshotCurrent(before);
        const historyToolNames = new Map();
        const events = result.events
            .map(item => {
                const event = item.event;
                const callId = event?.data?.callId || event?.data?.message?.source?.callId
                    || event?.data?.message?.toolCallId;
                const key = callId ? `${input.sessionId}\u0000${callId}` : '';
                const toolName = event?.type === 'tool/result' ? historyToolNames.get(key) || '' : '';
                if (event?.type === 'tool/call' && callId && typeof event.data.name === 'string') {
                    historyToolNames.set(key, event.data.name);
                }
                return mapDshEvent({
                    projectId: snapshot.projectId,
                    sessionId: input.sessionId,
                    generation: snapshot.generation,
                    event,
                    toolName,
                });
            })
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
        const runtimeSnapshot = registry.snapshot();
        // A project change invalidates the prompt snapshot immediately. Do
        // not let direct API callers bypass the renderer's disabled composer
        // and start a run with stale world/chapter data.
        if (context.contextState === 'stale' || context.contextState === 'syncing'
            || context.contextState === 'error') {
            throw agentError('AGENT_CONTEXT_STALE', publicMessage('AGENT_CONTEXT_STALE'), true, 409);
        }
        const text = validatePrompt(input?.text);
        const mode = input?.mode === 'steer' ? 'steer' : input?.mode === 'queue' ? 'queue' : '';
        if (!mode) throw agentError('VALIDATION_ERROR', '发送模式无效。', false, 400);
        const run = beginRun({
            projectId: input.projectId,
            sessionId: input.sessionId,
            mode,
        });
        try {
            await call('session.prompt', {
                sessionId: input.sessionId,
                mode,
                content: [{ type: 'text', text }],
                clientTimeZone: cleanTimeZone(input.clientTimeZone),
            }, 'AGENT_PROMPT_REJECTED');
            assertSnapshotCurrent(runtimeSnapshot);
        } catch (error) {
            forgetRun(run.runId);
            throw error;
        }
        return { accepted: true, mode };
    }

    async function cancel(input = {}) {
        registry.assertSession(input?.sessionId, input?.projectId);
        const snapshot = registry.snapshot();
        await call('session.cancel', { sessionId: input.sessionId }, 'AGENT_CANCEL_REJECTED');
        assertSnapshotCurrent(snapshot);
        return { accepted: true };
    }

    async function refreshContext(input = {}) {
        registry.assertProject(input?.projectId);
        const before = registry.snapshot();
        const result = await supervisor.refreshContext(input);
        const current = registry.snapshot();
        // A refresh may finish after the user reopened another project.  Do
        // not let that late response overwrite the new runtime's baseline.
        if (current.projectId !== before.projectId || current.generation !== before.generation) {
            return { ...result, context: { ...context } };
        }
        if (result.refreshed) {
            const resultSeq = Number(result.projectChangeSeq ?? context.projectChangeSeq ?? 0);
            const pending = pendingProjectChanges.get(input.projectId);
            const latestSeq = Math.max(
                Number(context.lastChangeSeq || 0),
                Number(pending?.seq || 0),
                Number(coordinator?.getProjectState?.(input.projectId)?.lastSeq || 0),
            );
            context = {
                ...context,
                chapterId: input.chapterId || '',
                generatedAt: result.generatedAt || context.generatedAt,
                snapshotId: result.snapshotId || context.snapshotId,
                projectChangeSeq: resultSeq,
                streamId: result.streamId || context.streamId,
                lastChangeSeq: Math.max(Number(context.lastChangeSeq || 0), latestSeq),
                contextState: resultSeq >= latestSeq ? 'synced' : 'stale',
            };
            if (resultSeq >= latestSeq) {
                const pendingChange = pendingProjectChanges.get(input.projectId);
                if (!pendingChange || Number(pendingChange.seq || 0) <= resultSeq) {
                    pendingProjectChanges.delete(input.projectId);
                }
            }
            emit({
                schemaVersion: 1,
                type: 'context.synced',
                projectId: input.projectId,
                generation: registry.snapshot().generation,
                data: { ...context },
            });
            if (context.contextState === 'stale') scheduleContextRefresh(input.projectId, before.generation);
        }
        return { ...result, context: { ...context } };
    }

    function notifyProjectChange(event) {
        if (!event?.projectId) return false;
        rememberPendingProjectChange(event);
        const snapshot = registry.snapshot();
        if (event.projectId !== snapshot.projectId) return false;
        invalidateContext(event);
        return true;
    }

    function restart(input = {}) {
        return enqueue(() => openProjectUnlocked(input, true));
    }

    function stop() {
        return enqueue(async () => {
            shuttingDown = true;
            clearTimeout(contextRefreshTimer);
            contextRefreshTimer = null;
            const snapshot = registry.snapshot();
            await stream?.stop();
            streamToken += 1;
            stream = null;
            rpc = null;
            registry.clear();
            toolNamesByCall.clear();
            clearTrackedRuns();
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

    function handlePayload(payload, payloadGeneration, candidateStreamToken = streamToken) {
        if (candidateStreamToken !== streamToken) return;
        if (payload?.type !== 'session/event' || typeof payload.sessionId !== 'string') return;
        const event = payload.event;
        if (!registry.accept(payload.sessionId, event?.seq, payloadGeneration)) return;
        const snapshot = registry.snapshot();
        const callId = event?.data?.callId || event?.data?.message?.source?.callId
            || event?.data?.message?.toolCallId;
        const key = callId ? `${payload.sessionId}\u0000${callId}` : '';
        const toolName = event?.type === 'tool/result' ? toolNamesByCall.get(key) || '' : '';
        if (event?.type === 'tool/call' && callId && typeof event.data.name === 'string') {
            toolNamesByCall.set(key, event.data.name);
        }
        const mapped = mapDshEvent({
            projectId: snapshot.projectId,
            sessionId: payload.sessionId,
            generation: snapshot.generation,
            event,
            toolName,
        });
        if (mapped) emit(attachRunState(mapped, payload.sessionId));
    }

    function handleStreamState(streamState, projectId, candidateStreamToken = streamToken) {
        if (candidateStreamToken !== streamToken) return;
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
            void recoverMissedEvents(candidateStreamToken);
        }
    }

    async function recoverMissedEvents(candidateStreamToken = streamToken) {
        if (candidateStreamToken !== streamToken) return;
        const snapshot = registry.snapshot();
        for (const sessionId of snapshot.knownSessionIds) {
            let history;
            try {
                history = await call('session.history', { sessionId, maxMessages: 100 }, 'AGENT_SESSION_NOT_FOUND');
            } catch {
                continue;
            }
            if (!isSnapshotCurrent(snapshot, candidateStreamToken)) return;
            for (const item of history.events) handlePayload({
                type: 'session/event',
                sessionId,
                event: item.event,
            }, snapshot.generation, candidateStreamToken);
        }
        if (!isSnapshotCurrent(snapshot, candidateStreamToken)) return;
        const runtimeStatus = await supervisor.status();
        if (!isSnapshotCurrent(snapshot, candidateStreamToken)) return;
        emit(runtimeStateEvent({
            projectId: snapshot.projectId,
            generation: snapshot.generation,
            state: 'ready',
            status: runtimeStatus,
        }));
    }

    async function call(method, payload, publicCode) {
        return callWith(rpc, method, payload, publicCode);
    }

    function isSnapshotCurrent(snapshot, candidateStreamToken = streamToken) {
        const current = registry.snapshot();
        return candidateStreamToken === streamToken
            && Boolean(snapshot)
            && current.projectId === snapshot.projectId
            && current.generation === snapshot.generation;
    }

    function assertSnapshotCurrent(snapshot) {
        if (isSnapshotCurrent(snapshot)) return registry.snapshot();
        throw agentError(
            'AGENT_SESSION_PROJECT_MISMATCH',
            'Agent 操作已因项目切换失效，请重新打开当前项目。',
            false,
            409,
        );
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

    function beginRun({ projectId, sessionId, mode }) {
        const runId = randomUUID();
        // `projectChangeSeq` is the sequence actually represented by the
        // prompt context snapshot.  Do not promote it to `lastChangeSeq` (or
        // the coordinator's latest event) when the snapshot is stale: doing
        // so would make a run based on old project data report `stale: false`.
        const baseSeq = Number.isFinite(Number(context.projectChangeSeq))
            ? Number(context.projectChangeSeq)
            : 0;
        const record = {
            runId,
            projectId,
            sessionId,
            mode,
            baseSeq,
            snapshotId: context.snapshotId || '',
            turn: null,
            startedAt: Date.now(),
        };
        if (coordinator?.markRun) {
            coordinator.markRun(runId, {
                projectId,
                snapshotId: record.snapshotId,
                projectChangeSeq: baseSeq,
            });
        }
        const queue = pendingRunsBySession.get(sessionId) || [];
        queue.push(record);
        // A malformed/abandoned runtime must not retain unbounded prompt
        // metadata.  Normal operation removes records on terminal events.
        if (queue.length > 100) {
            const dropped = queue.splice(0, queue.length - 100);
            for (const item of dropped) coordinator?.finishRun?.(item.runId);
        }
        pendingRunsBySession.set(sessionId, queue);
        return record;
    }

    function forgetRun(runId) {
        const id = String(runId || '');
        if (!id) return;
        for (const [sessionId, queue] of pendingRunsBySession) {
            const remaining = queue.filter(item => item.runId !== id);
            if (remaining.length) pendingRunsBySession.set(sessionId, remaining);
            else pendingRunsBySession.delete(sessionId);
        }
        for (const [key, record] of activeRunsByTurn) {
            if (record.runId === id) activeRunsByTurn.delete(key);
        }
        coordinator?.finishRun?.(id);
    }

    function clearTrackedRuns() {
        const ids = new Set();
        for (const queue of pendingRunsBySession.values()) {
            for (const record of queue) ids.add(record.runId);
        }
        for (const record of activeRunsByTurn.values()) ids.add(record.runId);
        pendingRunsBySession.clear();
        activeRunsByTurn.clear();
        for (const runId of ids) coordinator?.finishRun?.(runId);
    }

    function attachRunState(mapped, sessionId) {
        const turn = mapped.data?.turn;
        let record = null;
        if (mapped.type === 'turn.started') {
            const queue = pendingRunsBySession.get(sessionId) || [];
            record = queue.shift() || null;
            if (queue.length) pendingRunsBySession.set(sessionId, queue);
            else pendingRunsBySession.delete(sessionId);
            if (record) {
                record.turn = turn ?? null;
                if (turn !== undefined && turn !== null) {
                    activeRunsByTurn.set(runKey(sessionId, turn), record);
                }
            }
        } else if (turn !== undefined && turn !== null) {
            record = activeRunsByTurn.get(runKey(sessionId, turn)) || null;
            if (!record && (mapped.type === 'turn.completed' || mapped.type === 'turn.failed')) {
                // Be tolerant of runtimes that omit turn/start in a reconnect
                // frame: associate the oldest outstanding prompt once.
                const queue = pendingRunsBySession.get(sessionId) || [];
                record = queue.shift() || null;
                if (queue.length) pendingRunsBySession.set(sessionId, queue);
                else pendingRunsBySession.delete(sessionId);
                if (record) {
                    record.turn = turn;
                    activeRunsByTurn.set(runKey(sessionId, turn), record);
                }
            }
        }

        if (!record) return mapped;
        const data = { ...mapped.data, runId: record.runId };
        if (mapped.type === 'turn.completed' || mapped.type === 'turn.failed') {
            const finished = coordinator?.finishRun?.(record.runId);
            data.stale = Boolean(finished?.stale);
            if (record.turn !== undefined && record.turn !== null) {
                activeRunsByTurn.delete(runKey(sessionId, record.turn));
            }
        }
        return { ...mapped, data };
    }

    function runKey(sessionId, turn) {
        return `${sessionId}\u0000${String(turn ?? '')}`;
    }

    function rememberPendingProjectChange(event) {
        const previous = pendingProjectChanges.get(event.projectId);
        const nextSeq = Number(event.seq || 0);
        const previousSeq = Number(previous?.seq || 0);
        if (!previous || nextSeq >= previousSeq) pendingProjectChanges.set(event.projectId, event);
    }

    function invalidateContext(event) {
        const snapshot = registry.snapshot();
        if (!snapshot.projectId || snapshot.projectId !== event.projectId) return;
        const eventSeq = Number(event.seq || 0);
        context = {
            ...context,
            contextState: 'stale',
            lastChangeSeq: Math.max(Number(context.lastChangeSeq || 0), eventSeq),
        };
        emit({
            schemaVersion: 1,
            type: 'context.invalidated',
            projectId: snapshot.projectId,
            generation: snapshot.generation,
            data: {
                entityType: event.entityType,
                entityId: event.entityId,
                revision: event.revision,
                seq: event.seq,
                actor: event.actor,
                contextState: 'stale',
            },
        });
        scheduleContextRefresh(event.projectId, snapshot.generation);
    }

    function scheduleContextRefresh(projectId, generation) {
        clearTimeout(contextRefreshTimer);
        contextRefreshTimer = setTimeout(() => {
            contextRefreshTimer = null;
            const current = registry.snapshot();
            if (current.projectId !== projectId || current.generation !== generation) return;
            void refreshContext({ projectId, chapterId: context.chapterId }).catch(() => {});
        }, 180);
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
        notifyProjectChange,
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
        AGENT_CONTEXT_STALE: '项目内容已变化，正在同步 Agent 上下文，请稍候。',
        AGENT_RUNTIME_UNREACHABLE: 'Agent Runtime 暂时无法连接，请重试。',
        AGENT_SESSION_NOT_FOUND: 'Agent 会话不存在或已经失效。',
        AGENT_PROMPT_REJECTED: '当前输入未被 Agent 接收，请重试。',
        AGENT_CANCEL_REJECTED: '暂时无法停止当前回复，请重试。',
    };
    return messages[code] || 'Agent 操作失败，请重试。';
}
