'use strict';

const SETTINGS_IPC_CHANNELS = Object.freeze({
    secretStatus: 'cgj:v1:settings:secret-status',
    saveSecret: 'cgj:v1:settings:save-secret',
    deleteSecret: 'cgj:v1:settings:delete-secret',
    getPreferences: 'cgj:v1:settings:get-preferences',
    updatePreferences: 'cgj:v1:settings:update-preferences',
});
const PRESET_IPC_CHANNELS = Object.freeze({ save: 'cgj:v1:presets:save' });

function createConfigurationFacade(invoke) {
    const preferences = Object.freeze({
        get: () => invoke(SETTINGS_IPC_CHANNELS.getPreferences),
        update: patch => invoke(SETTINGS_IPC_CHANNELS.updatePreferences, { patch }),
    });
    const presets = Object.freeze({
        save: (projectId, name, data) => invoke(PRESET_IPC_CHANNELS.save, {
            projectId, name, data,
        }),
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
