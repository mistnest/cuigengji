import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import writeFileAtomic from 'write-file-atomic';
import { stringify as stringifyYaml } from 'yaml';

import { buildAgentProjectContextArtifacts } from '../../../../src/backend/intelligence/agent/index.js';
import { readAiSecret } from '../../../../src/backend/foundation/configuration/index.js';
import { loadWorkspace } from '../../../../src/backend/domains/project/index.js';
import { AppError } from '../../../../src/backend/foundation/platform/index.js';
import { AGENT_RUNTIME_KIND } from '../../../../shared/desktop-api/agent/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DSH_VERSION = '0.1.0-rc.7';
const START_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 3_000;
const READY_PATTERN = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/u;

export function createDshSupervisor({
    electronApp,
    spawnProcess,
    prepareLaunch = prepareDshLaunch,
    refreshContextSnapshot = refreshDshProjectContext,
    waitForReady = waitForRuntime,
}) {
    let child = null;
    let state = 'idle';
    let startPromise = null;
    let runtimeUrl = '';
    let activeConfigSignature = '';
    let activeProjectId = '';
    let lastError = '';
    let hasCredential = false;
    let generation = 0;
    let lifecycleTail = Promise.resolve();
    const pendingRuntimeOpens = new Map();

    async function status() {
        return publicStatus();
    }

    function openRuntime(input = {}) {
        const requestKey = `${input?.projectId || ''}\u0000${input?.chapterId || ''}`;
        const existing = pendingRuntimeOpens.get(requestKey);
        if (existing) return existing;
        const operation = enqueueLifecycle(() => openRuntimeUnlocked(input));
        const tracked = operation.finally(() => {
            if (pendingRuntimeOpens.get(requestKey) === tracked) pendingRuntimeOpens.delete(requestKey);
        });
        pendingRuntimeOpens.set(requestKey, tracked);
        return tracked;
    }

    async function openRuntimeUnlocked(input = {}) {
        let launch;
        try {
            launch = await prepareLaunch({
                userDataRoot: process.env.CUIGENGJI_DSH_ROOT || electronApp.getPath('userData'),
                projectId: input?.projectId,
                chapterId: input?.chapterId,
            });
        } catch (error) {
            const cause = error instanceof Error ? error.message : String(error);
            console.error('[DSH] launch preparation failed', cause);
            throw new AppError('AGENT_RUNTIME_START_FAILED', cause, {
                status: 503,
                retryable: true,
                publicMessage: 'DSH 启动失败，请重试或查看主进程日志。',
            });
        }
        hasCredential = launch.hasCredential;

        if (child && state === 'ready' && launch.configSignature !== activeConfigSignature) {
            await stopUnlocked();
        }
        if (!child || state !== 'ready') await start(launch);
        await waitForReady(runtimeUrl);
        activeProjectId = input.projectId;
        return {
            url: runtimeUrl,
            generation,
            launch,
            status: publicStatus(),
        };
    }

    function refreshContext(input = {}) {
        return enqueueLifecycle(() => refreshContextUnlocked(input));
    }

    async function refreshContextUnlocked(input = {}) {
        validateProjectId(input?.projectId);
        if (!child || state !== 'ready' || input.projectId !== activeProjectId) {
            return { ...publicStatus(), refreshed: false };
        }
        const result = await refreshContextSnapshot({
            userDataRoot: process.env.CUIGENGJI_DSH_ROOT || electronApp.getPath('userData'),
            projectId: input.projectId,
            chapterId: input.chapterId,
        });
        return { ...publicStatus(), refreshed: true, generatedAt: result.generatedAt };
    }

    function restartRuntime(input = {}) {
        return enqueueLifecycle(async () => {
            await stopUnlocked();
            return openRuntimeUnlocked(input);
        });
    }

    async function start(launch) {
        if (state === 'ready' && child) return publicStatus();
        if (startPromise) return startPromise;

        state = 'starting';
        lastError = '';
        const currentGeneration = ++generation;
        startPromise = new Promise((resolve, reject) => {
            let settled = false;
            let stdoutBuffer = '';
            let stderrBuffer = '';
            const timeout = setTimeout(() => {
                fail(new Error('DeepSeek Harness startup timed out'));
            }, START_TIMEOUT_MS);

            const finish = (error, url) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (error) {
                    state = 'failed';
                    lastError = 'DSH 启动失败，请重试或查看主进程日志。';
                    if (stderrBuffer) console.error('[DSH]', redact(stderrBuffer, launch.secret));
                    if (diagnosticsEnabled() && stdoutBuffer) {
                        console.error('[DSH diagnostics]', redact(stdoutBuffer, launch.secret));
                    }
                    reject(new AppError('AGENT_RUNTIME_START_FAILED', error.message, {
                        status: 503,
                        retryable: true,
                        publicMessage: lastError,
                    }));
                    return;
                }
                runtimeUrl = url;
                activeConfigSignature = launch.configSignature;
                state = 'ready';
                resolve(publicStatus());
            };

            const fail = error => {
                const processToKill = child;
                child = null;
                processToKill?.kill();
                finish(error);
            };

            try {
                child = spawnProcess(process.execPath, [
                    '--expose-internals',
                    resolveDshBin(),
                    'web',
                    '--patch', launch.patchFile,
                    '--port', '0',
                ], {
                    cwd: launch.runtimeRoot,
                    env: {
                        ...launch.env,
                        ELECTRON_RUN_AS_NODE: '1',
                    },
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true,
                });
            } catch (error) {
                fail(error);
                return;
            }

            child.stdout?.on('data', chunk => {
                stdoutBuffer = `${stdoutBuffer}${String(chunk)}`.slice(-32_000);
                const match = READY_PATTERN.exec(stdoutBuffer);
                if (match) finish(null, match[1]);
            });
            child.stderr?.on('data', chunk => {
                stderrBuffer = `${stderrBuffer}${String(chunk)}`.slice(-32_000);
            });
            child.on('error', error => {
                fail(error);
            });
            child.on('exit', code => {
                if (currentGeneration !== generation) return;
                child = null;
                runtimeUrl = '';
                if (!settled) {
                    finish(new Error(`DeepSeek Harness exited before ready (${code})`));
                    return;
                }
                if (state !== 'stopped') {
                    state = 'failed';
                    lastError = 'DSH 进程已退出，重新打开工作台即可重启。';
                    if (stdoutBuffer) console.error('[DSH stdout]', redact(stdoutBuffer, launch.secret));
                    if (stderrBuffer) console.error('[DSH]', redact(stderrBuffer, launch.secret));
                    console.error(`[DSH] Process exited with code ${code}`);
                }
            });
        }).finally(() => {
            startPromise = null;
        });
        return startPromise;
    }

    function stop() {
        return enqueueLifecycle(stopUnlocked);
    }

    async function stopUnlocked() {
        generation += 1;
        const processToStop = child;
        child = null;
        runtimeUrl = '';
        activeConfigSignature = '';
        activeProjectId = '';
        state = 'stopped';
        lastError = '';
        if (!processToStop) return publicStatus();

        const exited = new Promise(resolve => processToStop.once('exit', resolve));
        processToStop.kill();
        await Promise.race([
            exited,
            new Promise(resolve => setTimeout(resolve, STOP_TIMEOUT_MS)),
        ]);
        if (processToStop.exitCode === null) processToStop.kill('SIGKILL');
        return publicStatus();
    }

    function invalidateCredentials() {
        activeConfigSignature = '';
    }

    function publicStatus() {
        return {
            kind: AGENT_RUNTIME_KIND,
            version: DSH_VERSION,
            state,
            ready: state === 'ready' && Boolean(child && runtimeUrl),
            hasCredential,
            lastError,
        };
    }

    function enqueueLifecycle(operation) {
        const result = lifecycleTail.then(operation, operation);
        lifecycleTail = result.catch(() => {});
        return result;
    }

    return {
        status,
        openRuntime,
        refreshContext,
        restartRuntime,
        stop,
        invalidateCredentials,
    };
}

export async function prepareDshLaunch({ userDataRoot, projectId, chapterId }) {
    if (!projectId || typeof projectId !== 'string') {
        throw new AppError('VALIDATION_ERROR', 'projectId is required', {
            status: 400,
            publicMessage: '请先打开一个小说项目。',
        });
    }

    const runtimePaths = resolveProjectRuntimePaths(userDataRoot, projectId);
    const { runtimeRoot, contextFile, knowledgeFile } = runtimePaths;
    const dshHome = path.join(runtimeRoot, 'home');
    const workspaceDir = path.join(runtimeRoot, 'workspace');
    const patchFile = path.join(runtimeRoot, 'cuigenji.overlay.yml');
    const presetRoot = path.join(dshHome, '.agent-presets', 'cuigenji');
    await Promise.all([
        fs.mkdir(presetRoot, { recursive: true, mode: 0o700 }),
        fs.mkdir(workspaceDir, { recursive: true, mode: 0o700 }),
    ]);

    const [{ context: snapshot, knowledge }, workspace, pluginSources] = await Promise.all([
        buildAgentProjectContextArtifacts({ projectId, chapterId }),
        loadWorkspace(projectId),
        readDshPluginSources(),
    ]);
    const profile = workspace.presetName || undefined;
    const secret = readAiSecret('deepseek', profile);
    const deepseekConfig = workspace.aiConfig?.provider === 'deepseek'
        ? workspace.aiConfig
        : {};
    const model = cleanSingleLine(deepseekConfig.model, 200) || 'deepseek-v4-flash';
    const endpoint = cleanSingleLine(deepseekConfig.endpoint, 2_000);

    await Promise.all([
        writePrivateJson(contextFile, snapshot),
        writePrivateJson(knowledgeFile, knowledge),
        ...Object.entries(pluginSources).map(([file, content]) => (
            writePrivateText(path.join(presetRoot, file), content)
        )),
        writePrivateText(path.join(presetRoot, 'preset.yml'), stringifyYaml({
            name: '催更姬写作模式',
            description: '只读取当前小说上下文、不授予文件或命令执行工具的写作 Agent。',
            order: -100,
        })),
        writePrivateText(path.join(presetRoot, 'agent.cordis.yml'), stringifyYaml([
            {
                id: 'persona',
                name: '@deepseek-ai/dsh-persona',
                config: {
                    text: [
                        '你是“催更姬”小说创作 Agent，工作在独立的 DeepSeek Harness 运行时中。',
                        '优先遵守用户当前请求，并使用催更姬提供的项目上下文维持人物、世界观、时间线与文风一致。',
                        '你没有文件系统、Shell、子 Agent 或项目写入工具；需要修改正文时，先输出可供用户审阅和复制的文本。',
                        '明确区分项目已有事实、合理推断和新建议；信息不足时直接说明。',
                    ].join('\n'),
                    includeRuntimeContext: true,
                },
            },
            {
                id: 'cuigenji-project-context',
                name: './cuigenji-project-context.mjs',
            },
            {
                id: 'cuigenji-project-knowledge',
                name: './cuigenji-project-knowledge.mjs',
            },
            {
                id: 'cuigenji-tool-policy',
                name: './cuigenji-tool-policy.mjs',
            },
            {
                id: 'compaction',
                name: 'cordis:group',
                group: true,
                isolate: {
                    compaction: true,
                    toolResultPruner: true,
                },
                config: [
                    {
                        id: 'cuigenji-novel-compaction',
                        name: './cuigenji-novel-compaction.mjs',
                    },
                    {
                        id: 'command-compact',
                        name: '@deepseek-ai/dsh-command-compact',
                    },
                    {
                        id: 'tool-result-pruner',
                        name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
                        config: {
                            thresholdChars: 8_192,
                            headChars: 4_096,
                            tailChars: 1_024,
                        },
                    },
                ],
            },
        ])),
        writePrivateText(patchFile, stringifyYaml([
            {
                id: 'system-prompt',
                config: {
                    includeHarnessIdentity: false,
                    includeRuntimeContext: true,
                    persona: '',
                },
            },
            {
                id: 'web-runtime',
                config: {
                    printUrl: true,
                    surfaceContext: false,
                    trustedHosts: [],
                },
            },
            {
                id: 'agent-default-model',
                config: { provider: 'deepseek-official', model },
            },
            {
                id: 'agent-presets',
                config: { default: 'cuigenji' },
            },
            { id: 'ui-agent-preset', disabled: true },
            { id: 'ui-settings-models', disabled: true },
            { id: 'ui-settings-plugin-inventory', disabled: true },
            { id: 'ui-settings-plugins', disabled: true },
            { id: 'ui-permission', disabled: true },
            { id: 'ui-deliverables', disabled: true },
        ])),
    ]);

    const env = runtimeEnvironment({
        dshHome,
        contextFile,
        knowledgeFile,
        secret,
        endpoint,
    });
    const configSignature = createHash('sha256')
        .update(JSON.stringify({ projectId, secret, endpoint, model }))
        .digest('hex');
    return {
        runtimeRoot,
        workspaceDir,
        projectTitle: snapshot.project.title || projectId,
        patchFile,
        env,
        secret,
        hasCredential: Boolean(secret),
        configSignature,
        context: {
            chapterId: chapterId || '',
            generatedAt: snapshot.generatedAt,
            knowledgeEntries: knowledge.entries.length,
        },
    };
}

export async function refreshDshProjectContext({ userDataRoot, projectId, chapterId }) {
    validateProjectId(projectId);
    const { runtimeRoot, contextFile, knowledgeFile } = resolveProjectRuntimePaths(userDataRoot, projectId);
    await fs.mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
    const { context, knowledge } = await buildAgentProjectContextArtifacts({ projectId, chapterId });
    await writePrivateJson(knowledgeFile, knowledge);
    await writePrivateJson(contextFile, context);
    return {
        generatedAt: context.generatedAt,
        schemaVersion: context.schemaVersion,
        knowledgeEntries: knowledge.entries.length,
    };
}

function resolveDshBin() {
    return path.join(path.dirname(resolveModuleFile('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js');
}

function runtimeEnvironment({ dshHome, contextFile, knowledgeFile, secret, endpoint }) {
    const allowed = [
        'SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC',
        'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE',
        'LANG', 'LC_ALL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
        'http_proxy', 'https_proxy', 'no_proxy',
    ];
    const env = Object.fromEntries(allowed
        .filter(key => typeof process.env[key] === 'string')
        .map(key => [key, process.env[key]]));
    return {
        ...env,
        DSH_HOME: dshHome,
        DSH_PERMISSION_MODE: 'read-only',
        CUIGENGJI_DSH_CONTEXT_FILE: contextFile,
        CUIGENGJI_DSH_KNOWLEDGE_FILE: knowledgeFile,
        NODE_ENV: 'production',
        FORCE_COLOR: '0',
        ...(secret ? { DEEPSEEK_API_KEY: secret } : {}),
        ...(endpoint ? { DEEPSEEK_BASE_URL: endpoint } : {}),
    };
}

function resolveProjectRuntimePaths(userDataRoot, projectId) {
    const projectKey = createHash('sha256').update(projectId).digest('hex').slice(0, 20);
    const runtimeRoot = path.join(userDataRoot, 'deepseek-harness', 'projects', projectKey);
    return {
        runtimeRoot,
        contextFile: path.join(runtimeRoot, 'project-context.json'),
        knowledgeFile: path.join(runtimeRoot, 'project-knowledge.json'),
    };
}

async function readDshPluginSources() {
    const pluginFiles = [
        'cuigenji-project-context.mjs',
        'cuigenji-project-knowledge.mjs',
        'cuigenji-tool-policy.mjs',
        'cuigenji-novel-compaction.mjs',
    ];
    const sources = await Promise.all(pluginFiles.map(async file => [
        file,
        await fs.readFile(path.join(__dirname, 'plugins', file), 'utf8'),
    ]));
    const result = Object.fromEntries(sources);
    result['cuigenji-project-knowledge.mjs'] = result['cuigenji-project-knowledge.mjs']
        .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-tools')));
    result['cuigenji-tool-policy.mjs'] = result['cuigenji-tool-policy.mjs']
        .replace("'@deepseek-ai/dsh-scope'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-scope')));
    result['cuigenji-novel-compaction.mjs'] = result['cuigenji-novel-compaction.mjs']
        .replace("'@deepseek-ai/dsh-compaction-basic'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-compaction-basic')))
        .replace("'@deepseek-ai/dsh-llm'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-llm')));
    return result;
}

function moduleUrl(packageName) {
    return pathToFileURL(resolveModuleFile(packageName)).href;
}

function resolveModuleFile(packageName) {
    const packageFile = require.resolve(packageName);
    const unpackedPackageFile = packageFile.replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`,
    );
    return unpackedPackageFile !== packageFile && existsSync(unpackedPackageFile)
        ? unpackedPackageFile
        : packageFile;
}

function validateProjectId(projectId) {
    if (!projectId || typeof projectId !== 'string') {
        throw new AppError('VALIDATION_ERROR', 'projectId is required', {
            status: 400,
            publicMessage: '请先打开一个小说项目。',
        });
    }
}

function cleanSingleLine(value, maxChars) {
    return String(value || '').replace(/[\r\n\0]/gu, '').trim().slice(0, maxChars);
}

function writePrivateText(file, content) {
    return writeFileAtomic(file, content, { encoding: 'utf8', mode: 0o600 });
}

function writePrivateJson(file, value) {
    return writePrivateText(file, JSON.stringify(value, null, 2));
}

function redact(value, secret) {
    const text = String(value || '');
    return secret ? text.split(secret).join('[REDACTED]') : text;
}

function diagnosticsEnabled() {
    return process.env.CUIGENGJI_DSH_DIAGNOSTICS === '1';
}

async function waitForRuntime(url) {
    const deadline = Date.now() + 12_000;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
            if (response.ok) {
                await response.body?.cancel();
                return;
            }
            lastError = new Error(`DSH health probe returned HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new AppError('AGENT_RUNTIME_UNREACHABLE', lastError?.message || 'DSH is unreachable', {
        status: 503,
        retryable: true,
        publicMessage: 'DSH 已启动但本机界面暂时无法连接，请重试。',
    });
}
