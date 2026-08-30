export const TOOL_CAPABLE_PROVIDERS = new Set([
    'openai',
    'openrouter',
    'deepseek',
    'qwen',
    'doubao',
    'siliconflow',
    'groq',
    'mistral',
    'xai',
    'moonshot',
    'zai',
    'minimax',
    'custom',
]);

export function isReferenceToolProvider(provider = '') {
    return TOOL_CAPABLE_PROVIDERS.has(String(provider || '').toLowerCase());
}

export function shouldEnableReferenceTools(config = {}) {
    // The context strategy is no longer user-selectable.  Tool-capable
    // providers receive bounded read-only lookup tools; other providers use
    // the same hot snapshot without tools.  Old preset flags are ignored.
    return isReferenceToolProvider(config.provider);
}
