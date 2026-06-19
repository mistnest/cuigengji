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

export function shouldEnableReferenceTools(config = {}, _context = {}, compactReference = false) {
    if (config.referenceTools === false || config.enableReferenceTools === false) return false;
    if (!isReferenceToolProvider(config.provider)) return false;

    const explicitlyEnabled = config.referenceTools === true || config.enableReferenceTools === true;
    return explicitlyEnabled || Boolean(compactReference);
}
