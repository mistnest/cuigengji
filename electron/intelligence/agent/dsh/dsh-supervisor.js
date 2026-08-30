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
import { resolveDshProviderConfig } from './dsh-provider-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DSH_VERSION = '0.1.0-rc.7';
const START_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 3_000;
const READY_PATTERN = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/u;
const BUNDLED_SKILL_NAMES = Object.freeze([
    'story-direction-probe',
    'character-motivation-review',
    'conflict-suspense-review',
    'pacing-payoff-review',
    'commercial-web-fiction-review',
    'author-feedback-interpretation',
]);

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
        // A DSH child inherits its workspace/context paths and provider
        // environment at spawn time.  Reusing it for another project would
        // therefore expose the previous project's sessions or context even
        // when the model configuration is identical.  Keep the process
        // isolated per project; chapter changes within the same project can
        // still reuse the child and only refresh its context snapshot.
        if (child && state === 'ready'
            && (launch.configSignature !== activeConfigSignature
                || input.projectId !== activeProjectId)) {
            await stopUnlocked();
        }
        // `stopUnlocked` intentionally clears the public credential flag. Set
        // it after any replacement stop so the status describes the runtime
        // we are about to start (and not the retired child).
        hasCredential = Boolean(launch.hasCredential);
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
        return {
            ...publicStatus(),
            refreshed: true,
            generatedAt: result.generatedAt || '',
            schemaVersion: Number(result.schemaVersion || 0),
            snapshotId: result.snapshotId || '',
            projectChangeSeq: Number(result.projectChangeSeq || 0),
            streamId: result.streamId || '',
            knowledgeEntries: Number(result.knowledgeEntries || 0),
        };
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
        hasCredential = false;
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
    const skillRoot = path.join(presetRoot, 'skills');
    await Promise.all([
        fs.mkdir(presetRoot, { recursive: true, mode: 0o700 }),
        fs.mkdir(skillRoot, { recursive: true, mode: 0o700 }),
        fs.mkdir(workspaceDir, { recursive: true, mode: 0o700 }),
    ]);

    const [{ context: snapshot, knowledge, workspace: snapshotWorkspace }, pluginSources, skillSources] = await Promise.all([
        buildAgentProjectContextArtifacts({ projectId, chapterId }),
        readDshPluginSources(),
        readDshSkillSources(),
    ]);
    const workspace = snapshotWorkspace || await loadWorkspace(projectId);
    const profile = workspace.presetName || undefined;
    const aiConfig = workspace.aiConfig && typeof workspace.aiConfig === 'object'
        ? workspace.aiConfig
        : {};
    const selectedProvider = cleanSingleLine(aiConfig.provider, 100);
    const secret = selectedProvider ? readAiSecret(selectedProvider, profile) : '';
    const providerConfig = resolveDshProviderConfig(aiConfig, secret);
    const { model, endpoint } = providerConfig;
    const webSearchEnabled = Boolean(providerConfig.hasCredential && supportsOfficialDeepseekSearch({
        provider: providerConfig.sourceProvider,
        endpoint,
    }));
    const allowedToolNames = [
        'search_project_knowledge',
        'get_project_knowledge',
        'skill',
        ...(webSearchEnabled ? ['web_search'] : []),
        'safe_web_fetch',
        'propose_outline_patch',
    ];
    const webCapabilityPrompt = webSearchEnabled
        ? '当前会话可以使用 web_search 查询现实资料。仅在用户明确要求或回答依赖外部事实时使用，引用来源 URL，并把结果标记为外部参考。'
        : providerConfig.sourceProvider === 'deepseek'
            && !supportsOfficialDeepseekSearch({
                provider: providerConfig.sourceProvider,
                endpoint,
            })
            ? '当前模型使用自定义或非官方端点，本会话不会把该密钥发送到 DeepSeek 官方搜索接口，因此没有 web_search；需要外部资料时直接说明此限制。'
            : providerConfig.sourceProvider === 'deepseek'
                ? '当前 DeepSeek 模型尚未配置可用密钥，因此没有 web_search；请先在 AI 设置中连接模型服务。'
                : '当前 Agent 使用非 DeepSeek 模型，本会话不会把该服务商密钥发送到 DeepSeek 官方搜索接口，因此没有 web_search；仍可读取用户明确给出的公开网页。';

    await Promise.all(Object.keys(skillSources).map(skillName => (
        fs.mkdir(path.join(skillRoot, skillName), { recursive: true, mode: 0o700 })
    )));
    await Promise.all([
        writePrivateJson(contextFile, snapshot),
        writePrivateJson(knowledgeFile, knowledge),
        ...Object.entries(pluginSources).map(([file, content]) => (
            writePrivateText(path.join(presetRoot, file), content)
        )),
        ...Object.entries(skillSources).map(([skillName, content]) => (
            writePrivateText(path.join(skillRoot, skillName, 'SKILL.md'), content)
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
                        '用户输入前保持安静；收到请求后直接用自然对话回应，不暴露内部工作模式、Skill 名称或流程阶段。',
                        '优先遵守用户当前请求，并使用催更姬提供的项目上下文维持人物、世界观、时间线与文风一致。每轮优先推进一个最关键的不确定性。',
                        '需要帮助用户判断方向时，默认给出两个真正有差异的方案；确有必要时给三个，只有初始开放式发散才给更多。用户可以不按选项回答。',
                        '明确区分项目已有事实、本会话中用户确认但尚未写入的决定、外部资料、合理推断、临时假设和新建议，不得把后四类升级为项目事实。',
                        '本会话中的偏好、否决和假设只服务于当前 DSH session；不要声称拥有跨会话的作者画像或长期项目记忆。',
                        '项目资料不足时先说明缺口，再按需查询只读项目资料；只有现实事实或背景研究确有需要时才搜索网络，纯创作取舍不滥用搜索。',
                        webCapabilityPrompt,
                        '可以使用 safe_web_fetch 读取用户明确给出的公开网页，或深入阅读 web_search 返回的具体来源；不要猜测 URL，不要把网页内容当作项目设定。',
                        '可以诊断、比较、局部试写和提出修改方案。只有用户已经把方向讨论清楚并希望落到大纲时，才调用 propose_outline_patch；baseRevision 必须使用当前项目上下文中的 outline.revision。',
                        '任何提案都不等于项目已经修改。只有用户在催更姬界面明确应用后，项目内容才会改变；提案过期时不要尝试绕过 revision 校验。',
                        '你没有文件系统、Shell、子 Agent 或项目写入工具；需要修改正文时，先输出可供用户审阅和复制的文本。',
                        '信息不足时直接说明，不用虚构细节填补空白，也不要反复追问低影响、易撤销的小问题。',
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
                id: 'skill-filesystem',
                name: '@deepseek-ai/dsh-skill-filesystem',
                config: {
                    providerName: 'cuigenji-bundled',
                    includeDefaultRoots: false,
                    customSkillDirs: [skillRoot],
                    watch: false,
                },
            },
            {
                id: 'tool-skill',
                name: '@deepseek-ai/dsh-tool-skill',
                config: {
                    catalogDescriptionMaxLength: 240,
                },
            },
            ...(webSearchEnabled ? [{
                id: 'tool-web',
                name: '@deepseek-ai/dsh-tool-web',
                config: {
                    search: true,
                    fetch: false,
                    searchMaxResults: 6,
                    searchTimeoutMs: 60_000,
                },
            }] : []),
            {
                id: 'cuigenji-safe-web-fetch',
                name: './cuigenji-safe-web-fetch.mjs',
            },
            {
                id: 'cuigenji-outline-proposal',
                name: './cuigenji-outline-proposal.mjs',
            },
            {
                id: 'cuigenji-tool-policy',
                name: './cuigenji-tool-policy.mjs',
                config: {
                    allowedToolNames,
                },
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
                config: { provider: providerConfig.providerRoute, model },
            },
            ...(providerConfig.piAiConfig ? [{
                id: 'llm-pi-ai',
                config: providerConfig.piAiConfig,
            }] : []),
            {
                id: 'agent-presets',
                config: { default: 'cuigenji' },
            },
            ...(webSearchEnabled ? [{
                id: 'web-search-deepseek',
                config: { maxUses: 3 },
            }] : []),
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
        providerEnvironment: providerConfig.environment,
    });
    const configSignature = createHash('sha256')
        .update(JSON.stringify({
            projectId,
            secret,
            provider: providerConfig.sourceProvider,
            route: providerConfig.providerRoute,
            endpoint,
            model,
            piAiConfig: providerConfig.piAiConfig,
        }))
        .digest('hex');
    return {
        runtimeRoot,
        workspaceDir,
        projectTitle: snapshot.project.title || projectId,
        patchFile,
        env,
        secret,
        hasCredential: providerConfig.hasCredential,
        configSignature,
        context: {
            chapterId: chapterId || '',
            generatedAt: snapshot.generatedAt,
            knowledgeEntries: knowledge.entries.length,
            webSearchEnabled,
            snapshotId: snapshot.snapshotId || '',
            projectChangeSeq: Number(snapshot.collaboration?.projectChangeSeq || 0),
            streamId: snapshot.collaboration?.streamId || '',
        },
    };
}

export function supportsOfficialDeepseekSearch({ provider, endpoint } = {}) {
    if (provider !== 'deepseek') return false;
    const value = cleanSingleLine(endpoint, 2_000);
    if (!value) return true;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname.toLocaleLowerCase() !== 'api.deepseek.com') {
            return false;
        }
        if (url.username || url.password || (url.port && url.port !== '443')) return false;
        if (url.search || url.hash) return false;
        const pathname = url.pathname.replace(/\/+$/u, '') || '/';
        return pathname === '/' || pathname === '/v1';
    } catch {
        return false;
    }
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
        snapshotId: context.snapshotId || '',
        projectChangeSeq: Number(context.collaboration?.projectChangeSeq || 0),
        streamId: context.collaboration?.streamId || '',
    };
}

function resolveDshBin() {
    return path.join(path.dirname(resolveModuleFile('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js');
}

function runtimeEnvironment({ dshHome, contextFile, knowledgeFile, providerEnvironment = {} }) {
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
        ...providerEnvironment,
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
        'cuigenji-safe-web-fetch.mjs',
        'cuigenji-outline-proposal.mjs',
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
    result['cuigenji-safe-web-fetch.mjs'] = result['cuigenji-safe-web-fetch.mjs']
        .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-tools')))
        .replace("'iconv-lite'", JSON.stringify(moduleUrl('iconv-lite')))
        .replace("'ipaddr.js'", JSON.stringify(moduleUrl('ipaddr.js')))
        .replace("'jschardet'", JSON.stringify(moduleUrl('jschardet')))
        .replace("'turndown'", JSON.stringify(moduleUrl('turndown')));
    result['cuigenji-outline-proposal.mjs'] = result['cuigenji-outline-proposal.mjs']
        .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-tools')));
    result['cuigenji-tool-policy.mjs'] = result['cuigenji-tool-policy.mjs']
        .replace("'@deepseek-ai/dsh-scope'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-scope')));
    result['cuigenji-novel-compaction.mjs'] = result['cuigenji-novel-compaction.mjs']
        .replace("'@deepseek-ai/dsh-compaction-basic'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-compaction-basic')))
        .replace("'@deepseek-ai/dsh-llm'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-llm')));
    return result;
}

async function readDshSkillSources() {
    const entries = await Promise.all(BUNDLED_SKILL_NAMES.map(async skillName => {
        const directory = path.join(__dirname, 'skills', skillName);
        return [
            skillName,
            await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8'),
        ];
    }));
    return Object.fromEntries(entries);
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
