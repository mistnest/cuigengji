import { getDomainEventBus } from '../../../foundation/platform/index.js';
import type { DomainChangeEvent } from '../../../../../shared/contracts/collaboration.js';

export interface AgentProjectState {
    projectId: string;
    lastSeq: number;
    invalidatedAt: number;
    lastEvent: DomainChangeEvent | null;
}

export interface AgentRunRecord {
    runId: string;
    projectId: string;
    baseSeq: number;
    snapshotId: string;
    startedAt: number;
}

export interface AgentCoordinator {
    markRun(runId: string, snapshot?: Record<string, any>): AgentRunRecord;
    isRunStale(runId: string): boolean;
    finishRun(runId: string): (AgentRunRecord & { stale: boolean }) | null;
    getProjectState(projectId: string): AgentProjectState;
    subscribe(listener: (event: DomainChangeEvent, state: AgentProjectState) => void): () => void;
    dispose(): void;
}

export function createAgentCoordinator(options: {
    eventBus?: ReturnType<typeof getDomainEventBus>;
    onProjectChange?: (event: DomainChangeEvent, state: AgentProjectState) => unknown;
} = {}): AgentCoordinator {
    const eventBus = options.eventBus || getDomainEventBus();
    const onProjectChange = options.onProjectChange || (async () => {});
    const projectStates = new Map<string, AgentProjectState>();
    const trackedRuns = new Map<string, AgentRunRecord>();
    const listeners = new Set<(event: DomainChangeEvent, state: AgentProjectState) => void>();
    let disposed = false;

    const unsubscribe = eventBus.subscribe(event => {
        if (disposed || !event?.projectId) return;
        const state = stateFor(event.projectId);
        state.lastSeq = Math.max(state.lastSeq, Number(event.seq) || 0);
        state.lastEvent = event;
        state.invalidatedAt = event.updatedAt || Date.now();
        for (const listener of listeners) {
            try { listener(event, publicState(state)); } catch { /* isolate observers */ }
        }
        Promise.resolve(onProjectChange(event, publicState(state))).catch(() => {});
    });

    function stateFor(projectId: string): AgentProjectState {
        const id = String(projectId || '');
        if (!projectStates.has(id)) {
            projectStates.set(id, { projectId: id, lastSeq: 0, invalidatedAt: 0, lastEvent: null });
        }
        return projectStates.get(id)!;
    }

    function markRun(runId: string, snapshot: Record<string, any> = {}): AgentRunRecord {
        const id = String(runId || '').trim();
        if (!id) throw new TypeError('runId is required');
        const projectId = String(snapshot.projectId || '');
        const baseSeq = Number(
            snapshot.collaboration?.projectChangeSeq
            ?? snapshot.projectChangeSeq
            ?? snapshot.changeSeq
            ?? 0,
        );
        const record: AgentRunRecord = {
            runId: id,
            projectId,
            baseSeq: Number.isFinite(baseSeq) ? baseSeq : 0,
            snapshotId: String(snapshot.snapshotId || ''),
            startedAt: Date.now(),
        };
        trackedRuns.set(id, record);
        return { ...record };
    }

    function isRunStale(runId: string): boolean {
        const record = trackedRuns.get(String(runId || ''));
        if (!record) return true;
        return stateFor(record.projectId).lastSeq > record.baseSeq;
    }

    function finishRun(runId: string): (AgentRunRecord & { stale: boolean }) | null {
        const id = String(runId || '');
        const record = trackedRuns.get(id);
        if (!record) return null;
        const stale = stateFor(record.projectId).lastSeq > record.baseSeq;
        trackedRuns.delete(id);
        return { ...record, stale };
    }

    function getProjectState(projectId: string): AgentProjectState {
        return publicState(stateFor(projectId));
    }

    function subscribe(listener: (event: DomainChangeEvent, state: AgentProjectState) => void): () => void {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function dispose(): void {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        listeners.clear();
        projectStates.clear();
        trackedRuns.clear();
    }

    return Object.freeze({ markRun, isRunStale, finishRun, getProjectState, subscribe, dispose });
}

function publicState(state: AgentProjectState): AgentProjectState {
    return { ...state };
}
