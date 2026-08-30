import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { expect, test } from '@playwright/test';
import { Config as DshLlmConfig } from '@deepseek-ai/dsh-llm-pi-ai';

import {
    createDshSupervisor,
    supportsOfficialDeepseekSearch,
} from '../../../electron/intelligence/agent/dsh/dsh-supervisor.js';
import {
    DSH_GENERIC_API_KEY_ENV,
    resolveDshProviderConfig,
} from '../../../electron/intelligence/agent/dsh/dsh-provider-config.js';

test('@interface DSH web search only accepts the official DeepSeek endpoint shape', () => {
    expect(supportsOfficialDeepseekSearch({ provider: 'deepseek', endpoint: '' })).toBe(true);
    expect(supportsOfficialDeepseekSearch({
        provider: 'deepseek', endpoint: 'https://api.deepseek.com/v1',
    })).toBe(true);
    expect(supportsOfficialDeepseekSearch({
        provider: 'deepseek', endpoint: 'https://api.deepseek.com/',
    })).toBe(true);
    expect(supportsOfficialDeepseekSearch({
        provider: 'deepseek', endpoint: 'http://api.deepseek.com/v1',
    })).toBe(false);
    expect(supportsOfficialDeepseekSearch({
        provider: 'deepseek', endpoint: 'https://proxy.example.com/v1',
    })).toBe(false);
    expect(supportsOfficialDeepseekSearch({
        provider: 'openai', endpoint: 'https://api.deepseek.com/v1',
    })).toBe(false);
});

test('@interface DSH provider bridge keeps secrets out of provider config', () => {
    const deepseek = resolveDshProviderConfig({
        provider: 'deepseek',
        endpoint: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash',
    }, 'deepseek-secret');
    expect(deepseek).toMatchObject({
        sourceProvider: 'deepseek',
        providerRoute: 'deepseek-official',
        model: 'deepseek-v4-flash',
        hasCredential: true,
        piAiConfig: null,
        environment: {
            DEEPSEEK_API_KEY: 'deepseek-secret',
            DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
        },
    });

    const anthropic = resolveDshProviderConfig({
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
    }, 'anthropic-secret');
    expect(anthropic).toMatchObject({
        sourceProvider: 'anthropic',
        providerRoute: 'anthropic',
        hasCredential: true,
        piAiConfig: {
            providers: {
                anthropic: {
                    apiKeyEnv: DSH_GENERIC_API_KEY_ENV,
                    baseURL: 'https://api.anthropic.com',
                    models: [{ id: 'claude-sonnet-4-6' }],
                },
            },
        },
    });
    expect(anthropic.environment).toEqual({
        [DSH_GENERIC_API_KEY_ENV]: 'anthropic-secret',
    });
    expect(JSON.stringify(anthropic.piAiConfig)).not.toContain('anthropic-secret');
});

test('@interface DSH provider bridge supports compatible gateways and keyless Ollama', () => {
    const openai = resolveDshProviderConfig({
        provider: 'openai',
        endpoint: 'http://127.0.0.1:43123/v1',
        model: 'gpt-4o',
        maxContext: 200_000,
        maxTokens: 8_192,
    }, 'openai-secret');
    expect(openai).toMatchObject({
        providerRoute: 'cuigengji-openai',
        piAiConfig: {
            providers: {
                'cuigengji-openai': {
                    api: 'openai-completions',
                    apiKeyEnv: DSH_GENERIC_API_KEY_ENV,
                    baseURL: 'http://127.0.0.1:43123/v1',
                    models: [{ id: 'gpt-4o', contextWindow: 200_000, maxTokens: 8_192 }],
                },
            },
        },
    });

    const ollama = resolveDshProviderConfig({
        provider: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'qwen3:8b',
    });
    expect(ollama).toMatchObject({
        providerRoute: 'cuigengji-ollama',
        endpoint: 'http://localhost:11434/v1',
        hasCredential: true,
    });
    expect(ollama.piAiConfig.providers['cuigengji-ollama']).toMatchObject({
        apiKeyEnv: DSH_GENERIC_API_KEY_ENV,
    });
    expect(ollama.environment).toEqual({
        [DSH_GENERIC_API_KEY_ENV]: 'ollama-local',
    });
});

test('@interface DSH provider bridge honors existing regional provider selectors', () => {
    const siliconflow = resolveDshProviderConfig({
        provider: 'siliconflow',
        endpoint: 'https://api.siliconflow.com/v1',
        siliconflowEndpoint: 'cn',
        model: 'deepseek-ai/DeepSeek-V3',
    }, 'siliconflow-secret');
    expect(siliconflow.endpoint).toBe('https://api.siliconflow.cn/v1');
    expect(siliconflow.piAiConfig.providers['cuigengji-siliconflow'].baseURL)
        .toBe('https://api.siliconflow.cn/v1');

    const minimax = resolveDshProviderConfig({
        provider: 'minimax',
        endpoint: 'https://api.minimax.io/v1',
        minimaxEndpoint: 'cn',
        model: 'MiniMax-M2.7',
    }, 'minimax-secret');
    expect(minimax.endpoint).toBe('https://api.minimaxi.com/v1');

    const zai = resolveDshProviderConfig({
        provider: 'zai',
        endpoint: 'https://api.z.ai/api/paas/v4',
        zaiEndpoint: 'coding',
        model: 'glm-5-turbo',
    }, 'zai-secret');
    expect(zai.endpoint).toBe('https://api.z.ai/api/coding/paas/v4');

    const customEndpoint = resolveDshProviderConfig({
        provider: 'siliconflow',
        endpoint: 'https://proxy.example.com/v1',
        siliconflowEndpoint: 'cn',
        model: 'custom-model',
    }, 'proxy-secret');
    expect(customEndpoint.endpoint).toBe('https://proxy.example.com/v1');
});

test('@interface DSH provider bridge maps Google Vertex Express to the native pi-ai route', () => {
    const vertex = resolveDshProviderConfig({
        provider: 'google-vertex',
        model: 'gemini-2.5-flash',
        vertexAuthMode: 'express',
        vertexRegion: 'global',
        vertexProjectId: 'novel1622',
    }, 'google-vertex-secret');
    expect(vertex).toMatchObject({
        sourceProvider: 'google-vertex',
        providerRoute: 'google-vertex',
        model: 'gemini-2.5-flash',
        endpoint: 'https://aiplatform.googleapis.com/v1/projects/novel1622/locations/global',
        hasCredential: true,
        piAiConfig: {
            providers: {
                'google-vertex': {
                    apiKeyEnv: 'GOOGLE_CLOUD_API_KEY',
                    baseURL: 'https://aiplatform.googleapis.com/v1/projects/novel1622/locations/global',
                    models: [{ id: 'gemini-2.5-flash' }],
                },
            },
        },
        environment: {
            GOOGLE_CLOUD_API_KEY: 'google-vertex-secret',
            GOOGLE_CLOUD_PROJECT: 'novel1622',
            GOOGLE_CLOUD_LOCATION: 'global',
        },
    });
    expect(JSON.stringify(vertex.piAiConfig)).not.toContain('google-vertex-secret');
    expect(() => DshLlmConfig(vertex.piAiConfig)).not.toThrow();
});

test('@interface DSH provider bridge maps Google AI Studio API keys to the native pi-ai route', () => {
    const google = resolveDshProviderConfig({
        provider: 'google',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-2.5-flash',
    }, 'google-ai-studio-secret');
    expect(google).toMatchObject({
        sourceProvider: 'google',
        providerRoute: 'google',
        model: 'gemini-2.5-flash',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        hasCredential: true,
        piAiConfig: {
            providers: {
                google: {
                    apiKeyEnv: DSH_GENERIC_API_KEY_ENV,
                    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
                    models: [{ id: 'gemini-2.5-flash' }],
                },
            },
        },
        environment: {
            [DSH_GENERIC_API_KEY_ENV]: 'google-ai-studio-secret',
        },
    });
    expect(JSON.stringify(google.piAiConfig)).not.toContain('google-ai-studio-secret');
    expect(() => DshLlmConfig(google.piAiConfig)).not.toThrow();
});

test('@interface DSH provider bridge rejects unsafe or unsupported selections', () => {
    expect(() => resolveDshProviderConfig({
        provider: 'custom', model: 'custom-model', endpoint: 'http://models.example.com/v1',
    }, 'secret')).toThrow(/HTTPS/u);
    expect(() => resolveDshProviderConfig({
        provider: 'ollama', model: 'qwen3:8b', endpoint: 'http://models.example.com',
    })).toThrow(/HTTPS/u);
    expect(() => resolveDshProviderConfig({
        provider: 'custom', model: 'custom-model', endpoint: '',
    }, 'secret')).toThrow(/接口地址/u);
    expect(() => resolveDshProviderConfig({
        provider: 'google-vertex',
        model: 'gemini-2.5-flash',
        vertexAuthMode: 'full',
        vertexProjectId: 'novel1622',
    }, 'secret')).toThrow(/Service Account/u);
    expect(() => resolveDshProviderConfig({
        provider: 'google-vertex',
        model: 'gemini-2.5-flash',
        vertexAuthMode: 'express',
        vertexProjectId: 'invalid project',
    }, 'secret')).toThrow(/Project ID/u);
});

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
    await expect(harness.supervisor.status()).resolves.toMatchObject({
        state: 'stopped',
        ready: false,
        hasCredential: false,
    });
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

test('@interface DSH supervisor isolates runtime processes across projects', async () => {
    const harness = createHarness();
    await harness.supervisor.openRuntime({ projectId: 'project-1', chapterId: 'chapter-1' });
    await harness.supervisor.openRuntime({ projectId: 'project-2', chapterId: 'chapter-1' });

    expect(harness.children).toHaveLength(2);
    expect(harness.children[0].killedSignals).toContain('SIGTERM');
    expect(await harness.supervisor.status()).toMatchObject({
        state: 'ready',
        ready: true,
        hasCredential: true,
    });

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
