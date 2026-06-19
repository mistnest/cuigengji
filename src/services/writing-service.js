import { callAIChat, callAIChatRaw, streamAIChat } from './ai-client.js';
import { buildWritingContext } from './context-orchestrator.js';
import {
    executeReferenceTool,
    getReferenceToolDefinitions,
    parseToolArguments,
    summarizeToolResult,
} from './ai-tools/reference/index.js';
import { applyWritingOutputGuard } from './writing-output-guard.js';

const MAX_REFERENCE_TOOL_ROUNDS = 4;
const MAX_REFERENCE_TOOL_CALLS = 8;

export async function generateWriting({
    message,
    history = [],
    context = {},
    config = {},
    promptTemplates = [],
    promptOrder = [],
    signal,
    onPromptBuilt,
} = {}) {
    const cleanHistory = sanitizeWritingHistory(history, promptTemplates);
    const prompt = await buildWritingContext({
        message,
        history: cleanHistory,
        context,
        config,
        promptTemplates,
        promptOrder,
    });
    const toolState = normalizePromptToolState(prompt);
    const toolEnabled = toolState.enabled;
    const promptForCall = prompt;
    const generated = toolEnabled
        ? await callWithReferenceTools({
            config,
            prompt: promptForCall,
            tools: toolState.definitions,
            message,
            history: cleanHistory,
            context,
            signal,
        })
        : { reply: await callAIChat(config, promptForCall.systemPrompt, promptForCall.messages, { signal }), toolTrace: [] };
    const guarded = applyWritingOutputGuard(generated.reply, { promptTemplates });
    const debugPrompt = {
        ...promptForCall,
        debug: {
            ...promptForCall.debug,
            tools: {
                enabled: toolEnabled,
                available: toolState.available,
                trace: generated.toolTrace,
            },
            outputGuard: guarded.debug,
        },
    };
    onPromptBuilt?.({
        ...debugPrompt,
    });
    return {
        reply: guarded.reply,
        prompt: debugPrompt,
        context: summarizeContext(prompt.debug),
        memory: summarizeMemory(prompt.debug),
    };
}

export async function generateWritingStream({
    message,
    history = [],
    context = {},
    config = {},
    promptTemplates = [],
    promptOrder = [],
    signal,
    onPromptBuilt,
    onEvent,
} = {}) {
    const cleanHistory = sanitizeWritingHistory(history, promptTemplates);
    const prompt = await buildWritingContext({
        message,
        history: cleanHistory,
        context,
        config,
        promptTemplates,
        promptOrder,
    });
    const toolState = normalizePromptToolState(prompt);
    const toolEnabled = toolState.enabled;
    const promptForCall = prompt;
    const generated = toolEnabled
        ? await callWithReferenceToolsStream({
            config,
            prompt: promptForCall,
            tools: toolState.definitions,
            message,
            history: cleanHistory,
            context,
            signal,
            onEvent,
        })
        : await streamDirectWriting({
            config,
            prompt: promptForCall,
            signal,
            onEvent,
        });
    const guarded = applyWritingOutputGuard(generated.reply, { promptTemplates });
    const debugPrompt = {
        ...promptForCall,
        debug: {
            ...promptForCall.debug,
            tools: {
                enabled: toolEnabled,
                available: toolState.available,
                trace: generated.toolTrace,
            },
            outputGuard: guarded.debug,
        },
    };
    onPromptBuilt?.(debugPrompt);
    return {
        reply: guarded.reply,
        prompt: debugPrompt,
        context: summarizeContext(prompt.debug),
        memory: summarizeMemory(prompt.debug),
    };
}

function sanitizeWritingHistory(history = [], promptTemplates = []) {
    const cleaned = [];
    for (const message of history || []) {
        if (!['user', 'assistant'].includes(message?.role)) continue;
        const content = String(message.content || '').trim();
        if (!content) continue;
        if (message.role === 'assistant' && isAssistantErrorContent(content)) continue;

        const normalized = message.role !== 'assistant'
            ? { role: message.role, content }
            : sanitizeAssistantWritingMessage(message, promptTemplates);

        if (!normalized.content) continue;
        const last = cleaned[cleaned.length - 1];
        if (last?.role === normalized.role && last.content === normalized.content) continue;
        cleaned.push(normalized);
    }
    return cleaned;
}

function sanitizeAssistantWritingMessage(message = {}, promptTemplates = []) {
        const guarded = applyWritingOutputGuard(message.content || '', { promptTemplates });
        return {
            role: 'assistant',
            content: String(guarded.reply || '').trim(),
        };
}

function isAssistantErrorContent(content = '') {
    const text = String(content || '');
    return text.startsWith('❌')
        || text.includes('API key required')
        || text.includes('请先配置 API Key')
        || text.includes('Stream error')
        || text.includes('HTTP 4')
        || text.includes('HTTP 5');
}

function normalizePromptToolState(prompt = {}) {
    const definitions = Array.isArray(prompt.referenceTools?.definitions)
        ? prompt.referenceTools.definitions
        : (Array.isArray(prompt.tools) ? prompt.tools : []);
    const enabled = Boolean(prompt.referenceTools?.enabled && definitions.length);
    const available = Array.isArray(prompt.referenceTools?.available)
        ? prompt.referenceTools.available
        : definitions.map(tool => tool.function?.name).filter(Boolean);

    return { enabled, definitions, available };
}

async function callWithReferenceTools({ config, prompt, tools = getReferenceToolDefinitions(), message, history, context, signal }) {
    const toolTrace = [];
    const messages = [...prompt.messages];
    const runtime = { message, history, context };
    for (let round = 0; round < MAX_REFERENCE_TOOL_ROUNDS; round++) {
        const response = await callAIChatRaw(config, prompt.systemPrompt, messages, {
            signal,
            tools,
            toolChoice: 'auto',
        });
        const toolCalls = response.message?.tool_calls || [];
        if (!toolCalls.length) return { reply: assistantText(config, response.message), toolTrace };
        await appendReferenceToolResults({ messages, toolCalls, runtime, toolTrace });
        if (toolTrace.length >= MAX_REFERENCE_TOOL_CALLS) break;
    }

    messages.push({
        role: 'system',
        content: 'Reference lookup is complete. Do not request more tools. Write the final response now in the requested output format.',
    });
    const final = await callAIChatRaw(config, prompt.systemPrompt, messages, {
        signal,
        tools,
        toolChoice: 'none',
    });
    return { reply: assistantText(config, final.message), toolTrace };
}

async function streamDirectWriting({ config, prompt, signal, onEvent }) {
    const result = await streamAIChat(config, prompt.systemPrompt, prompt.messages, {
        signal,
        onEvent,
    });
    return { reply: messageContent(result.message), toolTrace: [] };
}

async function callWithReferenceToolsStream({ config, prompt, tools = getReferenceToolDefinitions(), message, history, context, signal, onEvent }) {
    const toolTrace = [];
    const messages = [...prompt.messages];
    const runtime = { message, history, context };
    for (let round = 0; round < MAX_REFERENCE_TOOL_ROUNDS; round++) {
        const response = await callAIChatRaw(config, prompt.systemPrompt, messages, {
            signal,
            tools,
            toolChoice: 'auto',
        });
        const toolCalls = response.message?.tool_calls || [];
        if (!toolCalls.length) {
            if (!toolTrace.length) return { reply: emitAssistantMessage(response.message, onEvent), toolTrace };
            const final = await streamReferenceFinal({ config, prompt, messages, tools, signal, onEvent });
            return { reply: messageContent(final.message), toolTrace };
        }
        await appendReferenceToolResults({ messages, toolCalls, runtime, toolTrace });
        if (toolTrace.length >= MAX_REFERENCE_TOOL_CALLS) break;
    }

    messages.push({
        role: 'system',
        content: 'Reference lookup is complete. Do not request more tools. Write the final response now in the requested output format.',
    });
    const final = await streamAIChat(config, prompt.systemPrompt, messages, {
        signal,
        tools,
        toolChoice: 'none',
        onEvent,
    });
    return { reply: messageContent(final.message), toolTrace };
}

function streamReferenceFinal({ config, prompt, messages, tools, signal, onEvent }) {
    return streamAIChat(config, prompt.systemPrompt, messages, {
        signal,
        tools,
        toolChoice: 'none',
        onEvent,
    });
}

async function appendReferenceToolResults({ messages, toolCalls = [], runtime, toolTrace }) {
    messages.push({
        role: 'assistant',
        content: '',
        tool_calls: toolCalls,
    });

    const remaining = Math.max(0, MAX_REFERENCE_TOOL_CALLS - toolTrace.length);
    for (const call of toolCalls.slice(0, remaining)) {
        const name = call.function?.name || '';
        const args = parseToolArguments(call.function?.arguments);
        const result = await executeReferenceTool(name, args, runtime);
        toolTrace.push({
            id: call.id,
            name,
            args,
            result: summarizeToolResult(result),
        });
        messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name,
            content: JSON.stringify(result),
        });
    }
}

function emitAssistantMessage(message = {}, onEvent) {
    const content = messageContent(message);
    const reasoning = message?.reasoning_content || '';
    if (reasoning) onEvent?.({ type: 'reasoning', content: reasoning });
    if (content) onEvent?.({ type: 'chunk', content });
    return content;
}

function messageContent(message = {}) {
    return message?.content || '';
}

function assistantText(config = {}, message = {}) {
    const content = message?.content || '';
    const reasoning = message?.reasoning_content || '';
    if (!content && reasoning) {
        return '[REASONING]\n' + reasoning + '\n[/REASONING]\n\n*(鎬濊€冭繃绋嬬粨鏉燂紝鏈敓鎴愭鏂囥€傝璋冮珮 MaxTokens)*';
    }
    if (reasoning && config.provider === 'deepseek') {
        return '[REASONING]\n' + reasoning + '\n[/REASONING]\n\n' + content;
    }
    return content;
}

export function summarizeContext(debug = {}) {
    const used = Object.values(debug.layers || {})
        .reduce((total, layer) => total + Number(layer.tokens || 0), 0);
    return { used, totalBudget: debug.inputBudget || 0 };
}

export function summarizeMemory(debug = {}) {
    const seen = new Set();
    const activeEntries = [];
    for (const layer of Object.values(debug.layers || {})) {
        for (const item of layer?.selected || []) {
            const key = `${item.type}:${item.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            activeEntries.push({ label: item.label || item.id, type: item.type });
        }
    }
    return {
        stats: debug.activeMemoryStats || {},
        activeEntries,
    };
}
