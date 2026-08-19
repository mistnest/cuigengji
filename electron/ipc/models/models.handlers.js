import {
    detectProviderProxy,
    listProviderModels,
    testProviderConnection,
} from '../../../src/backend/intelligence/models/index.js';
import {
    AI_PROVIDER_IPC_CHANNELS,
    MODELS_INPUT_SCHEMAS,
} from '../../../shared/desktop-api/models/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

export function registerAiIpcHandlers({ ipcMain, getMainWindow }) {
    const handlers = new Map([
        [AI_PROVIDER_IPC_CHANNELS.listModels, createGuardedHandler(getMainWindow,
            listProviderModels, 'ai.listModels', MODELS_INPUT_SCHEMAS.listModels)],
        [AI_PROVIDER_IPC_CHANNELS.testConnection, createGuardedHandler(getMainWindow,
            testProviderConnection, 'ai.testConnection', MODELS_INPUT_SCHEMAS.testConnection)],
        [AI_PROVIDER_IPC_CHANNELS.detectProxy, createGuardedHandler(getMainWindow,
            detectProviderProxy, 'ai.detectProxy', MODELS_INPUT_SCHEMAS.detectProxy)],
    ]);
    return registerHandlers(ipcMain, handlers);
}
