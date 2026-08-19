import { defineObjectSchema } from '../core/schema.js';

export const APP_INPUT_SCHEMAS = Object.freeze({
    bootstrap: defineObjectSchema('app.bootstrap', {}, { allowUndefined: true }),
    getVersion: defineObjectSchema('app.getVersion', {}, { allowUndefined: true }),
    openExternal: defineObjectSchema('app.openExternal', {
        url: { type: 'string', required: true, maxLength: 2_000 },
    }),
});
