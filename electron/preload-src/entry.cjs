'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = createInvoke(ipcRenderer);
const appFacade = createAppFacade({ invoke, ipcRenderer });
const projectFacade = createProjectFacade(invoke);
const knowledgeFacade = createKnowledgeFacade(invoke);
const configurationFacade = createConfigurationFacade(invoke);
const modelsFacade = createModelsFacade(invoke);
const agentFacade = createAgentFacade({ invoke, ipcRenderer });
const automationFacade = createAutomationFacade(invoke);
const exchangeFacade = createExchangeFacade(invoke);

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
