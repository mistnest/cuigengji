import { getDomainEventBus } from '../../../foundation/platform/index.js';
export function createAgentCoordinator(options = {}) {
    const eventBus = options.eventBus || getDomainEventBus();
    const onProjectChange = options.onProjectChange || (async () => { });
    const projectStates = new Map();
    const trackedRuns = new Map();
    const listeners = new Set();
    let disposed = false;
    const unsubscribe = eventBus.subscribe(event => {
        if (disposed || !event?.projectId)
            return;
        const state = stateFor(event.projectId);
        state.lastSeq = Math.max(state.lastSeq, Number(event.seq) || 0);
        state.lastEvent = event;
        state.invalidatedAt = event.updatedAt || Date.now();
        for (const listener of listeners) {
            try {
                listener(event, publicState(state));
            }
            catch { /* isolate observers */ }
        }
        Promise.resolve(onProjectChange(event, publicState(state))).catch(() => { });
    });
    function stateFor(projectId) {
        const id = String(projectId || '');
        if (!projectStates.has(id)) {
            projectStates.set(id, { projectId: id, lastSeq: 0, invalidatedAt: 0, lastEvent: null });
        }
        return projectStates.get(id);
    }
    function markRun(runId, snapshot = {}) {
        const id = String(runId || '').trim();
        if (!id)
            throw new TypeError('runId is required');
        const projectId = String(snapshot.projectId || '');
        const baseSeq = Number(snapshot.collaboration?.projectChangeSeq
            ?? snapshot.projectChangeSeq
            ?? snapshot.changeSeq
            ?? 0);
        const record = {
            runId: id,
            projectId,
            baseSeq: Number.isFinite(baseSeq) ? baseSeq : 0,
            snapshotId: String(snapshot.snapshotId || ''),
            startedAt: Date.now(),
        };
        trackedRuns.set(id, record);
        return { ...record };
    }
    function isRunStale(runId) {
        const record = trackedRuns.get(String(runId || ''));
        if (!record)
            return true;
        return stateFor(record.projectId).lastSeq > record.baseSeq;
    }
    function finishRun(runId) {
        const id = String(runId || '');
        const record = trackedRuns.get(id);
        if (!record)
            return null;
        const stale = stateFor(record.projectId).lastSeq > record.baseSeq;
        trackedRuns.delete(id);
        return { ...record, stale };
    }
    function getProjectState(projectId) {
        return publicState(stateFor(projectId));
    }
    function subscribe(listener) {
        if (typeof listener !== 'function')
            throw new TypeError('listener must be a function');
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        unsubscribe();
        listeners.clear();
        projectStates.clear();
        trackedRuns.clear();
    }
    return Object.freeze({ markRun, isRunStale, finishRun, getProjectState, subscribe, dispose });
}
function publicState(state) {
    return { ...state };
}
