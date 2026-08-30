'use strict';

// GENERATED FILE. Edit electron/preload-src and run npm run build:preload.
// The concatenated bundle is required because Electron sandbox preload cannot load local modules.
// ---- core/runtime.cjs ----
const DESKTOP_API_VERSION = 1;

function createInvoke(ipcRenderer) {
    return async function invoke(channel, payload) {
        const result = await ipcRenderer.invoke(channel, payload);
        if (result?.ok === true) return result.data;

        const remoteError = result?.error || {};
        const error = new Error(remoteError.message || '桌面端操作失败，请稍后重试。');
        error.name = 'DesktopApiError';
        error.code = remoteError.code || 'INTERNAL_ERROR';
        error.retryable = Boolean(remoteError.retryable);
        error.details = remoteError.details;
        error.requestId = result?.requestId;
        throw error;
    };
}

// ---- app.cjs ----
const APP_IPC_CHANNELS = Object.freeze({
    bootstrap: 'cgj:v1:app:bootstrap',
    getVersion: 'cgj:v1:app:get-version',
    openExternal: 'cgj:v1:app:open-external',
    menuCommand: 'cgj:v1:app:menu-command',
});

function createAppFacade({ invoke, ipcRenderer }) {
    function onMenuCommand(listener) {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        const handler = (_event, command) => {
            if (command === 'save') listener(command);
        };
        ipcRenderer.on(APP_IPC_CHANNELS.menuCommand, handler);
        return () => ipcRenderer.removeListener(APP_IPC_CHANNELS.menuCommand, handler);
    }

    return Object.freeze({
        bootstrap: () => invoke(APP_IPC_CHANNELS.bootstrap),
        getVersion: () => invoke(APP_IPC_CHANNELS.getVersion),
        openExternal: url => invoke(APP_IPC_CHANNELS.openExternal, { url }),
        onMenuCommand,
    });
}

// ---- project.cjs ----
const PROJECT_IPC_CHANNELS = Object.freeze({
    list: 'cgj:v1:projects:list', create: 'cgj:v1:projects:create',
    requestDelete: 'cgj:v1:projects:request-delete', delete: 'cgj:v1:projects:delete',
    changed: 'cgj:v1:projects:changed',
    changes: 'cgj:v1:projects:changes',
});
const CHAPTER_IPC_CHANNELS = Object.freeze({
    list: 'cgj:v1:chapters:list', get: 'cgj:v1:chapters:get',
    create: 'cgj:v1:chapters:create', update: 'cgj:v1:chapters:update',
    delete: 'cgj:v1:chapters:delete',
});
const OUTLINE_IPC_CHANNELS = Object.freeze({
    get: 'cgj:v1:outlines:get', createNode: 'cgj:v1:outlines:create-node',
    updateNode: 'cgj:v1:outlines:update-node', reorder: 'cgj:v1:outlines:reorder',
    deleteNode: 'cgj:v1:outlines:delete-node', applyPatch: 'cgj:v1:outlines:apply-patch',
});
const WORKSPACE_IPC_CHANNELS = Object.freeze({
    get: 'cgj:v1:workspaces:get', save: 'cgj:v1:workspaces:save',
});

function createProjectFacade(input) {
    const invoke = typeof input === 'function' ? input : input.invoke;
    const ipcRenderer = typeof input === 'object' ? input.ipcRenderer : null;
    const actorId = typeof input === 'object' ? input.actorId : '';
    const writePayload = value => ({ ...value, ...(actorId ? { clientId: actorId } : {}) });
    const projects = Object.freeze({
        list: () => invoke(PROJECT_IPC_CHANNELS.list),
        changes: (projectId, options = {}) => invoke(PROJECT_IPC_CHANNELS.changes, {
            projectId,
            sinceSeq: options.sinceSeq,
            sinceStreamId: options.sinceStreamId,
        }),
        create: input => invoke(PROJECT_IPC_CHANNELS.create, writePayload(input || {})),
        requestDelete: projectId => invoke(PROJECT_IPC_CHANNELS.requestDelete, { projectId }),
        delete: (projectId, confirmationToken) => invoke(PROJECT_IPC_CHANNELS.delete, writePayload({
            projectId, confirmationToken,
        })),
        onChanged(listener) {
            if (typeof listener !== 'function') throw new TypeError('listener must be a function');
            if (!ipcRenderer) return () => {};
            const handler = (_event, value) => listener(value);
            ipcRenderer.on(PROJECT_IPC_CHANNELS.changed, handler);
            let active = true;
            return () => {
                if (!active) return;
                active = false;
                ipcRenderer.removeListener(PROJECT_IPC_CHANNELS.changed, handler);
            };
        },
    });
    const chapters = Object.freeze({
        list: projectId => invoke(CHAPTER_IPC_CHANNELS.list, { projectId }),
        get: (projectId, chapterId) => invoke(CHAPTER_IPC_CHANNELS.get, { projectId, chapterId }),
        create: (projectId, chapter) => invoke(CHAPTER_IPC_CHANNELS.create, writePayload({
            projectId, chapter,
        })),
        update: (projectId, chapterId, patch) => invoke(CHAPTER_IPC_CHANNELS.update, writePayload({
            projectId, chapterId, patch,
        })),
        delete: (projectId, chapterId, options) => invoke(CHAPTER_IPC_CHANNELS.delete, writePayload({
            projectId,
            chapterId,
            confirmed: typeof options === 'boolean' ? options : options?.confirmed,
            expectedRevision: typeof options === 'object' ? options?.expectedRevision : undefined,
            expectedContentHash: typeof options === 'object' ? options?.expectedContentHash : undefined,
        })),
    });
    const outlines = Object.freeze({
        get: projectId => invoke(OUTLINE_IPC_CHANNELS.get, { projectId }),
        createNode: (projectId, node) => invoke(OUTLINE_IPC_CHANNELS.createNode, writePayload({
            projectId, node,
        })),
        updateNode: (projectId, nodeId, patch) => invoke(OUTLINE_IPC_CHANNELS.updateNode, writePayload({
            projectId, nodeId, patch,
        })),
        reorder: (projectId, command) => invoke(OUTLINE_IPC_CHANNELS.reorder, writePayload({
            projectId, command,
        })),
        deleteNode: (projectId, nodeId, options) => invoke(OUTLINE_IPC_CHANNELS.deleteNode, writePayload({
            projectId,
            nodeId,
            confirmed: options?.confirmed,
            expectedRevision: options?.expectedRevision,
            expectedContentHash: options?.expectedContentHash,
        })),
        applyPatch: (projectId, patch) => invoke(OUTLINE_IPC_CHANNELS.applyPatch, writePayload({
            projectId, patch,
        })),
    });
    const workspace = Object.freeze({
        get: projectId => invoke(WORKSPACE_IPC_CHANNELS.get, { projectId }),
        save: (projectId, value) => invoke(WORKSPACE_IPC_CHANNELS.save, writePayload({
            projectId,
            workspace: value,
            expectedRevision: value?.expectedRevision,
            expectedContentHash: value?.expectedContentHash,
        })),
    });
    return Object.freeze({ clientId: actorId, projects, chapters, outlines, workspace });
}

// ---- knowledge.cjs ----
const REFERENCE_IPC_CHANNELS = Object.freeze({
    listWorldBooks: 'cgj:v1:references:list-worldbooks',
    getWorldBook: 'cgj:v1:references:get-worldbook',
    saveWorldBook: 'cgj:v1:references:save-worldbook',
    updateWorldBookEntry: 'cgj:v1:references:update-worldbook-entry',
    listCharacters: 'cgj:v1:references:list-characters',
    saveCharacter: 'cgj:v1:references:save-character',
});

function createKnowledgeFacade(input) {
    const invoke = typeof input === 'function' ? input : input.invoke;
    const actorId = typeof input === 'object' ? input.actorId : '';
    const writePayload = value => ({ ...value, ...(actorId ? { clientId: actorId } : {}) });
    const worldbooks = Object.freeze({
        list: projectId => invoke(REFERENCE_IPC_CHANNELS.listWorldBooks, { projectId }),
        get: (projectId, name) => invoke(REFERENCE_IPC_CHANNELS.getWorldBook, {
            projectId, name,
        }),
        save: (projectId, name, data, options) => invoke(REFERENCE_IPC_CHANNELS.saveWorldBook, writePayload({
            projectId, name, data,
            expectedRevision: options?.expectedRevision,
            expectedContentHash: options?.expectedContentHash,
        })),
        updateEntry: (projectId, bookName, uid, entry, options) => invoke(
            REFERENCE_IPC_CHANNELS.updateWorldBookEntry,
            writePayload({
                projectId, bookName, uid, entry,
                expectedRevision: options?.expectedRevision,
                expectedContentHash: options?.expectedContentHash,
            }),
        ),
    });
    const characters = Object.freeze({
        list: projectId => invoke(REFERENCE_IPC_CHANNELS.listCharacters, { projectId }),
        save: (projectId, data, options) => invoke(REFERENCE_IPC_CHANNELS.saveCharacter, writePayload({
            projectId, data,
            expectedRevision: options?.expectedRevision,
            expectedContentHash: options?.expectedContentHash,
        })),
    });
    const references = Object.freeze({
        listWorldBooks: worldbooks.list,
        getWorldBook: worldbooks.get,
        saveWorldBook: worldbooks.save,
        updateWorldBookEntry: worldbooks.updateEntry,
        listCharacters: characters.list,
        saveCharacter: characters.save,
    });
    return Object.freeze({ worldbooks, characters, references });
}

// ---- configuration.cjs ----
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

// ---- models.cjs ----
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

// ---- agent.cjs ----
const AGENT_IPC_CHANNELS = Object.freeze({
    status: 'cgj:v1:agent:status', openProject: 'cgj:v1:agent:open-project',
    listSessions: 'cgj:v1:agent:list-sessions', createSession: 'cgj:v1:agent:create-session',
    activateSession: 'cgj:v1:agent:activate-session',
    getHistory: 'cgj:v1:agent:get-history', prompt: 'cgj:v1:agent:prompt',
    cancel: 'cgj:v1:agent:cancel', refreshContext: 'cgj:v1:agent:refresh-context',
    restart: 'cgj:v1:agent:restart', stop: 'cgj:v1:agent:stop',
    event: 'cgj:v1:agent:event',
});
const SESSION_IPC_CHANNELS = Object.freeze({
    list: 'cgj:v1:sessions:list', create: 'cgj:v1:sessions:create',
    get: 'cgj:v1:sessions:get', update: 'cgj:v1:sessions:update',
    delete: 'cgj:v1:sessions:delete',
});

function createAgentFacade({ invoke, ipcRenderer }) {
    const runtime = Object.freeze({
        status: () => invoke(AGENT_IPC_CHANNELS.status),
        openProject: input => invoke(AGENT_IPC_CHANNELS.openProject, input),
        refreshContext: input => invoke(AGENT_IPC_CHANNELS.refreshContext, input),
        restart: input => invoke(AGENT_IPC_CHANNELS.restart, input),
        stop: () => invoke(AGENT_IPC_CHANNELS.stop),
    });
    const sessions = Object.freeze({
        list: input => invoke(AGENT_IPC_CHANNELS.listSessions, input),
        create: input => invoke(AGENT_IPC_CHANNELS.createSession, input),
        activate: input => invoke(AGENT_IPC_CHANNELS.activateSession, input),
        history: input => invoke(AGENT_IPC_CHANNELS.getHistory, input),
    });
    const workspaceSessions = Object.freeze({
        list: projectId => invoke(SESSION_IPC_CHANNELS.list, { projectId }),
        create: (projectId, session) => invoke(SESSION_IPC_CHANNELS.create, {
            projectId, session,
        }),
        get: (projectId, sessionId) => invoke(SESSION_IPC_CHANNELS.get, {
            projectId, sessionId,
        }),
        update: (projectId, sessionId, patch) => invoke(SESSION_IPC_CHANNELS.update, {
            projectId, sessionId, patch,
        }),
        delete: (projectId, sessionId, confirmed) => invoke(SESSION_IPC_CHANNELS.delete, {
            projectId, sessionId, confirmed,
        }),
    });
    const turns = Object.freeze({
        prompt: input => invoke(AGENT_IPC_CHANNELS.prompt, input),
        cancel: input => invoke(AGENT_IPC_CHANNELS.cancel, input),
    });
    const events = Object.freeze({
        subscribe(listener) {
            if (typeof listener !== 'function') throw new TypeError('listener must be a function');
            const handler = (_event, value) => {
                if (value && typeof value === 'object') listener(value);
            };
            ipcRenderer.on(AGENT_IPC_CHANNELS.event, handler);
            let active = true;
            return () => {
                if (!active) return;
                active = false;
                ipcRenderer.removeListener(AGENT_IPC_CHANNELS.event, handler);
            };
        },
    });
    return Object.freeze({
        runtime, sessions, workspaceSessions, turns, events,
        status: runtime.status,
        openProject: runtime.openProject,
        listSessions: sessions.list,
        createSession: sessions.create,
        activateSession: sessions.activate,
        getHistory: sessions.history,
        prompt: turns.prompt,
        cancel: turns.cancel,
        refreshContext: runtime.refreshContext,
        restart: runtime.restart,
        stop: runtime.stop,
        onEvent: events.subscribe,
    });
}

// ---- automation.cjs ----
const AUTOMATION_IPC_CHANNELS = Object.freeze({
    debugLastPrompt: 'cgj:v1:automation:debug:last-prompt',
    writingContinue: 'cgj:v1:automation:writing:continue',
    writingInfill: 'cgj:v1:automation:writing:infill',
    ideasPlotSuggestions: 'cgj:v1:automation:ideas:plot-suggestions',
    ideasInspire: 'cgj:v1:automation:ideas:inspire',
    extractionAnalyze: 'cgj:v1:automation:extraction:analyze',
    extractionProject: 'cgj:v1:automation:extraction:project',
    jobsCreate: 'cgj:v1:automation:jobs:create',
    jobsList: 'cgj:v1:automation:jobs:list',
    jobsGet: 'cgj:v1:automation:jobs:get',
    jobsDelete: 'cgj:v1:automation:jobs:delete',
    summaryGenerate: 'cgj:v1:automation:summary:generate',
    cancel: 'cgj:v1:automation:cancel',
});

function createAutomationFacade(invoke) {
    const call = (channel, payload) => invoke(channel, payload).then(value => value.result);
    const debug = Object.freeze({
        lastPrompt: () => call(AUTOMATION_IPC_CHANNELS.debugLastPrompt),
    });
    const writing = Object.freeze({
        continue: payload => call(AUTOMATION_IPC_CHANNELS.writingContinue, payload),
        infill: payload => call(AUTOMATION_IPC_CHANNELS.writingInfill, payload),
    });
    const ideas = Object.freeze({
        plotSuggestions: payload => call(AUTOMATION_IPC_CHANNELS.ideasPlotSuggestions, payload),
        inspire: payload => call(AUTOMATION_IPC_CHANNELS.ideasInspire, payload),
    });
    const extraction = Object.freeze({
        analyze: payload => call(AUTOMATION_IPC_CHANNELS.extractionAnalyze, payload),
        project: payload => call(AUTOMATION_IPC_CHANNELS.extractionProject, payload),
    });
    const jobs = Object.freeze({
        create: payload => call(AUTOMATION_IPC_CHANNELS.jobsCreate, payload),
        list: () => call(AUTOMATION_IPC_CHANNELS.jobsList),
        get: jobId => call(AUTOMATION_IPC_CHANNELS.jobsGet, { jobId }),
        delete: jobId => call(AUTOMATION_IPC_CHANNELS.jobsDelete, { jobId }),
    });
    const summary = Object.freeze({
        generate: payload => call(AUTOMATION_IPC_CHANNELS.summaryGenerate, payload),
    });
    const operations = Object.freeze({
        run: (operation, payload, options = {}) => {
            const input = options.operationId
                ? { ...(payload || {}), operationId: options.operationId }
                : payload;
            switch (operation) {
            case 'debug.lastPrompt': return debug.lastPrompt();
            case 'writing.continue': return writing.continue(input);
            case 'writing.infill': return writing.infill(input);
            case 'ideas.plotSuggestions': return ideas.plotSuggestions(input);
            case 'ideas.inspire': return ideas.inspire(input);
            case 'extraction.analyze': return extraction.analyze(input);
            case 'extraction.project': return extraction.project(input);
            case 'extraction.jobs.create': return jobs.create(input);
            case 'extraction.jobs.list': return jobs.list();
            case 'extraction.jobs.get': return jobs.get(options.jobId);
            case 'extraction.jobs.delete': return jobs.delete(options.jobId);
            case 'summary.generate': return summary.generate(input);
            default: return Promise.reject(new Error(`Unsupported automation operation: ${operation}`));
            }
        },
        cancel: operationId => invoke(AUTOMATION_IPC_CHANNELS.cancel, { operationId }),
    });
    return Object.freeze({
        available: true,
        debug,
        writing,
        ideas,
        extraction,
        jobs,
        summary,
        operations,
    });
}

// ---- exchange.cjs ----
const IMPORT_IPC_CHANNELS = Object.freeze({
    selectDocument: 'cgj:v1:imports:select-document',
    selectFolder: 'cgj:v1:imports:select-folder',
    selectWorldBook: 'cgj:v1:imports:select-worldbook',
    selectCharacters: 'cgj:v1:imports:select-characters',
    selectPreset: 'cgj:v1:imports:select-preset',
});
const EXPORT_IPC_CHANNELS = Object.freeze({
    saveText: 'cgj:v1:exports:save-text', saveJson: 'cgj:v1:exports:save-json',
});

function createExchangeFacade(input) {
    const invoke = typeof input === 'function' ? input : input.invoke;
    const actorId = typeof input === 'object' ? input.actorId : '';
    const writePayload = value => ({ ...value, ...(actorId ? { clientId: actorId } : {}) });
    const imports = Object.freeze({
        selectDocument: options => invoke(
            IMPORT_IPC_CHANNELS.selectDocument,
            writePayload(options || {}),
        ),
        selectFolder: projectId => invoke(
            IMPORT_IPC_CHANNELS.selectFolder,
            writePayload({ projectId }),
        ),
        selectWorldBook: projectId => invoke(
            IMPORT_IPC_CHANNELS.selectWorldBook,
            writePayload({ projectId }),
        ),
        selectCharacters: projectId => invoke(
            IMPORT_IPC_CHANNELS.selectCharacters,
            writePayload({ projectId }),
        ),
        selectPreset: projectId => invoke(
            IMPORT_IPC_CHANNELS.selectPreset,
            writePayload({ projectId }),
        ),
    });
    const exports = Object.freeze({
        saveText: (suggestedName, content) => invoke(EXPORT_IPC_CHANNELS.saveText, {
            suggestedName, content,
        }),
        saveJson: (suggestedName, data) => invoke(EXPORT_IPC_CHANNELS.saveJson, {
            suggestedName, data,
        }),
    });
    return Object.freeze({ imports, exports });
}

// ---- entry.cjs ----
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
