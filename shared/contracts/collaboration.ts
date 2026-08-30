/** Shared, transport-safe collaboration contracts.
 *
 * These interfaces are intentionally independent from Electron, DSH, and the
 * persistence implementation.  They are the stable vocabulary used by the
 * main process, preload facades, Renderer, and Agent context snapshots.
 */

export type ActorKind = 'human' | 'agent' | 'system';

export interface Actor {
    kind: ActorKind;
    id?: string;
    runId?: string;
}

export interface VersionStamp {
    schemaVersion: number;
    revision: number;
    updatedAt: number;
    contentHash: string;
}

export interface ConflictDetails {
    resource: string;
    expectedRevision: number;
    currentRevision: number;
    currentVersion: VersionStamp;
    expectedContentHash?: string;
    currentContentHash?: string;
    conflictOn?: 'revision' | 'contentHash';
}

export type DomainEntityType =
    | 'project'
    | 'workspace'
    | 'chapter'
    | 'volume'
    | 'outline'
    | 'worldbook'
    | 'character';

export type DomainOperation = 'created' | 'updated' | 'deleted';

export interface DomainChangeEvent {
    schemaVersion: 1;
    type: 'project.changed';
    eventId: string;
    streamId: string;
    projectId: string;
    seq: number;
    entityType: DomainEntityType | string;
    entityId: string;
    operation: DomainOperation;
    beforeRevision: number;
    revision: number;
    updatedAt: number;
    contentHash: string;
    changedFields: string[];
    actor: Actor;
}

export interface DomainChangeReplay {
    streamId: string;
    resetRequired: boolean;
    lastSeq: number;
    oldestSeq?: number;
    events: DomainChangeEvent[];
}

export interface SourceVersion extends VersionStamp {
    kind: string;
    id: string;
}

export interface CollaborationSnapshot {
    streamId: string;
    projectChangeSeq: number;
    sources: SourceVersion[];
}

export interface AgentRunSnapshot {
    runId: string;
    projectId: string;
    baseSeq: number;
    snapshotId: string;
    startedAt: number;
}
