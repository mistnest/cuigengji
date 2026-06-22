import { createApiCallId, logApiCall } from './api-call-logger.js';

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
    // of 8K. Cap at DeepSeek's hard max_tokens limit (393216) to avoid
    // API validation errors.
    let result = rawMax;
    if (config.provider === 'deepseek') {
        result = Math.min(Math.max(rawMax * 2, 8192), 262144);
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
            return callAnthropic({ apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, topK, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal });
        case 'google':
            return textResult(await callGoogle({ apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, signal: options.signal }));
        case 'openrouter':
            return callOpenRouterRaw({ apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal });
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
            return callOpenAICompatibleRaw({ provider, apiKey, endpoint, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal });
        default:
            throw new Error(`Unsupported: ${provider}`);
    }
}

export async function streamAIChat(config = {}, systemPrompt, messages, options = {}) {
    const { provider, apiKey, endpoint } = config;
    const model = config.model || DEFAULT_MODELS[provider];
    const { maxTokens, temperature, topP, topK } = generationOptions(config, options);
    const chatMessages = adaptMessagesForProvider(provider, normalizeMessages(systemPrompt, messages));
    const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};

    switch (provider) {
        case 'anthropic':
            return callAnthropicStream({ apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, topK, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal, onEvent });
        case 'openrouter':
            return callOpenRouterStream({ apiKey, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal, onEvent });
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
            return callOpenAICompatibleStream({ provider, apiKey, endpoint, model, systemPrompt, messages: chatMessages, temperature, maxTokens, topP, tools: options.tools, toolChoice: options.toolChoice, signal: options.signal, onEvent });
        case 'google':
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

async function callGoogle({ apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, signal }) {
    const requestModel = model || DEFAULT_MODELS.google;
    const body = {
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents: toGeminiContents(messages),
        generationConfig: { temperature, maxOutputTokens: maxTokens, topP },
    };
    const r = await fetchLoggedChat(`https://generativelanguage.googleapis.com/v1beta/models/${requestModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    }, { provider: 'google', model: requestModel, mode: 'chat', stream: false });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `Gemini ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    return d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

async function callAnthropic({ apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, topK, tools, toolChoice, signal }) {
    const requestModel = model || DEFAULT_MODELS.anthropic;
    const body = { model: requestModel, max_tokens: maxTokens, temperature, top_p: topP, system: systemPrompt, messages };
    if (topK) body.top_k = topK;
    const anthropicTools = convertToolsToAnthropic(tools);
    if (anthropicTools.length) {
        body.tools = anthropicTools;
        if (toolChoice) body.tool_choice = convertToolChoiceToAnthropic(toolChoice);
    }
    const r = await fetchLoggedChat('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2024-02-15' },
        body: JSON.stringify(body),
        signal,
    }, { provider: 'anthropic', model: requestModel, mode: 'chat', stream: false });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `Anthropic ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    return convertAnthropicResponse(d);
}

async function callAnthropicStream({ apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, topK, tools, toolChoice, signal, onEvent }) {
    const requestModel = model || DEFAULT_MODELS.anthropic;
    const body = { model: requestModel, max_tokens: maxTokens, temperature, top_p: topP, system: systemPrompt, messages, stream: true };
    if (topK) body.top_k = topK;
    const anthropicTools = convertToolsToAnthropic(tools);
    if (anthropicTools.length) {
        body.tools = anthropicTools;
        if (toolChoice) body.tool_choice = convertToolChoiceToAnthropic(toolChoice);
    }
    const r = await fetchLoggedChat('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2024-02-15' },
        body: JSON.stringify(body),
        signal,
    }, { provider: 'anthropic', model: requestModel, mode: 'chat', stream: true });
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
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
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
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
        }),
        signal,
    }, { provider: 'openrouter', model: requestModel, mode: 'chat', stream: false });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `OpenRouter ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    return d.choices?.[0]?.message?.content || '';
}

async function callOpenAICompatibleRaw({ provider, apiKey, endpoint, model, systemPrompt, messages, temperature, maxTokens, topP, tools, toolChoice, signal }) {
    const base = cleanBase(endpoint, provider);
    const requestModel = model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
    const body = {
        model: requestModel,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
    };
    if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
    }

    const r = await fetchLoggedChat(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
    }, { provider, model: requestModel, mode: 'chat.raw', stream: false, toolChoice: body.tool_choice });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `${provider} ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    const message = d.choices?.[0]?.message;
    if (!message) throw new Error(`Empty response from ${provider}`);
    return { message, raw: d };
}

async function callOpenAICompatibleStream({ provider, apiKey, endpoint, model, systemPrompt, messages, temperature, maxTokens, topP, tools, toolChoice, signal, onEvent }) {
    const base = cleanBase(endpoint, provider);
    const requestModel = model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
    const body = {
        model: requestModel,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        stream: true,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
    };
    if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
    }

    const r = await fetchLoggedChat(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
    }, { provider, model: requestModel, mode: 'chat.stream', stream: true, toolChoice: body.tool_choice });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `${provider} ${r.status}`); }
    return readOpenAICompatibleStream(r, onEvent);
}

async function callOpenRouterRaw({ apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, tools, toolChoice, signal }) {
    const requestModel = model || DEFAULT_MODELS.openrouter;
    const body = {
        model: requestModel,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
    };
    if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
    }

    const r = await fetchLoggedChat(`${DEFAULT_ENDPOINTS.openrouter}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
    }, { provider: 'openrouter', model: requestModel, mode: 'chat.raw', stream: false, toolChoice: body.tool_choice });
    if (!r.ok) { const e = await readLoggedError(r); throw new Error(e.error?.message || `OpenRouter ${r.status}`); }
    const d = await readLoggedJsonResponse(r);
    const message = d.choices?.[0]?.message;
    if (!message) throw new Error('Empty response from OpenRouter');
    return { message, raw: d };
}

async function callOpenRouterStream({ apiKey, model, systemPrompt, messages, temperature, maxTokens, topP, tools, toolChoice, signal, onEvent }) {
    const requestModel = model || DEFAULT_MODELS.openrouter;
    const body = {
        model: requestModel,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        stream: true,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
    };
    if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
    }

    const r = await fetchLoggedChat(`${DEFAULT_ENDPOINTS.openrouter}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
    }, { provider: 'openrouter', model: requestModel, mode: 'chat.stream', stream: true, toolChoice: body.tool_choice });
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
    if (provider === 'openrouter') headers['HTTP-Referer'] = 'https://cuigengji.app';

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
