(function (root) {
    'use strict';

    function createAgentStore() {
        const listeners = new Set();
        const histories = new Map();
        const proposalStates = new Map();
        const cancellationReceipts = new Map();
        let state = initialState();

        function initialState() {
            return {
                runtime: { state: 'idle', ready: false, hasCredential: false, message: '', generation: 0 },
                project: {
                    projectId: '', chapterId: '', contextState: 'idle', generatedAt: '', knowledgeEntries: 0,
                    projectChangeSeq: 0, lastChangeSeq: 0, lastChangedEntity: null,
                    streamId: '', snapshotId: '',
                },
                sessions: [],
                activeSessionId: '',
                items: [],
                running: false,
                pendingPrompts: [],
                composer: { text: '', mode: 'queue', submitting: false, error: '' },
            };
        }

        function getState() { return state; }
        function subscribe(listener) {
            if (typeof listener !== 'function') throw new TypeError('listener must be a function');
            listeners.add(listener);
            listener(state);
            return () => listeners.delete(listener);
        }
        function notify() { for (const listener of listeners) listener(state); }

        function setProject(project) {
            const projectChanged = Boolean(
                state.project.projectId && state.project.projectId !== project.projectId,
            );
            const sessionChanged = state.activeSessionId
                && state.activeSessionId !== project.sessionId;
            const previousGeneration = Number(state.runtime.generation || 0);
            const nextGeneration = Number(project.status?.generation ?? previousGeneration);
            // A supervisor restart can keep the same project and DSH session
            // while replacing the runtime process.  History events are keyed
            // by generation, so retaining the old map would render every
            // message twice after the restart.
            const runtimeChanged = Boolean(
                state.project.projectId
                && Number.isFinite(nextGeneration)
                && nextGeneration !== previousGeneration,
            );
            if (projectChanged || runtimeChanged) {
                histories.clear();
                proposalStates.clear();
                cancellationReceipts.clear();
            }
            state = {
                ...state,
                runtime: { ...state.runtime, ...project.status },
                project: {
                    projectId: project.projectId,
                    chapterId: project.context?.chapterId || '',
                    contextState: project.context?.contextState || 'synced',
                    generatedAt: project.context?.generatedAt || '',
                    knowledgeEntries: Number(project.context?.knowledgeEntries || 0),
                    projectChangeSeq: Number(project.context?.projectChangeSeq || 0),
                    lastChangeSeq: Number(project.context?.lastChangeSeq || 0),
                    lastChangedEntity: project.context?.lastChangedEntity || null,
                    streamId: project.context?.streamId || '',
                    snapshotId: project.context?.snapshotId || '',
                },
                activeSessionId: project.sessionId,
                // A runtime open/restart is a session boundary.  Never carry
                // optimistic prompts or rendered items into another project
                // (or attach them to a newly selected session): doing so can
                // make a late prompt response look like a successful write in
                // the wrong workspace.
                ...(projectChanged || sessionChanged || runtimeChanged ? {
                    items: [],
                    running: false,
                    pendingPrompts: [],
                    composer: { ...state.composer, text: '', submitting: false, error: '' },
                } : {}),
            };
            ensureHistory(project.sessionId);
            reproject();
        }

        function setSessions(sessions) {
            state = { ...state, sessions: Array.isArray(sessions) ? sessions : [] };
            notify();
        }
        function setActiveSession(sessionId) {
            state = { ...state, activeSessionId: sessionId };
            ensureHistory(sessionId);
            reproject();
        }
        function applyHistory(sessionId, events) {
            const history = ensureHistory(sessionId);
            for (const event of events || []) remember(history, event);
            reproject();
        }
        function applyEvent(event) {
            if (!event || event.schemaVersion !== 1) return;
            if (event.type === 'runtime.state') {
                if (event.generation < state.runtime.generation) return;
                state = {
                    ...state,
                    runtime: { ...state.runtime, ...event.data, generation: event.generation },
                };
                notify();
                return;
            }
            if (event.type === 'context.invalidated') {
                setProjectChange({
                    projectId: event.projectId,
                    seq: event.data?.seq,
                    entityType: event.data?.entityType,
                    entityId: event.data?.entityId,
                    revision: event.data?.revision,
                    actor: event.data?.actor,
                });
                return;
            }
            if (event.type === 'context.synced') {
                if (!state.project.projectId || event.projectId === state.project.projectId) {
                    setContextState('synced', {
                        generatedAt: event.data?.generatedAt || state.project.generatedAt,
                        projectChangeSeq: Number(
                            event.data?.projectChangeSeq ?? state.project.projectChangeSeq,
                        ),
                        lastChangeSeq: Number(
                            event.data?.lastChangeSeq ?? state.project.lastChangeSeq,
                        ),
                        snapshotId: event.data?.snapshotId || state.project.snapshotId || '',
                        streamId: event.data?.streamId || state.project.streamId || '',
                        knowledgeEntries: Number(
                            event.data?.knowledgeEntries ?? state.project.knowledgeEntries,
                        ),
                    });
                }
                return;
            }
            if (state.project.projectId && event.projectId !== state.project.projectId) return;
            if (event.generation !== state.runtime.generation) return;
            if (event.type === 'session.ready') {
                ensureHistory(event.sessionId);
                if (!state.activeSessionId) state = { ...state, activeSessionId: event.sessionId };
                notify();
                return;
            }
            if (!event.sessionId || !Number.isInteger(event.seq)) return;
            const history = ensureHistory(event.sessionId);
            if (!remember(history, event)) return;
            reconcilePending(event);
            if (event.sessionId === state.activeSessionId) reproject();
        }

        function addOptimistic(text, mode) {
            const entry = {
                id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                text, mode, status: 'sending',
            };
            state = {
                ...state,
                pendingPrompts: [...state.pendingPrompts, entry],
                composer: { ...state.composer, text: '', error: '', submitting: true },
            };
            reproject();
            return entry.id;
        }
        function acceptOptimistic(id) {
            state = {
                ...state,
                pendingPrompts: state.pendingPrompts.map(item => (
                    item.id === id ? { ...item, status: 'accepted' } : item
                )),
                composer: { ...state.composer, submitting: false },
            };
            reproject();
        }
        function rejectOptimistic(id, message) {
            state = {
                ...state,
                pendingPrompts: state.pendingPrompts.map(item => (
                    item.id === id ? { ...item, status: 'error', message } : item
                )),
                composer: { ...state.composer, submitting: false, error: message },
            };
            reproject();
        }
        function restorePending(id) {
            const target = state.pendingPrompts.find(item => item.id === id);
            if (!target) return;
            state = {
                ...state,
                pendingPrompts: state.pendingPrompts.filter(item => item.id !== id),
                composer: { ...state.composer, text: target.text, error: '' },
            };
            reproject();
        }
        function setComposer(patch) {
            state = { ...state, composer: { ...state.composer, ...patch } };
            notify();
        }
        function setContextState(contextState, patch = {}) {
            state = { ...state, project: { ...state.project, contextState, ...patch } };
            notify();
        }
        function setProjectChange(event) {
            if (!event?.projectId || (state.project.projectId && event.projectId !== state.project.projectId)) return;
            const seq = Number(event.seq || 0);
            const sameStream = !event.streamId || !state.project.streamId
                || event.streamId === state.project.streamId;
            if (sameStream && Number.isFinite(seq) && seq > 0
                && seq <= Math.max(
                    Number(state.project.projectChangeSeq || 0),
                    Number(state.project.lastChangeSeq || 0),
                )) return;
            state = {
                ...state,
                project: {
                    ...state.project,
                    contextState: 'stale',
                    lastChangeSeq: Math.max(
                        Number(state.project.lastChangeSeq || 0),
                        seq,
                    ),
                    lastChangedEntity: {
                        entityType: event.entityType || '',
                        entityId: event.entityId || '',
                        revision: Number(event.revision || 0),
                        actor: event.actor || { kind: 'system' },
                    },
                },
            };
            notify();
        }
        function setProposalApplyState(proposalId, applyState, message = '') {
            if (!proposalId) return;
            proposalStates.set(proposalId, { applyState, message });
            reproject();
        }
        function markCancelled(sessionId = state.activeSessionId) {
            if (!sessionId) return;
            const history = ensureHistory(sessionId);
            const events = [...history.events.values()];
            const afterSeq = Math.max(-1, ...events.map(event => Number(event.seq) || 0));
            const activeTurn = events
                .filter(event => event.type === 'turn.started')
                .sort((left, right) => right.seq - left.seq)[0]?.data?.turn;
            cancellationReceipts.set(sessionId, {
                key: `cancelled-${state.runtime.generation}-${afterSeq}`,
                generation: state.runtime.generation,
                afterSeq,
                turn: activeTurn,
            });
            if (sessionId === state.activeSessionId) reproject();
        }
        function clear() {
            histories.clear();
            proposalStates.clear();
            cancellationReceipts.clear();
            state = initialState();
            notify();
        }
        function ensureHistory(sessionId) {
            if (!histories.has(sessionId)) histories.set(sessionId, { events: new Map() });
            return histories.get(sessionId);
        }
        function remember(history, event) {
            const key = `${event.generation}:${event.seq}`;
            if (history.events.has(key)) return false;
            history.events.set(key, event);
            return true;
        }
        function reconcilePending(event) {
            if (event.type !== 'message.user') return;
            const index = state.pendingPrompts.findIndex(item => item.text.trim() === event.data.text.trim());
            if (index < 0) return;
            state = {
                ...state,
                pendingPrompts: state.pendingPrompts.filter((_item, itemIndex) => itemIndex !== index),
            };
        }

        function reproject() {
            const history = histories.get(state.activeSessionId);
            const events = history
                ? [...history.events.values()].sort((left, right) => left.seq - right.seq)
                : [];
            const items = [];
            const assistants = new Map();
            const tools = new Map();
            let running = false;
            for (const event of events) {
                if (event.type === 'turn.started') running = true;
                if (event.type === 'message.user' && event.data.source === 'user') {
                    items.push({
                        key: `user-${event.seq}`, kind: 'user', text: event.data.text,
                        order: event.seq, status: 'complete',
                    });
                }
                if (event.type === 'assistant.delta' || event.type === 'assistant.completed') {
                    const key = `assistant-${event.data.turn}-${event.data.step}`;
                    let item = assistants.get(key);
                    if (!item && event.type === 'assistant.completed' && !event.data.text) continue;
                    if (!item) {
                        item = {
                            key, kind: 'assistant', text: '', reasoning: '',
                            order: event.seq, status: 'streaming',
                        };
                        assistants.set(key, item);
                        items.push(item);
                    }
                    if (event.type === 'assistant.delta') {
                        if (event.data.kind === 'reasoning') item.reasoning += event.data.text;
                        else item.text += event.data.text;
                    } else {
                        if (event.data.text) item.text = event.data.text;
                        item.status = 'complete';
                        item.usage = event.data.usage;
                    }
                }
                if (event.type === 'tool.started') {
                    const item = {
                        key: `tool-${event.data.callId || event.seq}`, kind: 'tool',
                        callId: event.data.callId, name: event.data.name,
                        label: event.data.label, summary: event.data.summary,
                        order: event.seq, status: 'running',
                    };
                    tools.set(event.data.callId, item);
                    items.push(item);
                }
                if (event.type === 'tool.completed') {
                    let item = tools.get(event.data.callId);
                    if (!item) {
                        item = {
                            key: `tool-${event.data.callId || event.seq}`, kind: 'tool',
                            callId: event.data.callId, label: 'Agent 工具', order: event.seq,
                        };
                        tools.set(event.data.callId, item);
                        items.push(item);
                    }
                    item.status = event.data.status;
                    if (event.data.summary) item.summary = event.data.summary;
                }
                if (event.type === 'proposal.outline') {
                    const tool = tools.get(event.data.callId);
                    if (tool) {
                        tool.status = 'success';
                        tool.summary = '大纲修改提案已整理';
                    }
                    const proposal = event.data.proposal;
                    const local = proposalStates.get(proposal.proposalId) || {};
                    items.push({
                        key: `proposal-${proposal.proposalId}`,
                        kind: 'proposal',
                        callId: event.data.callId,
                        proposal,
                        order: event.seq,
                        status: 'ready',
                        applyState: local.applyState || 'idle',
                        applyMessage: local.message || '',
                    });
                }
                if (event.type === 'turn.completed' || event.type === 'turn.failed') running = false;
                if (event.type === 'turn.failed') {
                    const key = `turn-error-${event.data.turn}`;
                    const existing = items.find(item => item.key === key);
                    if (existing) {
                        existing.text = event.data.message;
                        existing.reason = event.data.reason;
                    } else {
                        items.push({
                            key, kind: 'error', text: event.data.message,
                            reason: event.data.reason, order: event.seq,
                        });
                    }
                }
            }
            const cancellation = cancellationReceipts.get(state.activeSessionId);
            if (cancellation?.generation === state.runtime.generation) {
                const hasMappedAbort = events.some(event => (
                    event.type === 'turn.failed'
                    && event.data?.reason === 'aborted'
                    && (cancellation.turn === undefined || event.data?.turn === cancellation.turn)
                ));
                if (!hasMappedAbort) {
                    items.push({
                        key: cancellation.key,
                        kind: 'error',
                        text: '已停止生成。',
                        reason: 'aborted',
                        order: Number.MAX_SAFE_INTEGER - 1,
                    });
                }
                const newerTurnStarted = events.some(event => (
                    event.type === 'turn.started' && event.seq > cancellation.afterSeq
                ));
                if (!newerTurnStarted) running = false;
            }
            const pendingItems = state.pendingPrompts.map((item, index) => ({
                key: item.id, kind: 'user', text: item.text, status: item.status,
                error: item.message, pendingId: item.id,
                order: Number.MAX_SAFE_INTEGER - state.pendingPrompts.length + index,
            }));
            state = {
                ...state,
                items: [...items, ...pendingItems].sort((left, right) => left.order - right.order),
                running,
            };
            notify();
        }

        function debugSnapshot() {
            return JSON.parse(JSON.stringify({
                ...state,
                histories: [...histories].map(([sessionId, history]) => ({
                    sessionId,
                    seqs: [...history.events.values()].map(event => event.seq).sort((a, b) => a - b),
                })),
            }));
        }

        return {
            getState, subscribe, setProject, setSessions, setActiveSession,
            applyHistory, applyEvent, addOptimistic, acceptOptimistic, rejectOptimistic,
            restorePending, setComposer, setContextState, clear, debugSnapshot,
            setProposalApplyState,
            markCancelled,
            setProjectChange,
        };
    }

    root.AgentStoreModule = Object.freeze({ createAgentStore });
}(typeof window === 'undefined' ? globalThis : window));
