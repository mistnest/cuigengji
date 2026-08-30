import { AppError } from '../../../../src/backend/foundation/platform/index.js';

export const DSH_GENERIC_API_KEY_ENV = 'CUIGENGJI_AGENT_API_KEY';

const DEFAULT_ENDPOINTS = Object.freeze({
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
    // Vertex Express is routed through the native pi-ai provider. The
    // project/location resource path is added below so an API-key request
    // keeps the same shape as the verified Vertex REST endpoint.
    'google-vertex': 'https://aiplatform.googleapis.com',
    mistral: 'https://api.mistral.ai/v1',
    xai: 'https://api.x.ai/v1',
    groq: 'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    deepseek: 'https://api.deepseek.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    doubao: 'https://ark.cn-beijing.volces.com/api/v3',
    spark: 'https://spark-api-open.xf-yun.com/v1',
    zai: 'https://api.z.ai/api/paas/v4',
    zaiCoding: 'https://api.z.ai/api/coding/paas/v4',
    moonshot: 'https://api.moonshot.cn/v1',
    siliconflow: 'https://api.siliconflow.com/v1',
    siliconflowCn: 'https://api.siliconflow.cn/v1',
    minimax: 'https://api.minimax.io/v1',
    minimaxCn: 'https://api.minimaxi.com/v1',
    ollama: 'http://localhost:11434',
});

const DEFAULT_MODELS = Object.freeze({
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    google: 'gemini-2.5-flash',
    'google-vertex': 'gemini-2.5-flash',
    mistral: 'mistral-large-latest',
    xai: 'grok-4.3',
    groq: 'llama-3.3-70b-versatile',
    openrouter: 'anthropic/claude-sonnet-4.6',
    deepseek: 'deepseek-v4-flash',
    qwen: 'qwen-plus',
    doubao: 'doubao-pro-32k',
    spark: 'lite',
    zai: 'glm-5-turbo',
    moonshot: 'kimi-k2.5',
    siliconflow: 'deepseek-ai/DeepSeek-V3',
    minimax: 'MiniMax-M2.7',
    ollama: 'llama3',
});

const NATIVE_PI_ROUTES = Object.freeze({
    anthropic: 'anthropic',
    google: 'google',
    'google-vertex': 'google-vertex',
    openrouter: 'openrouter',
});

const OPENAI_COMPATIBLE_PROVIDERS = new Set([
    'openai',
    'mistral',
    'xai',
    'groq',
    'qwen',
    'doubao',
    'spark',
    'zai',
    'moonshot',
    'siliconflow',
    'minimax',
    'ollama',
    'custom',
]);

export function resolveDshProviderConfig(aiConfig = {}, secret = '') {
    const sourceProvider = cleanSingleLine(aiConfig.provider, 100);
    if (!sourceProvider) {
        throw providerError('请先在 AI 设置中选择模型服务商。');
    }
    const model = cleanSingleLine(aiConfig.model, 300) || DEFAULT_MODELS[sourceProvider] || '';
    if (!model) {
        throw providerError('请先选择或输入 Agent 使用的模型。');
    }
    const endpoint = normalizeEndpoint(resolveConfiguredEndpoint(aiConfig, sourceProvider));
    const normalizedSecret = String(secret || '').trim();
    if (sourceProvider === 'google-vertex') {
        return resolveVertexExpressConfig(aiConfig, model, normalizedSecret);
    }
    const credentialOptional = sourceProvider === 'ollama';
    // pi-ai's OpenAI-compatible transport still requires an Authorization value,
    // even when a local Ollama server does not authenticate it. Keep the fixed
    // placeholder process-local instead of asking the user for a meaningless key.
    const requestCredential = normalizedSecret || (credentialOptional ? 'ollama-local' : '');

    if (sourceProvider === 'deepseek') {
        return {
            sourceProvider,
            providerRoute: 'deepseek-official',
            model,
            endpoint,
            secret: normalizedSecret,
            hasCredential: Boolean(normalizedSecret),
            credentialOptional: false,
            piAiConfig: null,
            environment: {
                ...(normalizedSecret ? { DEEPSEEK_API_KEY: normalizedSecret } : {}),
                ...(endpoint ? { DEEPSEEK_BASE_URL: endpoint } : {}),
            },
        };
    }

    const nativeRoute = NATIVE_PI_ROUTES[sourceProvider];
    const providerRoute = nativeRoute || `cuigengji-${sourceProvider}`;
    if (!nativeRoute && !OPENAI_COMPATIBLE_PROVIDERS.has(sourceProvider)) {
        throw providerError(`Agent 暂不支持模型服务商：${sourceProvider}`);
    }
    const baseURL = sourceProvider === 'ollama'
        ? normalizeOllamaOpenAiEndpoint(endpoint)
        : endpoint;
    if (!baseURL) {
        throw providerError('请先填写完整的模型接口地址。');
    }
    const modelEntry = nativeRoute
        ? { id: model }
        : {
            id: model,
            contextWindow: boundedPositiveInteger(aiConfig.maxContext, 128_000, 4_000, 4_000_000),
            maxTokens: boundedPositiveInteger(aiConfig.maxTokens, 32_768, 256, 262_144),
        };
    const profile = {
        ...(nativeRoute ? {} : {
            displayName: providerDisplayName(sourceProvider),
            api: 'openai-completions',
        }),
        ...(requestCredential || !credentialOptional
            ? { apiKeyEnv: DSH_GENERIC_API_KEY_ENV }
            : {}),
        baseURL,
        models: [modelEntry],
    };
    return {
        sourceProvider,
        providerRoute,
        model,
        endpoint: baseURL,
        secret: normalizedSecret,
        hasCredential: credentialOptional || Boolean(normalizedSecret),
        credentialOptional,
        piAiConfig: { providers: { [providerRoute]: profile } },
        environment: requestCredential
            ? { [DSH_GENERIC_API_KEY_ENV]: requestCredential }
            : {},
    };
}

function normalizeEndpoint(value) {
    const text = cleanSingleLine(value, 2_000);
    if (!text) return '';
    let url;
    try {
        url = new URL(text);
    } catch {
        throw providerError('模型接口地址格式无效。');
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
        throw providerError('模型接口地址只支持完整的 HTTP(S) URL。');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw providerError('模型接口地址不能包含用户名、密码、查询参数或片段。');
    }
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
        throw providerError('远程模型接口必须使用 HTTPS；HTTP 只允许本机地址。');
    }
    return url.href.replace(/\/+$/u, '');
}

/**
 * Keep the provider-specific region selectors in the existing settings page
 * authoritative for Agent as well as for the legacy writer.  A manually
 * entered custom endpoint always wins; a selector only replaces one of the
 * known defaults, so it cannot unexpectedly overwrite a user's proxy.
 */
function resolveConfiguredEndpoint(aiConfig = {}, provider) {
    const explicit = cleanSingleLine(aiConfig.endpoint, 2_000);
    const normalizedExplicit = explicit.replace(/\/+$/u, '');
    const select = (value, entries) => {
        const region = cleanSingleLine(value, 40).toLocaleLowerCase();
        if (!entries[region]) return '';
        if (!normalizedExplicit || entries.defaults.includes(normalizedExplicit)) {
            return entries[region];
        }
        return '';
    };
    if (provider === 'siliconflow') {
        const selected = select(aiConfig.siliconflowEndpoint, {
            global: DEFAULT_ENDPOINTS.siliconflow,
            cn: DEFAULT_ENDPOINTS.siliconflowCn,
            defaults: [DEFAULT_ENDPOINTS.siliconflow, DEFAULT_ENDPOINTS.siliconflowCn],
        });
        if (selected) return selected;
    }
    if (provider === 'minimax') {
        const selected = select(aiConfig.minimaxEndpoint, {
            global: DEFAULT_ENDPOINTS.minimax,
            cn: DEFAULT_ENDPOINTS.minimaxCn,
            defaults: [DEFAULT_ENDPOINTS.minimax, DEFAULT_ENDPOINTS.minimaxCn],
        });
        if (selected) return selected;
    }
    if (provider === 'zai') {
        const selected = select(aiConfig.zaiEndpoint, {
            common: DEFAULT_ENDPOINTS.zai,
            coding: DEFAULT_ENDPOINTS.zaiCoding,
            defaults: [DEFAULT_ENDPOINTS.zai, DEFAULT_ENDPOINTS.zaiCoding],
        });
        if (selected) return selected;
    }
    return explicit || DEFAULT_ENDPOINTS[provider] || '';
}

function normalizeOllamaOpenAiEndpoint(endpoint) {
    const url = new URL(endpoint || DEFAULT_ENDPOINTS.ollama);
    const path = url.pathname.replace(/\/+$/u, '');
    if (!path) url.pathname = '/v1';
    else if (!path.endsWith('/v1')) url.pathname = `${path}/v1`;
    return url.href.replace(/\/+$/u, '');
}

function isLoopbackHost(hostname) {
    const value = String(hostname || '').toLocaleLowerCase();
    return value === 'localhost' || value === '127.0.0.1' || value === '[::1]' || value === '::1';
}

function boundedPositiveInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) return fallback;
    return number;
}

function providerDisplayName(provider) {
    const labels = {
        openai: 'OpenAI', mistral: 'Mistral', xai: 'xAI', groq: 'Groq',
        qwen: '通义千问', doubao: '豆包', spark: '讯飞星火', zai: '智谱 GLM',
        moonshot: 'Moonshot', siliconflow: 'SiliconFlow', minimax: 'MiniMax',
        ollama: 'Ollama', custom: '自定义 OpenAI API',
    };
    return labels[provider] || provider;
}

/**
 * DSH's native Vertex adapter uses @google/genai. When an API key is present
 * that SDK intentionally drops project/location from its constructor and
 * sends the Vertex Express form. Supplying the resource prefix as the custom
 * base URL preserves the project-scoped route that the app has verified with
 * the user's key, without putting the key in the YAML overlay.
 */
function resolveVertexExpressConfig(aiConfig, model, normalizedSecret) {
    const authMode = cleanSingleLine(aiConfig.vertexAuthMode || 'express', 30).toLocaleLowerCase();
    if (authMode !== 'express') {
        throw providerError('DSH Agent 当前仅支持 Google Vertex Express API Key；Service Account 模式暂未接入。');
    }
    if (!normalizedSecret) {
        throw providerError('Google Vertex Express 模式需要 API Key。');
    }
    const projectId = cleanSingleLine(aiConfig.vertexProjectId, 100);
    if (!isVertexProjectId(projectId)) {
        throw providerError('Google Vertex Express 模式需要有效的 Project ID。');
    }
    const region = cleanSingleLine(aiConfig.vertexRegion || 'global', 60).toLocaleLowerCase();
    if (!isVertexRegion(region)) {
        throw providerError('Google Vertex Region 格式无效。');
    }
    const endpoint = buildVertexResourceEndpoint(projectId, region);
    return {
        sourceProvider: 'google-vertex',
        providerRoute: 'google-vertex',
        model,
        endpoint,
        secret: normalizedSecret,
        hasCredential: true,
        credentialOptional: false,
        piAiConfig: {
            providers: {
                'google-vertex': {
                    apiKeyEnv: 'GOOGLE_CLOUD_API_KEY',
                    baseURL: endpoint,
                    models: [{ id: model }],
                },
            },
        },
        environment: {
            GOOGLE_CLOUD_API_KEY: normalizedSecret,
            GOOGLE_CLOUD_PROJECT: projectId,
            GOOGLE_CLOUD_LOCATION: region,
        },
    };
}

function buildVertexResourceEndpoint(projectId, region) {
    const host = region === 'global'
        ? 'aiplatform.googleapis.com'
        : ['us', 'eu'].includes(region)
            ? `aiplatform.${region}.rep.googleapis.com`
            : `${region}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(region)}`;
}

function isVertexProjectId(value) {
    return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(value);
}

function isVertexRegion(value) {
    return /^(?:global|[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?)$/u.test(value);
}

function cleanSingleLine(value, maxChars) {
    return String(value || '').replace(/[\r\n\0]/gu, '').trim().slice(0, maxChars);
}

function providerError(message) {
    return new AppError('AGENT_PROVIDER_UNSUPPORTED', message, {
        status: 400,
        retryable: false,
        publicMessage: message,
    });
}
