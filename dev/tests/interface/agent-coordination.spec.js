import { expect, test } from '@playwright/test';

import { createDshGateway } from '../../../electron/intelligence/agent/dsh/dsh-gateway.js';
import { createAgentCoordinator } from '../../../src/backend/intelligence/agent/coordination/agent-coordinator.js';
import { createDomainEventBus } from '../../../src/backend/foundation/platform/events/domain-event-bus.js';

function sessionEvent(seq, type, data = {}) {
    return {
        type: 'session/event',
        sessionId: 'session-1',
        event: { seq, time: seq, type, data },
    };
}

function createHarness() {
    const eventBus = createDomainEventBus({ streamId: 'test-stream' });
    let streamOptions;
    let refreshCount = 0;
    const supervisor = {
        status: async () => ({ state: 'ready', ready: true, hasCredential: true }),
        openRuntime: async () => ({
            url: 'http://127.0.0.1:32123',
            generation: 1,
            launch: {
                workspaceDir: 'C:\\runtime\\workspace',
                projectTitle: '项目一',
                context: {
                    snapshotId: 'snapshot-1',
                    projectChangeSeq: 0,
                    streamId: 'test-stream',
                },
            },
            status: { state: 'ready', ready: true, hasCredential: true },
        }),
        refreshContext: async () => ({
            refreshed: true,
            generatedAt: new Date().toISOString(),
            snapshotId: 'snapshot-2',
            projectChangeSeq: eventBus.snapshot('project-1').lastSeq,
            streamId: 'test-stream',
            knowledgeEntries: 0,
            refreshCount: ++refreshCount,
        }),
        stop: async () => ({ state: 'stopped', ready: false, hasCredential: true }),
    };
    const coordinator = createAgentCoordinator({
        eventBus,
        onProjectChange: event => gateway.notifyProjectChange(event),
    });
    const gateway = createDshGateway({
        supervisor,
        coordinator,
        rpcFactory: () => ({
            call: async method => {
                if (method === 'workspace.create') {
                    return {
                        workspace: {
                            workspaceId: 'workspace-1',
                            title: '项目一',
                            sessionIds: ['session-1'],
                        },
                    };
                }
                if (method === 'session.history') return { events: [], hasMore: false };
                if (method === 'session.prompt') return { accepted: true };
                throw new Error(`unexpected RPC method: ${method}`);
            },
        }),
        eventStreamFactory: options => {
            streamOptions = options;
            return { connect: async () => {}, stop: async () => {} };
        },
    });
    return {
        eventBus,
        coordinator,
        gateway,
        getStreamOptions: () => streamOptions,
        getRefreshCount: () => refreshCount,
    };
}

test('@interface Agent Coordinator marks a DSH run stale after a project change', async () => {
    const harness = createHarness();
    const events = [];
    const unsubscribe = harness.gateway.subscribe(event => events.push(event));
    try {
        await harness.gateway.openProject({ projectId: 'project-1' });
        await harness.gateway.prompt({
            projectId: 'project-1', sessionId: 'session-1', text: '继续写', mode: 'queue',
        });
        const stream = harness.getStreamOptions();
        stream.onPayload(sessionEvent(1, 'turn/start', { turn: 1 }), 1);

        harness.eventBus.publishChange({
            projectId: 'project-1',
            entityType: 'chapter', entityId: 'chapter-1',
            operation: 'updated', revision: 2,
            actor: { kind: 'human', id: 'other-window' },
        });
        stream.onPayload(sessionEvent(2, 'turn/end', {
            turn: 1, reason: { kind: 'completed' },
        }), 1);

        const completed = events.find(event => event.type === 'turn.completed');
        expect(completed).toMatchObject({
            projectId: 'project-1',
            data: { turn: 1, stale: true },
        });
        expect(completed.data.runId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(harness.coordinator.getProjectState('project-1').lastSeq).toBe(1);
    } finally {
        unsubscribe();
        await harness.gateway.stop();
        harness.coordinator.dispose();
    }
});

test('@interface Agent Coordinator retains changes that arrive before DSH opens', async () => {
    const harness = createHarness();
    const events = [];
    const unsubscribe = harness.gateway.subscribe(event => events.push(event));
    try {
        harness.eventBus.publishChange({
            projectId: 'project-1', entityType: 'outline', entityId: 'project-1',
            operation: 'updated', revision: 1, actor: { kind: 'human', id: 'other-window' },
        });
        await harness.gateway.openProject({ projectId: 'project-1' });
        await new Promise(resolve => setTimeout(resolve, 240));
        expect(events.some(event => event.type === 'context.invalidated')).toBe(true);
        expect(events.some(event => event.type === 'context.synced')).toBe(true);
        expect(harness.getRefreshCount()).toBeGreaterThanOrEqual(1);
    } finally {
        unsubscribe();
        await harness.gateway.stop();
        harness.coordinator.dispose();
    }
});
