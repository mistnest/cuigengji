import { defineObjectSchema } from '../core/schema.js';

export const MODELS_INPUT_SCHEMAS = Object.freeze({
    listModels: defineObjectSchema('models.catalog.list', {
        config: { type: 'object', required: true },
        profile: { type: 'string', maxLength: 200 },
    }),
    testConnection: defineObjectSchema('models.connection.test', {
        config: { type: 'object', required: true },
        profile: { type: 'string', maxLength: 200 },
    }),
    detectProxy: defineObjectSchema('models.connection.detectProxy', {}, {
        allowUndefined: true,
    }),
});
