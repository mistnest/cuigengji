import { defineObjectSchema } from '../core/schema.js';

export const CONFIGURATION_INPUT_SCHEMAS = Object.freeze({
    secretStatus: defineObjectSchema('configuration.secrets.status', {
        provider: { type: 'string', required: true, maxLength: 100 },
        profile: { type: 'string', maxLength: 200 },
    }),
    saveSecret: defineObjectSchema('configuration.secrets.save', {
        provider: { type: 'string', required: true, maxLength: 100 },
        profile: { type: 'string', maxLength: 200 },
        secret: { type: 'string', required: true, maxLength: 50_000 },
    }),
    deleteSecret: defineObjectSchema('configuration.secrets.delete', {
        provider: { type: 'string', required: true, maxLength: 100 },
        profile: { type: 'string', maxLength: 200 },
    }),
    getPreferences: defineObjectSchema('configuration.preferences.get', {}, {
        allowUndefined: true,
    }),
    updatePreferences: defineObjectSchema('configuration.preferences.update', {
        patch: { type: 'object', required: true },
    }),
    savePreset: defineObjectSchema('configuration.presets.save', {
        projectId: { type: 'string', required: true, maxLength: 200 },
        name: { type: 'string', required: true, maxLength: 500 },
        data: { type: 'object', required: true },
    }),
});
