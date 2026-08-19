import { defineObjectSchema } from '../core/schema.js';

const projectId = { type: 'string', required: true, maxLength: 200 };
export const KNOWLEDGE_INPUT_SCHEMAS = Object.freeze({
    listWorldBooks: defineObjectSchema('knowledge.worldbooks.list', { projectId }),
    getWorldBook: defineObjectSchema('knowledge.worldbooks.get', {
        projectId, name: { type: 'string', required: true, maxLength: 500 },
    }),
    saveWorldBook: defineObjectSchema('knowledge.worldbooks.save', {
        projectId,
        name: { type: 'string', required: true, maxLength: 500 },
        data: { type: 'object', required: true },
    }),
    updateWorldBookEntry: defineObjectSchema('knowledge.worldbooks.updateEntry', {
        projectId,
        bookName: { type: 'string', required: true, maxLength: 500 },
        uid: { types: ['string', 'number'], required: true },
        entry: { type: 'object', required: true },
    }),
    listCharacters: defineObjectSchema('knowledge.characters.list', { projectId }),
    saveCharacter: defineObjectSchema('knowledge.characters.save', {
        projectId, data: { type: 'object', required: true },
    }),
});
