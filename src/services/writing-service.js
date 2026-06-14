import { callAIChat } from './ai-client.js';
import { buildWritingContext } from './context-orchestrator.js';

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
    const prompt = await buildWritingContext({
        message,
        history,
        context,
        config,
        promptTemplates,
        promptOrder,
    });
    onPromptBuilt?.(prompt);
    const reply = await callAIChat(config, prompt.systemPrompt, prompt.messages, { signal });
    return {
        reply,
        prompt,
        context: summarizeContext(prompt.debug),
        memory: summarizeMemory(prompt.debug),
    };
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
