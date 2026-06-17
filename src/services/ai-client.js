const DEFAULT_ENDPOINTS = {
    openai: 'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    doubao: 'https://ark.cn-beijing.volces.com/api/v3',
    spark: 'https://spark-api-open.xf-yun.com/v1',
    siliconflow: 'https://api.siliconflow.cn/v1',
    groq: 'https://api.groq.com/openai/v1',
    mistral: 'https://api.mistral.ai/v1',
    xai: 'https://api.x.ai/v1',
    moonshot: 'https://api.moonshot.cn/v1',
    zai: 'https://api.z.ai/api/paas/v4',
    minimax: 'https://api.minimax.io/v1',
    openrouter: 'https://openrouter.ai/api/v1',
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
    siliconflow: 'deepseek-ai/DeepSeek-V3',
    groq: 'llama-3.3-70b-versatile',
    mistral: 'mistral-large-latest',
    xai: 'grok-2',
    moonshot: 'moonshot-v1-8k',
    zai: 'glm-4',
    minimax: 'abab6.5s-chat',
    openrouter: 'anthropic/claude-sonnet-4-6',
    ollama: 'llama3',
};

function cleanBase(endpoint, provider) {
    return (endpoint || DEFAULT_ENDPOINTS[provider] || DEFAULT_ENDPOINTS.openai).replace(/\/+$/, '');
}

function generationOptions(config = {}, options = {}) {
    const rawMax = options.maxTokens || config.maxTokens || 4096;
    // DeepSeek shares the output budget between reasoning and content.
    // To ensure there's room for both, double the raw value with a floor
    // of 8K, capped to avoid exceeding model context.
    let result = rawMax;
    if (config.provider === 'deepseek') {
        const ctxLimit = config.maxContext || 1000000;
        result = Math.min(Math.max(rawMax * 2, 8192), ctxLimit);
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

function toText(messages) {
    return messages.map(m => `### ${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content}`).join('\n\n');
}

function toGeminiContents(messages) {
    return messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }],
    }));
}

function normalizeMessages(systemPrompt, userPromptOrMessages) {
    if (Array.isArray(userPromptOrMessages)) {
        return userPromptOrMessages;
    }
    return [{ role: 'user', content: userPromptOrMessages || '' }];
}

function supportsNativeToolMessages(provider) {
    return ['openai', 'openrouter'].includes(provider);
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

export async function callAIText(config, systemPrompt, userPrompt, options = {}) {
    return callAIChat(config, systemPrompt, [{ role: 'user', content: userPrompt || '' }], options);
}

export async function callAIChat(config = {}, systemPrompt, messages, options = {}) {
    const { provider, apiKey, endpoint } = config;
    const model = config.model || DEFAULT_MODELS[provider];
    const { maxTokens, temperature, topP, topK } = generationOptions(config, options);
    const chatMessages = adaptMessagesForProvider(provider, normalizeMessages(systemPrompt, messages));

    switch (provider) {
        case 'anthropic':
            return callAnthropic({ apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, topK, signal: options.signal });
        case 'google':
            return callGoogle({ apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, signal: options.signal });
        case 'openrouter':
            return callOpenRouter({ apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, signal: options.signal });
        case 'ollama':
            return callOllama({ endpoint, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, topK, signal: options.signal });
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
            return callOpenAICompatible({ provider, apiKey, endpoint, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, signal: options.signal });
        default:
            throw new Error(`Unsupported: ${provider}`);
    }
}

async function callGoogle({ apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, signal }) {
    const body = {
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents: toGeminiContents(messages),
        generationConfig: { temperature, maxOutputTokens: maxTokens, topP },
    };
    const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model || DEFAULT_MODELS.google}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `Gemini ${r.status}`); }
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

async function callAnthropic({ apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, topK, signal }) {
    const body = { model: model || DEFAULT_MODELS.anthropic, max_tokens: maxTokens, temperature, top_p: topP, system: systemPrompt, messages };
    if (topK) body.top_k = topK;
    const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
        signal,
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `Anthropic ${r.status}`); }
    const d = await r.json();
    return d.content?.map(c => c.text || '').join('') || '';
}

async function callOpenAICompatible({ provider, apiKey, endpoint, model, systemPrompt, messages, temperature, maxTokens, topP, signal }) {
    const base = cleanBase(endpoint, provider);
    const r = await fetchWithTimeout(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai,
            max_tokens: maxTokens,
            temperature,
            top_p: topP,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
        }),
        signal,
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `${provider} ${r.status}`); }
    const d = await r.json();
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
    const r = await fetchWithTimeout(`${DEFAULT_ENDPOINTS.openrouter}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: model || DEFAULT_MODELS.openrouter,
            max_tokens: maxTokens,
            temperature,
            top_p: topP,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
        }),
        signal,
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `OpenRouter ${r.status}`); }
    const d = await r.json();
    return d.choices?.[0]?.message?.content || '';
}

async function callOllama({ endpoint, model, systemPrompt, messages, temperature, maxTokens, topP, topK, signal }) {
    const base = (endpoint || 'http://localhost:11434').replace(/\/+$/, '');
    const prompt = `### System:\n${systemPrompt}\n\n### Conversation:\n${toText(messages)}\n\n### Assistant:\n`;
    const r = await fetchWithTimeout(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || DEFAULT_MODELS.ollama, prompt, stream: false, options: { temperature, num_predict: maxTokens, top_p: topP, top_k: topK } }),
        signal,
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Ollama ${r.status}`); }
    const d = await r.json();
    return d.response || '';
}

export async function fetchModelList(config = {}) {
    const { provider, apiKey, endpoint } = config;
    const base = endpoint?.replace(/\/+$/, '') || DEFAULT_ENDPOINTS[provider];
    if (!base && provider !== 'anthropic' && provider !== 'google' && provider !== 'ollama') return [];

    if (provider === 'anthropic') {
        return [
            { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', contextLimit: 200000 },
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextLimit: 200000 },
            { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextLimit: 200000 },
            { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextLimit: 200000 },
        ];
    }

    if (provider === 'google') {
        const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        return (d.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => ({
            id: m.name.replace('models/', ''),
            name: m.displayName || m.name,
            contextLimit: m.inputTokenLimit || m.maxInputTokens || 0,
        }));
    }

    if (provider === 'ollama') {
        const baseUrl = (endpoint || 'http://localhost:11434').replace(/\/+$/, '');
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
    if (provider === 'openrouter') headers['HTTP-Referer'] = 'https://novel-ai-editor.app';

    const r = await fetchWithTimeout(`${base}/models`, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const rawModels = (d.data || []).slice(0, provider === 'openrouter' ? 100 : undefined);

    // Try to enrich with per-model context info (batch, limited concurrency)
    const enriched = await enrichModelContexts(rawModels, base, headers, provider);
    return enriched;
}

/**
 * Try to get real context limits per model via API queries.
 * Runs in parallel with concurrency limit to avoid rate-limiting.
 */
async function enrichModelContexts(models, base, headers, _provider) {
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
            const ctx = await probeModelContext(base, m.id, headers);
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
async function probeModelContext(base, modelId, headers) {
    try {
        // Try models/{id} endpoint (supported by most OpenAI-compatible APIs)
        const r = await fetchWithTimeout(`${base}/models/${encodeURIComponent(modelId)}`, { headers });
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
