'use strict';

const AI_PROVIDER_IPC_CHANNELS = Object.freeze({
    listModels: 'cgj:v1:ai:list-models',
    testConnection: 'cgj:v1:ai:test-connection',
    detectProxy: 'cgj:v1:ai:detect-proxy',
});

function createModelsFacade(invoke) {
    const catalog = Object.freeze({
        list: (config, profile) => invoke(AI_PROVIDER_IPC_CHANNELS.listModels, {
            config, profile,
        }),
    });
    const connection = Object.freeze({
        test: (config, profile) => invoke(AI_PROVIDER_IPC_CHANNELS.testConnection, {
            config, profile,
        }),
        detectProxy: () => invoke(AI_PROVIDER_IPC_CHANNELS.detectProxy),
    });
    const providers = Object.freeze({ catalog, connection });
    return Object.freeze({ providers, catalog, connection });
}
