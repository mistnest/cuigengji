import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { expect, test } from '@playwright/test';

import { createDshSupervisor } from '../../../electron/intelligence/agent/dsh/dsh-supervisor.js';

function createFakeChild(port, exitDelayMs = 0) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.killedSignals = [];
    child.kill = (signal = 'SIGTERM') => {
        child.killedSignals.push(signal);
        if (child.exitCode !== null) return false;
        setTimeout(() => {
            if (child.exitCode !== null) return;
            child.exitCode = 0;
            child.emit('exit', 0, signal);
        }, exitDelayMs);
        return true;
    };
    queueMicrotask(() => child.stdout.write(`dsh web: http://127.0.0.1:${port}\n`));
    return child;
}

function createHarness(options = {}) {
    let signature = options.signature || 'signature-a';
    let nextPort = 41_000;
    let prepareCount = 0;
    let refreshCount = 0;
    const children = [];
    const supervisor = createDshSupervisor({
        electronApp: { getPath: () => 'C:\\fake-user-data' },
        spawnProcess: () => {
            const child = createFakeChild(nextPort, options.exitDelayMs);
            nextPort += 1;
            children.push(child);
            return child;
        },
        prepareLaunch: async () => {
            prepareCount += 1;
            await options.prepareGate?.();
            return {
                runtimeRoot: 'C:\\fake-runtime',
                workspaceDir: 'C:\\fake-workspace',
                patchFile: 'C:\\fake-overlay.yml',
                env: {},
                secret: 'fake-secret',
                hasCredential: true,
                configSignature: signature,
            };
        },
        waitForReady: async () => {},
        refreshContextSnapshot: async () => {
            refreshCount += 1;
            return { generatedAt: '2026-08-18T00:00:00.000Z' };
        },
    });
    return {
        supervisor,
        children,
        setSignature(value) {
            signature = value;
        },
        counts() {
            return { prepareCount, refreshCount };
        },
    };
}

test('@interface DSH supervisor coalesces identical concurrent opens', async () => {
    const harness = createHarness();
    const input = { projectId: 'project-1', chapterId: 'chapter-1' };

    const first = harness.supervisor.openRuntime(input);
    const second = harness.supervisor.openRuntime(input);

    expect(first).toBe(second);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({ status: { state: 'ready', ready: true } });
    expect(secondResult).toMatchObject({ status: { state: 'ready', ready: true } });
    expect(harness.children).toHaveLength(1);
    expect(harness.counts()).toEqual({
        prepareCount: 1,
        refreshCount: 0,
    });

    await harness.supervisor.stop();
});

test('@interface DSH supervisor serializes open and restart without overlapping children', async () => {
    const harness = createHarness({ exitDelayMs: 10 });
    const input = { projectId: 'project-1', chapterId: 'chapter-1' };

    const opening = harness.supervisor.openRuntime(input);
    const restarting = harness.supervisor.restartRuntime(input);
    await Promise.all([opening, restarting]);

    expect(harness.children).toHaveLength(2);
    expect(harness.children[0].killedSignals).toEqual(['SIGTERM']);
    expect(await harness.supervisor.status()).toMatchObject({ state: 'ready', ready: true });

    await harness.supervisor.stop();
});

test('@interface DSH supervisor replaces a ready runtime when configuration changes', async () => {
    const harness = createHarness();
    const input = { projectId: 'project-1', chapterId: 'chapter-1' };

    await harness.supervisor.openRuntime(input);
    harness.setSignature('signature-b');
    await harness.supervisor.openRuntime(input);
    harness.supervisor.invalidateCredentials();
    await harness.supervisor.openRuntime(input);

    expect(harness.children).toHaveLength(3);
    expect(harness.children.slice(0, 2).every(child => (
        child.killedSignals.includes('SIGTERM')
    ))).toBe(true);
    expect(await harness.supervisor.status()).toMatchObject({ state: 'ready', ready: true });

    await harness.supervisor.stop();
});

test('@interface DSH supervisor serializes context refresh and waits for process exit on stop', async () => {
    const harness = createHarness({ exitDelayMs: 30 });
    const input = { projectId: 'project-1', chapterId: 'chapter-1' };
    await harness.supervisor.openRuntime(input);

    const refreshed = await harness.supervisor.refreshContext(input);
    expect(refreshed).toMatchObject({
        refreshed: true,
        generatedAt: '2026-08-18T00:00:00.000Z',
    });

    const startedAt = Date.now();
    await harness.supervisor.stop();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(harness.children[0].exitCode).toBe(0);
    expect(await harness.supervisor.status()).toMatchObject({ state: 'stopped', ready: false });

    await harness.supervisor.stop();
    expect(harness.children[0].killedSignals).toEqual(['SIGTERM']);
    expect(harness.counts().refreshCount).toBe(1);
});
