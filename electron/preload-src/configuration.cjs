'use strict';

const SETTINGS_IPC_CHANNELS = Object.freeze({
    secretStatus: 'cgj:v1:settings:secret-status',
    saveSecret: 'cgj:v1:settings:save-secret',
    deleteSecret: 'cgj:v1:settings:delete-secret',
    getPreferences: 'cgj:v1:settings:get-preferences',
    updatePreferences: 'cgj:v1:settings:update-preferences',
});
const PRESET_IPC_CHANNELS = Object.freeze({ save: 'cgj:v1:presets:save' });

function createConfigurationFacade(input) {
    const invoke = typeof input === 'function' ? input : input.invoke;
    const actorId = typeof input === 'object' ? input.actorId : '';
    const writePayload = value => ({ ...value, ...(actorId ? { clientId: actorId } : {}) });
    const preferences = Object.freeze({
        get: () => invoke(SETTINGS_IPC_CHANNELS.getPreferences),
        update: patch => invoke(SETTINGS_IPC_CHANNELS.updatePreferences, { patch }),
    });
    const presets = Object.freeze({
        save: (projectId, name, data, options = {}) => invoke(PRESET_IPC_CHANNELS.save, writePayload({
            projectId,
            name,
            data,
            expectedRevision: options.expectedRevision,
            expectedContentHash: options.expectedContentHash,
        })),
    });
    const secrets = Object.freeze({
        status: (provider, profile) => invoke(SETTINGS_IPC_CHANNELS.secretStatus, {
            provider, profile,
        }),
        save: (provider, profile, secret) => invoke(SETTINGS_IPC_CHANNELS.saveSecret, {
            provider, profile, secret,
        }),
        delete: (provider, profile) => invoke(SETTINGS_IPC_CHANNELS.deleteSecret, {
            provider, profile,
        }),
    });
    return Object.freeze({ preferences, presets, secrets });
}
