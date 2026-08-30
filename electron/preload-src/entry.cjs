'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = createInvoke(ipcRenderer);
const rendererClientId = `renderer-${globalThis.crypto?.randomUUID?.()
    || Math.random().toString(36).slice(2)}`;
const appFacade = createAppFacade({ invoke, ipcRenderer });
const projectFacade = createProjectFacade({ invoke, ipcRenderer, actorId: rendererClientId });
const knowledgeFacade = createKnowledgeFacade({ invoke, actorId: rendererClientId });
const configurationFacade = createConfigurationFacade({ invoke, actorId: rendererClientId });
const modelsFacade = createModelsFacade(invoke);
const agentFacade = createAgentFacade({ invoke, ipcRenderer });
const automationFacade = createAutomationFacade(invoke);
const exchangeFacade = createExchangeFacade({ invoke, actorId: rendererClientId });

contextBridge.exposeInMainWorld('cuigengji', Object.freeze({
    version: DESKTOP_API_VERSION,
    app: appFacade,
    project: projectFacade,
    knowledge: knowledgeFacade,
    configuration: configurationFacade,
    models: modelsFacade,
    agent: agentFacade,
    automation: automationFacade,
    exchange: exchangeFacade,
}));
