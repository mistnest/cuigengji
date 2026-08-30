import { randomUUID } from 'node:crypto';

import type {
    Actor,
    DomainChangeEvent,
    DomainChangeReplay,
    DomainEntityType,
    DomainOperation,
} from '../../../../../shared/contracts/collaboration.js';

const EVENT_SCHEMA_VERSION = 1 as const;
const DEFAULT_HISTORY_LIMIT = 512;
const ACTOR_KINDS = new Set(['human', 'agent', 'system']);

export interface DomainChangeInput {
    projectId: string;
    eventId?: string;
    entityType?: DomainEntityType | string;
    entityId?: string;
    operation?: DomainOperation | string;
    beforeRevision?: number;
    revision?: number;
    updatedAt?: number;
    contentHash?: string;
    changedFields?: string[];
    actor?: Partial<Actor>;
}

export interface DomainEventBus {
    readonly streamId: string;
    publishChange(input: DomainChangeInput): DomainChangeEvent;
    subscribe(listener: (event: DomainChangeEvent) => void, options?: { projectId?: string }): () => void;
    subscribeProject(projectId: string, listener: (event: DomainChangeEvent) => void): () => void;
    getSince(projectId: string, sinceSeq?: number, sinceStreamId?: string): DomainChangeReplay;
    snapshot(projectId: string): DomainChangeReplay;
    clear(): void;
}

export function createDomainEventBus(options: { historyLimit?: number; streamId?: string } = {}): DomainEventBus {
    const historyLimit = Number.isInteger(options.historyLimit) && (options.historyLimit || 0) > 0
        ? Number(options.historyLimit)
        : DEFAULT_HISTORY_LIMIT;
    const streamId = options.streamId || randomUUID();
    const sequences = new Map<string, number>();
    const history = new Map<string, DomainChangeEvent[]>();
    const listeners = new Set<{
        listener: (event: DomainChangeEvent) => void;
        projectId: string;
    }>();

    function publishChange(input: DomainChangeInput): DomainChangeEvent {
        const projectId = String(input.projectId || '').trim();
        if (!projectId) throw new TypeError('projectId is required for a domain change');
        const seq = (sequences.get(projectId) || 0) + 1;
        sequences.set(projectId, seq);
        const event: DomainChangeEvent = Object.freeze({
            schemaVersion: EVENT_SCHEMA_VERSION,
            type: 'project.changed',
            eventId: input.eventId || randomUUID(),
            streamId,
            projectId,
            seq,
            entityType: String(input.entityType || 'project'),
            entityId: String(input.entityId || projectId),
            operation: normalizeOperation(input.operation),
            beforeRevision: normalizeNumber(input.beforeRevision),
            revision: normalizeNumber(input.revision),
            updatedAt: normalizeNumber(input.updatedAt, Date.now()),
            contentHash: typeof input.contentHash === 'string' ? input.contentHash : '',
            changedFields: normalizeFields(input.changedFields),
            actor: normalizeActor(input.actor),
        });
        const items = history.get(projectId) || [];
        items.push(event);
        if (items.length > historyLimit) items.splice(0, items.length - historyLimit);
        history.set(projectId, items);
        for (const subscription of listeners) {
            if (subscription.projectId && subscription.projectId !== projectId) continue;
            try { subscription.listener(event); } catch { /* observers are isolated */ }
        }
        return event;
    }

    function subscribe(
        listener: (event: DomainChangeEvent) => void,
        options: { projectId?: string } = {},
    ): () => void {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        const subscription = { listener, projectId: options.projectId ? String(options.projectId) : '' };
        listeners.add(subscription);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            listeners.delete(subscription);
        };
    }

    function subscribeProject(projectId: string, listener: (event: DomainChangeEvent) => void): () => void {
        return subscribe(listener, { projectId });
    }

    function getSince(projectId: string, sinceSeq = 0, sinceStreamId = streamId): DomainChangeReplay {
        const id = String(projectId || '');
        const requested = Number(sinceSeq);
        const items = history.get(id) || [];
        const sameStream = sinceStreamId === streamId;
        const validRequest = Number.isFinite(requested) && requested >= 0;
        const oldestSeq = items.length ? items[0].seq : undefined;
        // A bounded in-memory log cannot replay a cursor that predates its
        // first retained event.  Tell the client to reload its aggregate
        // snapshot instead of silently presenting an incomplete history.
        const resetRequired = !sameStream
            || !validRequest
            || (items.length > 0 && requested < items[0].seq - 1)
            || (items.length === 0 && (sequences.get(id) || 0) > requested);
        const events = sameStream && validRequest && !resetRequired
            ? items.filter(event => event.seq > requested)
            : [];
        return {
            streamId,
            resetRequired,
            lastSeq: sequences.get(id) || 0,
            ...(oldestSeq === undefined ? {} : { oldestSeq }),
            events,
        };
    }

    function snapshot(projectId: string): DomainChangeReplay {
        return getSince(String(projectId || ''), 0, streamId);
    }

    function clear(): void {
        sequences.clear();
        history.clear();
    }

    return Object.freeze({ streamId, publishChange, subscribe, subscribeProject, getSince, snapshot, clear });
}

const defaultBus = createDomainEventBus();

export function getDomainEventBus(): DomainEventBus { return defaultBus; }
export function publishDomainChange(input: DomainChangeInput): DomainChangeEvent {
    return defaultBus.publishChange(input);
}
export function subscribeDomainChanges(
    listener: (event: DomainChangeEvent) => void,
    options?: { projectId?: string },
): () => void {
    return defaultBus.subscribe(listener, options);
}
export function getDomainChanges(projectId: string, sinceSeq?: number, sinceStreamId?: string): DomainChangeReplay {
    return defaultBus.getSince(projectId, sinceSeq, sinceStreamId);
}

function normalizeOperation(value: unknown): DomainOperation {
    const operation = String(value || 'updated');
    return (['created', 'updated', 'deleted'] as const).includes(operation as DomainOperation)
        ? operation as DomainOperation
        : 'updated';
}

function normalizeNumber(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeFields(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean).slice(0, 100))];
}

function normalizeActor(value: Partial<Actor> | undefined): Actor {
    const kind = ACTOR_KINDS.has(value?.kind || '') ? value?.kind as Actor['kind'] : 'system';
    const id = typeof value?.id === 'string' ? value.id.slice(0, 160) : '';
    const runId = typeof value?.runId === 'string' ? value.runId.slice(0, 160) : '';
    return Object.freeze({ kind, ...(id ? { id } : {}), ...(runId ? { runId } : {}) });
}
