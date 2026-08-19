import { buildReferenceToolInstruction as buildMemoryReferenceToolInstruction } from '../../memory-prompts.js';

export const REFERENCE_TOOL_NAMES = {
    SEARCH_REFERENCE: 'search_reference',
    GET_REFERENCE_DETAIL: 'get_reference_detail',
    GET_SCENE_CONTEXT: 'get_scene_context',
};

export function getReferenceToolDefinitions() {
    return [
        {
            type: 'function',
            function: {
                name: REFERENCE_TOOL_NAMES.SEARCH_REFERENCE,
                description: 'Search project reference material such as character cards, world book entries, chapter summaries, and scene context. Returns compact results only.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The character, setting, object, event, place, or scene information to search for.',
                        },
                        types: {
                            type: 'array',
                            description: 'Optional reference types to search.',
                            items: {
                                type: 'string',
                                enum: ['character', 'worldbook', 'chapter', 'memory', 'scene'],
                            },
                        },
                        limit: {
                            type: 'integer',
                            description: 'Maximum number of compact results to return.',
                            minimum: 1,
                            maximum: 12,
                        },
                    },
                    required: ['query'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: REFERENCE_TOOL_NAMES.GET_REFERENCE_DETAIL,
                description: 'Read detailed content for a reference id returned by search_reference.',
                parameters: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string',
                            description: 'Reference id, for example worldbook:12, character:Name, chapter:chapter-id, memory:key-event:3, or scene:current.',
                        },
                        maxTokens: {
                            type: 'integer',
                            description: 'Maximum approximate tokens to return.',
                            minimum: 128,
                            maximum: 4000,
                        },
                    },
                    required: ['id'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: REFERENCE_TOOL_NAMES.GET_SCENE_CONTEXT,
                description: 'Get the current writing scene: recent text, chapter title, nearby context, and optional outline/summary hints.',
                parameters: {
                    type: 'object',
                    properties: {
                        scope: {
                            type: 'string',
                            enum: ['current_tail', 'current_chapter', 'project_recent'],
                            description: 'How much scene context to retrieve.',
                        },
                        beforeChars: {
                            type: 'integer',
                            minimum: 200,
                            maximum: 12000,
                            description: 'Number of characters before the current writing point.',
                        },
                        includeOutline: {
                            type: 'boolean',
                            description: 'Whether to include unfinished outline hints.',
                        },
                        includeRecentSummary: {
                            type: 'boolean',
                            description: 'Whether to include recent chapter summaries and key events.',
                        },
                    },
                },
            },
        },
    ];
}

export function buildReferenceToolInstruction() {
    return buildMemoryReferenceToolInstruction();
}
