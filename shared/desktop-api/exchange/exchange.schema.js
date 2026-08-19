import { defineObjectSchema } from '../core/schema.js';

const projectId = { type: 'string', required: true, maxLength: 200 };
export const EXCHANGE_INPUT_SCHEMAS = Object.freeze({
    selectDocument: defineObjectSchema('exchange.imports.document', {
        projectId: { type: 'string', maxLength: 200 },
        autoSplit: { type: 'boolean' }, volumeId: { type: 'string', maxLength: 200 },
    }, { allowUndefined: true }),
    selectFolder: defineObjectSchema('exchange.imports.folder', { projectId }),
    selectWorldBook: defineObjectSchema('exchange.imports.worldbook', { projectId }),
    selectCharacters: defineObjectSchema('exchange.imports.characters', { projectId }),
    selectPreset: defineObjectSchema('exchange.imports.preset', { projectId }),
    saveText: defineObjectSchema('exchange.exports.text', {
        suggestedName: { type: 'string', required: true, maxLength: 500 },
        content: { type: 'string', required: true, maxLength: 10_000_000 },
    }),
    saveJson: defineObjectSchema('exchange.exports.json', {
        suggestedName: { type: 'string', required: true, maxLength: 500 },
        data: { type: 'object', required: true },
    }),
});
