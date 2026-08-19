import {
    deleteAiSecret,
    hasAiSecret,
    saveAiSecret,
} from '../../../src/backend/foundation/configuration/index.js';
import {
    getPreferences,
    updatePreferences,
} from '../../../src/backend/foundation/configuration/index.js';
import {
    CONFIGURATION_INPUT_SCHEMAS,
    SETTINGS_IPC_CHANNELS,
} from '../../../shared/desktop-api/configuration/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

export function registerSettingsIpcHandlers({ ipcMain, getMainWindow, onSecretChanged }) {
    const handlers = new Map([
        [SETTINGS_IPC_CHANNELS.secretStatus, createGuardedHandler(getMainWindow,
            input => ({ hasKey: hasAiSecret(input?.provider, input?.profile) }),
            'settings.secretStatus', CONFIGURATION_INPUT_SCHEMAS.secretStatus)],
        [SETTINGS_IPC_CHANNELS.saveSecret, createGuardedHandler(getMainWindow,
            input => {
                const saved = saveAiSecret({
                    provider: input?.provider,
                    apiKey: input?.secret,
                    profile: input?.profile,
                });
                onSecretChanged?.(input?.provider, input?.profile);
                return { saved, hasKey: true };
            }, 'settings.saveSecret', CONFIGURATION_INPUT_SCHEMAS.saveSecret)],
        [SETTINGS_IPC_CHANNELS.deleteSecret, createGuardedHandler(getMainWindow,
            input => {
                const result = deleteAiSecret(input?.provider, input?.profile);
                onSecretChanged?.(input?.provider, input?.profile);
                return result;
            },
            'settings.deleteSecret', CONFIGURATION_INPUT_SCHEMAS.deleteSecret)],
        [SETTINGS_IPC_CHANNELS.getPreferences, createGuardedHandler(getMainWindow,
            getPreferences, 'settings.getPreferences', CONFIGURATION_INPUT_SCHEMAS.getPreferences)],
        [SETTINGS_IPC_CHANNELS.updatePreferences, createGuardedHandler(getMainWindow,
            input => updatePreferences(input?.patch), 'settings.updatePreferences',
            CONFIGURATION_INPUT_SCHEMAS.updatePreferences)],
    ]);
    return registerHandlers(ipcMain, handlers);
}
