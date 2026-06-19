import {
    buildReferenceToolInstruction,
    getReferenceToolDefinitions,
    REFERENCE_TOOL_NAMES,
} from './schemas.js';
import {
    buildReferenceStore,
    getStoreDetail,
    getStoreSceneContext,
    searchStore,
} from './reference-store.js';

export {
    buildReferenceToolInstruction,
    getReferenceToolDefinitions,
    REFERENCE_TOOL_NAMES,
};

export async function executeReferenceTool(name, args = {}, runtime = {}) {
    const store = await buildReferenceStore(runtime);
    switch (name) {
        case REFERENCE_TOOL_NAMES.SEARCH_REFERENCE:
            return searchStore(store, args);
        case REFERENCE_TOOL_NAMES.GET_REFERENCE_DETAIL:
            return getStoreDetail(store, args);
        case REFERENCE_TOOL_NAMES.GET_SCENE_CONTEXT:
            return getStoreSceneContext(store, args);
        default:
            return { error: `Unknown reference tool: ${name}` };
    }
}

export function parseToolArguments(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch (err) {
        return { _parseError: err.message, _raw: String(raw) };
    }
}

export function summarizeToolResult(result) {
    if (!result || typeof result !== 'object') return { type: typeof result };
    if (Array.isArray(result.results)) {
        return {
            resultCount: result.results.length,
            ids: result.results.map(item => item.id).slice(0, 8),
        };
    }
    if (result.id || result.type || result.title) {
        return {
            id: result.id,
            type: result.type,
            title: result.title,
            contentLength: String(result.content || result.beforeText || '').length,
            truncated: Boolean(result.truncated),
        };
    }
    if (result.error) return { error: result.error };
    return { keys: Object.keys(result).slice(0, 12) };
}
