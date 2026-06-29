import crypto from 'node:crypto';
import { ProxyAgent } from 'undici';

import { createApiCallId, logApiCall } from './api-call-logger.js';

const DEFAULT_ENDPOINTS = {
    openai: 'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    doubao: 'https://ark.cn-beijing.volces.com/api/v3',
    spark: 'https://spark-api-open.xf-yun.com/v1',
    siliconflow: 'https://api.siliconflow.com/v1',
    siliconflow_cn: 'https://api.siliconflow.cn/v1',
    groq: 'https://api.groq.com/openai/v1',
    mistral: 'https://api.mistral.ai/v1',
    xai: 'https://api.x.ai/v1',
    moonshot: 'https://api.moonshot.ai/v1',
    zai: 'https://api.z.ai/api/paas/v4',
    zai_coding: 'https://api.z.ai/api/coding/paas/v4',
    minimax: 'https://api.minimax.io/v1',
    minimax_cn: 'https://api.minimaxi.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    'google-vertex': '',
    custom: '',
};

const DEFAULT_MODELS = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    deepseek: 'deepseek-v4-flash',
    qwen: 'qwen-plus',
    doubao: 'doubao-pro-32k',
    spark: 'lite',
    google: 'gemini-2.5-flash',
    'google-vertex': 'gemini-2.5-flash',
    siliconflow: 'deepseek-ai/DeepSeek-V3',
    groq: 'llama-3.3-70b-versatile',
    mistral: 'mistral-large-latest',
    xai: 'grok-3-beta',
    moonshot: 'kimi-latest',
    zai: 'glm-5-turbo',
    minimax: 'MiniMax-M2.7',
    openrouter: 'anthropic/claude-sonnet-4-6',
    ollama: 'llama3',
};

const GOOGLE_VERTEX_MODELS = [
    { id: 'gemini-3-pro-preview', name: 'gemini-3-pro-preview', contextLimit: 1000000 },
    { id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview', contextLimit: 1000000 },
    { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro', contextLimit: 1000000 },
    { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash', contextLimit: 1000000 },
    { id: 'gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite', contextLimit: 1000000 },
    { id: 'gemini-2.0-flash-001', name: 'gemini-2.0-flash-001', contextLimit: 1000000 },
    { id: 'gemini-2.0-flash-lite-001', name: 'gemini-2.0-flash-lite-001', contextLimit: 1000000 },
];

const PROXY_TEST_URLS = [
    'https://aiplatform.googleapis.com',
    'https://generativelanguage.googleapis.com',
    'https://api.openai.com/v1/models',
];

const COMMON_LOCAL_PROXY_URLS = [
    'http://127.0.0.1:7890',
    'http://127.0.0.1:7897',
    'http://127.0.0.1:7899',
    'http://127.0.0.1:10809',
    'http://127.0.0.1:1087',
    'http://127.0.0.1:20171',
    'http://localhost:7890',
];

const proxyAgentCache = new Map();

function cleanBase(endpoint, provider) {
    return (endpoint || DEFAULT_ENDPOINTS[provider] || DEFAULT_ENDPOINTS.openai).replace(/\/+$/, '');
}

function providerEndpoint(config = {}) {
    const provider = config.provider || '';
    if (provider === 'siliconflow' && config.siliconflowEndpoint === 'cn') return DEFAULT_ENDPOINTS.siliconflow_cn;
    if (provider === 'minimax' && config.minimaxEndpoint === 'cn') return DEFAULT_ENDPOINTS.minimax_cn;
    if (provider === 'zai' && config.zaiEndpoint === 'coding') return DEFAULT_ENDPOINTS.zai_coding;
    return config.endpoint || DEFAULT_ENDPOINTS[provider] || '';
}

function generationOptions(config = {}, options = {}) {
    const rawMax = options.maxTokens || config.maxTokens || 4096;
    // DeepSeek shares the output budget between reasoning and content.
    // To ensure there's room for both, double the raw value with a floor
    // of 8K. Cap at DeepSeek's hard max_tokens limit (393216) to avoid
    // API validation errors.
    let result = rawMax;
    if (config.provider === 'deepseek') {
        result = Math.min(Math.max(rawMax * 2, 8192), 262144);
    }
    if (config.provider === 'google' || config.provider === 'google-vertex') {
        result = Math.min(Math.max(rawMax, 512), 8192);
    }
    return {
        maxTokens: result,
        temperature: config.temperature ?? 0.7,
        topP: config.topP ?? 0.9,
        topK: config.topK ?? 40,
    };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal) {
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
    }
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
    }
}

function normalizeProxyUrl(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(https?|socks[45]?):\/\//i.test(text)) return text;
    if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d+$/i.test(text)) return `http://${text}`;
    return text;
}

function resolveNetworkProxy(config = {}) {
    const mode = String(config.networkProxyMode || 'auto');
    if (mode === 'off') return '';
    const manual = normalizeProxyUrl(config.networkProxyUrl);
    if (manual) return manual;
    if (mode === 'manual') return '';
    return normalizeProxyUrl(
        process.env.HTTPS_PROXY
        || process.env.https_proxy
        || process.env.HTTP_PROXY
        || process.env.http_proxy
        || process.env.ALL_PROXY
        || process.env.all_proxy
        || '',
    );
}

function getProxyDispatcher(config = {}) {
    const proxyUrl = resolveNetworkProxy(config);
    if (!proxyUrl || /^socks/i.test(proxyUrl)) return null;
    if (!proxyAgentCache.has(proxyUrl)) {
        proxyAgentCache.set(proxyUrl, new ProxyAgent(proxyUrl));
    }
    return proxyAgentCache.get(proxyUrl);
}

function withNetworkProxy(options = {}, config = {}) {
    const dispatcher = getProxyDispatcher(config);
    return dispatcher ? { ...options, dispatcher } : options;
}

function isNetworkConnectError(err) {
    const text = `${err?.message || ''} ${err?.cause?.code || ''} ${err?.cause?.message || ''}`;
    return /fetch failed|connect timeout|UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|EHOSTUNREACH/i.test(text);
}

export function isLikelyNetworkProxyError(err) {
    return isNetworkConnectError(err);
}

export async function detectNetworkProxy({ targetUrl = '', timeoutMs = 3500 } = {}) {
    const candidates = [
        normalizeProxyUrl(process.env.HTTPS_PROXY || process.env.https_proxy || ''),
        normalizeProxyUrl(process.env.HTTP_PROXY || process.env.http_proxy || ''),
        normalizeProxyUrl(process.env.ALL_PROXY || process.env.all_proxy || ''),
        ...COMMON_LOCAL_PROXY_URLS,
    ].filter(Boolean);
    const unique = [...new Set(candidates)];
    const urls = targetUrl ? [targetUrl] : PROXY_TEST_URLS;
    for (const proxyUrl of unique) {
        if (/^socks/i.test(proxyUrl)) continue;
        const dispatcher = proxyAgentCache.get(proxyUrl) || new ProxyAgent(proxyUrl);
        proxyAgentCache.set(proxyUrl, dispatcher);
        for (const url of urls) {
            try {
                const response = await fetchWithTimeout(url, { method: 'HEAD', dispatcher }, timeoutMs);
                if (response.status > 0 && response.status < 500) {
                    return { proxyUrl, testUrl: url, status: response.status };
                }
            } catch {}
        }
    }
    return null;
}

function toText(messages) {
    return messages.map(m => `### ${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content}`).join('\n\n');
}

function toGeminiContents(messages) {
    return messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }],
    }));
}

function extractGeminiText(data = {}) {
    return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

function normalizeMessages(systemPrompt, userPromptOrMessages) {
    if (Array.isArray(userPromptOrMessages)) {
        return userPromptOrMessages;
    }
    return [{ role: 'user', content: userPromptOrMessages || '' }];
}

function supportsNativeToolMessages(provider) {
    return ['openai', 'openrouter', 'deepseek', 'qwen', 'doubao', 'siliconflow', 'groq', 'mistral', 'xai', 'moonshot', 'zai', 'minimax', 'custom'].includes(provider);
}

async function fetchLoggedChat(url, options = {}, meta = {}, timeoutMs) {
    const id = createApiCallId();
    const startedAt = Date.now();
    const baseLog = {
        id,
        timestamp: new Date(startedAt).toISOString(),
        provider: meta.provider,
        model: meta.model,
        mode: meta.mode,
        stream: meta.stream,
        toolChoice: meta.toolChoice,
        url,
        method: options.method || 'POST',
        request: {
            headers: options.headers || {},
            body: options.body,
        },
    };
    try {
        const response = await fetchWithTimeout(url, options, timeoutMs);
        attachApiLog(response, {
            ...baseLog,
            startedAt,
            response: {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                durationMs: Date.now() - startedAt,
                headers: response.headers,
            },
        });
        await logApiCall(response.__apiLog);
        return response;
    } catch (err) {
        await logApiCall({
            ...baseLog,
            response: {
                ok: false,
                status: null,
                statusText: '',
                durationMs: Date.now() - startedAt,
                error: err.message || String(err),
            },
        });
        throw err;
    }
}

function attachApiLog(response, entry) {
    Object.defineProperty(response, '__apiLog', {
        value: entry,
        enumerable: false,
        configurable: true,
    });
}

async function finalizeLoggedResponse(response, patch = {}) {
    if (!response?.__apiLog) return;
    const entry = {
        ...response.__apiLog,
        response: {
            ...(response.__apiLog.response || {}),
            ...(patch.response || {}),
            durationMs: Date.now() - response.__apiLog.startedAt,
        },
    };
    delete entry.startedAt;
    await logApiCall(entry);
}

async function readLoggedJsonResponse(response) {
    const text = await response.text();
    const parsed = parseJsonText(text);
    await finalizeLoggedResponse(response, {
        response: {
            body: text,
        },
    });
    return parsed;
}

async function readLoggedError(response) {
    const text = await response.text().catch(() => '');
    const parsed = parseJsonText(text) || {};
    await finalizeLoggedResponse(response, {
        response: {
            error: parsed.error?.message || parsed.error || text || response.statusText,
            body: text,
        },
    });
    return parsed;
}

function parseJsonText(text = '') {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function flattenToolMessages(messages = []) {
    const flattened = [];
    for (const message of messages) {
        if (message?.tool_calls?.length) continue;
        if (message?.role === 'tool') {
            const title = message.name || 'setting_import';
            flattened.push({
                role: 'user',
                content: `[${title}]\n${message.content || ''}`,
            });
            continue;
        }
        if (!['system', 'developer', 'user', 'assistant'].includes(message?.role)) {
            flattened.push({ role: 'user', content: message?.content || '' });
            continue;
        }
        const { role, content } = message;
        flattened.push({ role: role === 'developer' ? 'system' : role, content: content || '' });
    }
    return flattened.filter(message => message.role !== 'system');
}

function adaptMessagesForProvider(provider, messages) {
    if (supportsNativeToolMessages(provider)) return messages;
    return flattenToolMessages(messages);
}

function prepareOpenAICompatibleMessages(_provider, systemPrompt, messages = []) {
    return [{ role: 'system', content: systemPrompt || '' }, ...messages]
        .map(message => {
            const role = message.role === 'developer'
                ? 'system'
                : (['system', 'user', 'assistant', 'tool'].includes(message.role) ? message.role : 'user');
            const cleaned = { ...message, role, content: message.content || '' };
            // Many OpenAI-compatible providers reject message.name on system/user/assistant.
            // Tool result names are harmless and useful for debugging, so keep those.
            if (role !== 'tool') delete cleaned.name;
            return cleaned;
        })
        .filter(message => {
            if (message.role === 'tool') return Boolean(message.content || message.tool_call_id);
            if (message.tool_calls?.length) return true;
            return Boolean(String(message.content || '').trim());
        });
}

export async function callAIText(config, systemPrompt, userPrompt, options = {}) {
    return callAIChat(config, systemPrompt, [{ role: 'user', content: userPrompt || '' }], options);
}

export async function callAIChat(config = {}, systemPrompt, messages, options = {}) {
    const result = await callAIChatRaw(config, systemPrompt, messages, options);
    return extractAssistantText(config.provider, result.message);
}

export async function callAIChatRaw(config = {}, systemPrompt, messages, options = {}) {
    const { provider, apiKey, endpoint } = config;
    const model = config.model || DEFAULT_MODELS[provider];
    const { maxTokens, temperature, topP, topK } = generationOptions(config, options);
    const chatMessages = adaptMessagesForProvider(provider, normalizeMessages(systemPrompt, messages));

    switch (provider) {
        case 'anthropic':
            return callAnthropic({ config, apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, topK, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal });
        case 'google':
            return textResult(await callGoogle({ config, apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, signal: options.signal }));
        case 'google-vertex':
            return textResult(await callGoogleVertex({ config, apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, signal: options.signal }));
        case 'openrouter':
            return callOpenRouterRaw({ config, apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal });
        case 'ollama':
            return textResult(await callOllama({ endpoint, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, topK, signal: options.signal }));
        case 'openai':
        case 'deepseek':
        case 'qwen':
        case 'doubao':
        case 'spark':
        case 'siliconflow':
        case 'groq':
        case 'mistral':
        case 'xai':
        case 'moonshot':
        case 'zai':
        case 'minimax':
        case 'custom':
            return callOpenAICompatibleRaw({ config, provider, apiKey, endpoint: providerEndpoint(config), model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal });
        default:
            throw new Error(`Unsupported: ${provider}`);
    }
}

export async function streamAIChat(config = {}, systemPrompt, messages, options = {}) {
    const { provider, apiKey } = config;
    const model = config.model || DEFAULT_MODELS[provider];
    const { maxTokens, temperature, topP, topK } = generationOptions(config, options);
    const chatMessages = adaptMessagesForProvider(provider, normalizeMessages(systemPrompt, messages));
    const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};

    switch (provider) {
        case 'anthropic':
            return callAnthropicStream({ config, apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, topK, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal, onEvent });
        case 'openrouter':
            return callOpenRouterStream({ config, apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal, onEvent });
        case 'openai':
        case 'deepseek':
        case 'qwen':
        case 'doubao':
        case 'spark':
        case 'siliconflow':
        case 'groq':
        case 'mistral':
        case 'xai':
        case 'moonshot':
        case 'zai':
        case 'minimax':
        case 'custom':
            return callOpenAICompatibleStream({ config, provider, apiKey, endpoint: providerEndpoint(config), model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal, onEvent });
        case 'google':
        case 'google-vertex':
        case 'ollama':
            return streamFallback(config, systemPrompt, chatMessages, options, onEvent);
        default:
            throw new Error(`Unsupported: ${provider}`);
    }
}

function textResult(content) {
    return { message: { role: 'assistant', content: content || '' }, raw: null };
}

function extractAssistantText(provider, message = {}) {
    const content = message?.content || '';
    const reasoning = message?.reasoning_content || '';
    if (!content && !reasoning) {
        throw new Error(`Empty response from ${provider}`);
    }
    if (!content && reasoning) {
        return '[REASONING]\n' + reasoning + '\n[/REASONING]\n\n*(鎬濊€冭繃绋嬬粨鏉燂紝鏈敓鎴愭鏂囥€傝璋冮珮 MaxTokens)*';
    }
    if (reasoning && provider === 'deepseek') {
        return '[REASONING]\n' + reasoning + '\n[/REASONING]\n\n' + content;
    }
    return content;
}

async function callGoogle({ config = {}, apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, signal }) {
    const requestModel = model || DEFAULT_MODELS.google;
    const body = {
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents: toGeminiContents(messages),
        generationConfig: { temperature, maxOutputTokens: maxTokens, topP },
    };
    const r = await fetchLoggedChat(`https://generativelanguage.googleapis.com/v1beta/models/${requestModel}:generateContent?key=${apiKey}`, withNetworkProxy({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    }, config), { provider: 'google', model: requestModel, mode: 'chat', stream: false });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `Gemini ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    return extractGeminiText(d);
}

async function callGoogleVertex({ config = {}, apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, signal }) {
    const requestModel = model || DEFAULT_MODELS['google-vertex'];
    const authMode = String(config.vertexAuthMode || 'express');
    const region = String(config.vertexRegion || 'us-central1').trim() || 'us-central1';
    const body = {
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents: toGeminiContents(messages),
        generationConfig: { temperature, maxOutputTokens: maxTokens, topP },
    };
    const { url, headers } = await buildVertexGenerateRequest({
        authMode,
        region,
        projectId: config.vertexProjectId,
        apiKey,
        serviceAccountJson: config.vertexServiceAccountJson,
        model: requestModel,
        responseType: 'generateContent',
        config,
    });
    const r = await fetchLoggedChat(url, withNetworkProxy({
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
    }, config), { provider: 'google-vertex', model: requestModel, mode: 'chat', stream: false });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || e.message || `Google Vertex AI ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    return extractGeminiText(d);
}

async function buildVertexGenerateRequest({ authMode, region, projectId, apiKey, serviceAccountJson, model, responseType, config = {} }) {
    const normalizedRegion = region || 'us-central1';
    const baseUrl = normalizedRegion === 'global'
        ? 'https://aiplatform.googleapis.com'
        : `https://${normalizedRegion}-aiplatform.googleapis.com`;
    const headers = { 'Content-Type': 'application/json' };
    if (authMode === 'full') {
        if (!serviceAccountJson) throw new Error('Vertex AI Full 模式需要 Service Account JSON');
        const serviceAccount = parseVertexServiceAccount(serviceAccountJson);
        const resolvedProjectId = String(projectId || serviceAccount.project_id || '').trim();
        if (!resolvedProjectId) throw new Error('Vertex AI Full 模式需要 Project ID');
        const accessToken = await getVertexAccessToken(serviceAccount, config);
        headers.Authorization = `Bearer ${accessToken}`;
        return {
            url: `${baseUrl}/v1/projects/${encodeURIComponent(resolvedProjectId)}/locations/${encodeURIComponent(normalizedRegion)}/publishers/google/models/${encodeURIComponent(model)}:${responseType}`,
            headers,
        };
    }

    if (!apiKey) throw new Error('Vertex AI Express 模式需要 API Key');
    const resolvedProjectId = String(projectId || '').trim();
    const path = resolvedProjectId
        ? `/v1/projects/${encodeURIComponent(resolvedProjectId)}/locations/${encodeURIComponent(normalizedRegion)}/publishers/google/models/${encodeURIComponent(model)}:${responseType}`
        : `/v1/publishers/google/models/${encodeURIComponent(model)}:${responseType}`;
    return {
        url: `${resolvedProjectId ? 'https://aiplatform.googleapis.com' : baseUrl}${path}?key=${encodeURIComponent(apiKey)}`,
        headers,
    };
}

function parseVertexServiceAccount(serviceAccountJson = '') {
    let serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
        throw new Error('Service Account JSON 格式不正确');
    }
    if (serviceAccount?.type !== 'service_account') {
        throw new Error('Service Account JSON 的 type 必须是 service_account');
    }
    if (!serviceAccount.client_email || !serviceAccount.private_key) {
        throw new Error('Service Account JSON 缺少 client_email 或 private_key');
    }
    return serviceAccount;
}

async function getVertexAccessToken(serviceAccount, config = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(serviceAccount.private_key, 'base64url');
    const jwt = `${signatureInput}.${signature}`;
    const r = await fetchWithTimeout('https://oauth2.googleapis.com/token', withNetworkProxy({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    }, config));
    if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`Service Account 获取 Access Token 失败: ${text || r.status}`);
    }
    const data = await r.json();
    if (!data.access_token) throw new Error('Service Account 没有返回 Access Token');
    return data.access_token;
}

async function callAnthropic({ config = {}, apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, topK, tools, toolChoice, signal }) {
    const requestModel = model || DEFAULT_MODELS.anthropic;
    const body = { model: requestModel, max_tokens: maxTokens, temperature, top_p: topP, system: systemPrompt, messages };
    if (topK) body.top_k = topK;
    const anthropicTools = convertToolsToAnthropic(tools);
    if (anthropicTools.length) {
        body.tools = anthropicTools;
        if (toolChoice) body.tool_choice = convertToolChoiceToAnthropic(toolChoice);
    }
    const r = await fetchLoggedChat('https://api.anthropic.com/v1/messages', withNetworkProxy({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2024-02-15' },
        body: JSON.stringify(body),
        signal,
    }, config), { provider: 'anthropic', model: requestModel, mode: 'chat', stream: false });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `Anthropic ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    return convertAnthropicResponse(d);
}

async function callAnthropicStream({ config = {}, apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, topK, tools, toolChoice, signal, onEvent }) {
    const requestModel = model || DEFAULT_MODELS.anthropic;
    const body = { model: requestModel, max_tokens: maxTokens, temperature, top_p: topP, system: systemPrompt, messages, stream: true };
    if (topK) body.top_k = topK;
    const anthropicTools = convertToolsToAnthropic(tools);
    if (anthropicTools.length) {
        body.tools = anthropicTools;
        if (toolChoice) body.tool_choice = convertToolChoiceToAnthropic(toolChoice);
    }
    const r = await fetchLoggedChat('https://api.anthropic.com/v1/messages', withNetworkProxy({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2024-02-15' },
        body: JSON.stringify(body),
        signal,
    }, config), { provider: 'anthropic', model: requestModel, mode: 'chat', stream: true });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `Anthropic ${r.status}`); }

    let content = '';
    let reasoning = '';
    // Track tool_use blocks by content block index
    const toolUseBlocks = new Map();
    const streamEvents = await parseSseResponse(r, raw => {
        const event = parseJsonEvent(raw);
        if (!event) return;

        // --- content_block_start: detect tool_use blocks ---
        if (event.type === 'content_block_start') {
            const block = event.content_block || {};
            if (block.type === 'tool_use') {
                toolUseBlocks.set(event.index, {
                    id: block.id || '',
                    name: block.name || '',
                    inputJson: '',
                });
            }
            return;
        }

        // --- content_block_delta ---
        if (event.type === 'content_block_delta') {
            const deltaType = event.delta?.type || '';

            // Anthropic thinking delta
            const thinking = event.delta?.thinking || '';
            if (thinking) {
                reasoning += thinking;
                onEvent({ type: 'reasoning', content: thinking });
                return;
            }

            // Tool input JSON delta
            if (deltaType === 'input_json_delta') {
                const partialJson = event.delta?.partial_json || '';
                const block = toolUseBlocks.get(event.index);
                if (block) {
                    block.inputJson += partialJson;
                }
                return;
            }

            // Regular text delta
            const text = event.delta?.text || '';
            if (text) {
                content += text;
                onEvent({ type: 'chunk', content: text });
            }
        }
    });

    // Convert Anthropic tool_use blocks → OpenAI-format tool_calls
    const toolCalls = [...toolUseBlocks.values()]
        .filter(block => block.id && block.name)
        .map(block => ({
            id: block.id,
            type: 'function',
            function: {
                name: block.name,
                arguments: block.inputJson || '{}',
            },
        }));

    const message = {
        role: 'assistant',
        content,
        reasoning_content: reasoning,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
    await finalizeLoggedResponse(r, {
        response: {
            streamEvents,
            finalMessage: message,
        },
    });
    return { message, raw: streamEvents };
}

// ── Anthropic ↔ OpenAI format converters ──────────────────────

/**
 * Convert OpenAI-format tools to Anthropic native format.
 * OpenAI:  { type: "function", function: { name, description, parameters } }
 * Anthropic: { name, description, input_schema: parameters }
 */
function convertToolsToAnthropic(tools = []) {
    if (!Array.isArray(tools) || !tools.length) return [];
    return tools.map(tool => {
        const fn = tool.function || tool;
        const name = fn.name || tool.name || '';
        if (!name) return null;
        return {
            name,
            description: fn.description || tool.description || '',
            input_schema: fn.parameters || tool.parameters || tool.input_schema || { type: 'object', properties: {} },
        };
    }).filter(Boolean);
}

/**
 * Convert OpenAI-format tool_choice to Anthropic format.
 * "auto" / "any" / "none" / { type: "function", function: { name } }
 * → { type: "auto" } / { type: "any" } / undefined / { type: "tool", name }
 */
function convertToolChoiceToAnthropic(choice) {
    if (!choice || choice === 'auto') return { type: 'auto' };
    if (choice === 'any' || choice === 'required') return { type: 'any' };
    if (choice === 'none') return undefined;
    if (typeof choice === 'object') {
        const name = choice.function?.name || choice.name || '';
        if (name) return { type: 'tool', name };
    }
    return { type: 'auto' };
}

/**
 * Convert Anthropic response → OpenAI-compatible { message, raw }.
 * Anthropic content blocks: text → content string, tool_use → tool_calls[]
 */
function convertAnthropicResponse(apiData = {}) {
    const contentBlocks = Array.isArray(apiData.content) ? apiData.content : [];
    let content = '';
    const toolCalls = [];
    for (const block of contentBlocks) {
        if (block.type === 'text') {
            content += (block.text || '');
        } else if (block.type === 'tool_use') {
            toolCalls.push({
                id: block.id || '',
                type: 'function',
                function: {
                    name: block.name || '',
                    arguments: JSON.stringify(block.input || {}),
                },
            });
        } else if (block.type === 'thinking') {
            // Anthropic extended thinking — surface as reasoning_content
            const thinkingText = block.thinking || '';
            if (thinkingText) {
                // We append to a synthetic field; callAIChatRaw returns
                // this via .message so extractAssistantText can surface it.
                content += `[THINKING]\n${thinkingText}\n[/THINKING]\n\n`;
            }
        }
    }
    const message = {
        role: 'assistant',
        content,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
    return { message, raw: apiData };
}

async function callOpenAICompatible({ provider, apiKey, endpoint, model, systemPrompt, messages, temperature, maxTokens, topP, signal }) {
    const base = cleanBase(endpoint, provider);
    const requestModel = model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
    const r = await fetchLoggedChat(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: requestModel,
            max_tokens: maxTokens,
            temperature,
            top_p: topP,
            messages: prepareOpenAICompatibleMessages(provider, systemPrompt, messages),
        }),
        signal,
    }, { provider, model: requestModel, mode: 'chat', stream: false });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `${provider} ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    const message = d.choices?.[0]?.message;
    const content = message?.content || '';
    const reasoning = message?.reasoning_content || '';
    // DeepSeek: include reasoning content so the frontend can display it
    // Only throw if NEITHER content nor reasoning is present
    if (!content && !reasoning) {
        throw new Error(`Empty response from ${provider}`);
    }
    if (!content && reasoning) {
        // All tokens went to reasoning — still return the reasoning as content
        return '[REASONING]\n' + reasoning + '\n[/REASONING]\n\n*(思考过程结束，未生成正文。请调高 MaxTokens)*';
    }
    if (reasoning && provider === 'deepseek') {
        return '[REASONING]\n' + reasoning + '\n[/REASONING]\n\n' + content;
    }
    return content;
}

async function callOpenRouter({ apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, signal }) {
    const requestModel = model || DEFAULT_MODELS.openrouter;
    const r = await fetchLoggedChat(`${DEFAULT_ENDPOINTS.openrouter}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: requestModel,
            max_tokens: maxTokens,
            temperature,
            top_p: topP,
            messages: prepareOpenAICompatibleMessages('openrouter', systemPrompt, messages),
        }),
        signal,
    }, { provider: 'openrouter', model: requestModel, mode: 'chat', stream: false });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `OpenRouter ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    return d.choices?.[0]?.message?.content || '';
}

async function callOpenAICompatibleRaw({ config = {}, provider, apiKey, endpoint, model, systemPrompt, messages, temperature, maxTokens, topP, tools, toolChoice, signal }) {
    const base = cleanBase(endpoint, provider);
    const requestModel = model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
    const body = {
        model: requestModel,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        messages: prepareOpenAICompatibleMessages(provider, systemPrompt, messages),
    };
    if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
    }

    const r = await fetchLoggedChat(`${base}/chat/completions`, withNetworkProxy({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
    }, config), { provider, model: requestModel, mode: 'chat.raw', stream: false, toolChoice: body.tool_choice });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `${provider} ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    const message = d.choices?.[0]?.message;
    if (!message) throw new Error(`Empty response from ${provider}`);
    return { message, raw: d };
}

async function callOpenAICompatibleStream({ config = {}, provider, apiKey, endpoint, model, systemPrompt, messages, temperature, maxTokens, topP, tools, toolChoice, signal, onEvent }) {
    const base = cleanBase(endpoint, provider);
    const requestModel = model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
    const body = {
        model: requestModel,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        stream: true,
        messages: prepareOpenAICompatibleMessages(provider, systemPrompt, messages),
    };
    if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
    }

    const r = await fetchLoggedChat(`${base}/chat/completions`, withNetworkProxy({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
    }, config), { provider, model: requestModel, mode: 'chat.stream', stream: true, toolChoice: body.tool_choice });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `${provider} ${r.status}`); }
    return readOpenAICompatibleStream(r, onEvent);
}

async function callOpenRouterRaw({ config = {}, apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, tools, toolChoice, signal }) {
    const requestModel = model || DEFAULT_MODELS.openrouter;
    const body = {
        model: requestModel,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        messages: prepareOpenAICompatibleMessages('openrouter', systemPrompt, messages),
    };
    if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
    }

    const r = await fetchLoggedChat(`${DEFAULT_ENDPOINTS.openrouter}/chat/completions`, withNetworkProxy({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
    }, config), { provider: 'openrouter', model: requestModel, mode: 'chat.raw', stream: false, toolChoice: body.tool_choice });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `OpenRouter ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    const message = d.choices?.[0]?.message;
    if (!message) throw new Error('Empty response from OpenRouter');
    return { message, raw: d };
}

async function callOpenRouterStream({ config = {}, apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, tools, toolChoice, signal, onEvent }) {
    const requestModel = model || DEFAULT_MODELS.openrouter;
    const body = {
        model: requestModel,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        stream: true,
        messages: prepareOpenAICompatibleMessages('openrouter', systemPrompt, messages),
    };
    if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
    }

    const r = await fetchLoggedChat(`${DEFAULT_ENDPOINTS.openrouter}/chat/completions`, withNetworkProxy({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
    }, config), { provider: 'openrouter', model: requestModel, mode: 'chat.stream', stream: true, toolChoice: body.tool_choice });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `OpenRouter ${r.status}`); }
    return readOpenAICompatibleStream(r, onEvent);
}

async function readOpenAICompatibleStream(response, onEvent) {
    let content = '';
    let reasoning = '';
    const toolCallsByIndex = new Map();
    const streamEvents = await parseSseResponse(response, raw => {
        if (raw === '[DONE]') return;
        const event = parseJsonEvent(raw);
        const delta = event?.choices?.[0]?.delta || {};
        const thinking = delta.reasoning_content || delta.reasoning || '';
        const text = delta.content || '';
        if (Array.isArray(delta.tool_calls)) {
            mergeToolCallDeltas(toolCallsByIndex, delta.tool_calls);
        }
        if (thinking) {
            reasoning += thinking;
            onEvent({ type: 'reasoning', content: thinking });
        }
        if (text) {
            content += text;
            onEvent({ type: 'chunk', content: text });
        }
    });
    const toolCalls = [...toolCallsByIndex.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, call]) => call)
        .filter(call => call.id || call.function?.name);
    const message = {
        role: 'assistant',
        content,
        reasoning_content: reasoning,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
    await finalizeLoggedResponse(response, {
        response: {
            streamEvents,
            finalMessage: message,
        },
    });
    return { message, raw: streamEvents };
}

function mergeToolCallDeltas(target, deltas = []) {
    for (const delta of deltas) {
        const index = Number(delta.index || 0);
        const current = target.get(index) || {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
        };
        if (delta.id) current.id += delta.id;
        if (delta.type) current.type = delta.type;
        if (delta.function?.name) current.function.name += delta.function.name;
        if (delta.function?.arguments) current.function.arguments += delta.function.arguments;
        target.set(index, current);
    }
}

async function streamFallback(config, systemPrompt, messages, options, onEvent) {
    const result = await callAIChatRaw(config, systemPrompt, messages, options);
    const reasoning = result.message?.reasoning_content || '';
    const content = result.message?.content || '';
    if (reasoning) onEvent({ type: 'reasoning', content: reasoning });
    if (content) onEvent({ type: 'chunk', content });
    return result;
}

async function parseSseResponse(response, onData) {
    let buffer = '';
    const events = [];
    await readResponseBody(response, text => {
        buffer += text;
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            processSseBlock(block, raw => {
                events.push({ raw, parsed: parseJsonEvent(raw) });
                onData(raw);
            });
        }
    });
    if (buffer.trim()) {
        processSseBlock(buffer, raw => {
            events.push({ raw, parsed: parseJsonEvent(raw) });
            onData(raw);
        });
    }
    return events;
}

async function readResponseBody(response, onText) {
    const reader = response.body?.getReader?.();
    if (!reader) {
        onText(await response.text());
        return;
    }
    const decoder = new TextDecoder();
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        onText(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onText(tail);
}

function processSseBlock(block, onData) {
    const data = String(block)
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n');
    if (data) onData(data);
}

function parseJsonEvent(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function callOllama({ endpoint, model, systemPrompt, messages, temperature, maxTokens, topP, topK, signal }) {
    const base = (endpoint || 'http://localhost:11434').replace(/\/+$/, '');
    const requestModel = model || DEFAULT_MODELS.ollama;
    const prompt = `### System:\n${systemPrompt}\n\n### Conversation:\n${toText(messages)}\n\n### Assistant:\n`;
    const r = await fetchLoggedChat(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: requestModel, prompt, stream: false, options: { temperature, num_predict: maxTokens, top_p: topP, top_k: topK } }),
        signal,
    }, { provider: 'ollama', model: requestModel, mode: 'generate', stream: false });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error || `Ollama ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    return d.response || '';
}

export async function fetchModelList(config = {}) {
    const { provider, apiKey } = config;
    const base = providerEndpoint(config)?.replace(/\/+$/, '') || DEFAULT_ENDPOINTS[provider];
    if (!base && provider !== 'anthropic' && provider !== 'google' && provider !== 'google-vertex' && provider !== 'ollama') return [];

    if (provider === 'anthropic') {
        return [
            { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', contextLimit: 200000 },
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextLimit: 200000 },
            { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextLimit: 200000 },
            { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextLimit: 200000 },
        ];
    }

    if (provider === 'google') {
        const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, withNetworkProxy({}, config));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        return (d.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => ({
            id: m.name.replace('models/', ''),
            name: m.displayName || m.name,
            contextLimit: m.inputTokenLimit || m.maxInputTokens || 0,
        }));
    }

    if (provider === 'google-vertex') {
        return GOOGLE_VERTEX_MODELS;
    }

    if (provider === 'ollama') {
        const baseUrl = (config.endpoint || 'http://localhost:11434').replace(/\/+$/, '');
        const r = await fetchWithTimeout(`${baseUrl}/api/tags`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        // Try to get details for each model
        return await Promise.all((d.models || []).map(async (m) => {
            try {
                const dr = await fetchWithTimeout(`${baseUrl}/api/show`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: m.name }),
                });
                if (dr.ok) {
                    const dd = await dr.json();
                    const ctx = dd.model_info?.[Object.keys(dd.model_info || {})[0]]?.context_length
                        || dd.parameters?.num_ctx
                        || dd.model_info?.context_length
                        || 0;
                    return { id: m.name, name: m.name, contextLimit: ctx };
                }
            } catch {}
            return { id: m.name, name: m.name, contextLimit: 0 };
        }));
    }

    const headers = { 'Authorization': `Bearer ${apiKey}` };
    if (provider === 'openrouter') headers['HTTP-Referer'] = 'https://cuigengji.app';

    const r = await fetchWithTimeout(`${base}/models`, withNetworkProxy({ headers }, config));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const rawModels = (d.data || []).slice(0, provider === 'openrouter' ? 100 : undefined);

    // Try to enrich with per-model context info (batch, limited concurrency)
    const enriched = await enrichModelContexts(rawModels, base, headers, provider, config);
    return enriched;
}

/**
 * Try to get real context limits per model via API queries.
 * Runs in parallel with concurrency limit to avoid rate-limiting.
 */
async function enrichModelContexts(models, base, headers, _provider, config = {}) {
    const CONCURRENCY = 3;
    const MAX_PROBE = 20; // don't probe more than 20 models

    // Check if list response already has context info
    const hasContext = models.some(m => m.context_length || m.max_context_length || m.context_window);
    if (hasContext) {
        return models.map(m => ({
            id: m.id, name: m.name || m.id,
            contextLimit: m.context_length || m.max_context_length || m.context_window || 0,
        }));
    }

    // Probe individual models for context info (only top MAX_PROBE)
    const toProbe = models.slice(0, MAX_PROBE);
    const results = [];

    for (let i = 0; i < toProbe.length; i += CONCURRENCY) {
        const batch = toProbe.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map(async (m) => {
            const ctx = await probeModelContext(base, m.id, headers, config);
            return { id: m.id, name: m.name || m.id, contextLimit: ctx };
        }));
        results.push(...batchResults);
    }

    // Add remaining models without probing
    const remaining = models.slice(MAX_PROBE).map(m => ({
        id: m.id, name: m.name || m.id, contextLimit: 0,
    }));

    return [...results, ...remaining];
}

/**
 * Try to determine a model's context limit by querying the API.
 */
async function probeModelContext(base, modelId, headers, config = {}) {
    try {
        // Try models/{id} endpoint (supported by most OpenAI-compatible APIs)
        const r = await fetchWithTimeout(`${base}/models/${encodeURIComponent(modelId)}`, withNetworkProxy({ headers }, config));
        if (r.ok) {
            const info = await r.json();
            // Check various possible fields
            const ctx = info.context_length || info.max_context_length
                || info.context_window
                || info.data?.context_length || info.data?.max_context_length
                || 0;
            if (ctx) return ctx;
        }
    } catch {}

    // Fallback: try to infer from provider hostname
    try {
        const baseHost = new URL(base).hostname;
        if (baseHost.includes('deepseek')) return 1000000;
        if (baseHost.includes('openai')) return 128000;
        if (baseHost.includes('anthropic')) return 200000;
        if (baseHost.includes('google') || baseHost.includes('gemini')) return 1000000;
        if (baseHost.includes('siliconflow')) return 128000;
        if (baseHost.includes('moonshot') || baseHost.includes('kimi')) return 128000;
        if (baseHost.includes('qwen') || baseHost.includes('dashscope') || baseHost.includes('aliyun')) return 1000000;
        if (baseHost.includes('doubao') || baseHost.includes('volces')) return 128000;
        if (baseHost.includes('spark') || baseHost.includes('xf-yun')) return 128000;
        if (baseHost.includes('glm') || baseHost.includes('z.ai')) return 128000;
        if (baseHost.includes('minimax')) return 1000000;
        if (baseHost.includes('groq')) return 128000;
        if (baseHost.includes('mistral')) return 128000;
        if (baseHost.includes('x.ai')) return 128000;
        if (baseHost.includes('openrouter')) return 128000;
    } catch {}

    return 0;
}
