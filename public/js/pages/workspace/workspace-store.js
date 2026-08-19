/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function resetWorkspaceState() {
    state.currentChapter = null;
    state.chapters = [];
    state.outline = [];
    state.outlineRevision = 0;
    state.worldBook = { entries: {} };
    state.characters = [];
    state.presets = {};
    state.presetName = '';
    state.promptTemplates = [];
    state.promptOrder = [];
    state.enabledTemplates = {};
    state.selectedPromptTemplates = {};
    state.specialPrompts = {};
    state.formatStrings = {};
    state.writingReference = {
        worldbookMode: 'all',
        selectedWorldbookGroups: [],
        characterMode: 'auto',
        selectedCharacters: [],
    };
    state.writingContextAnchor = null;
    state.isDirty = false;
    state.workspaceLoaded = false;
    state.panelLayout = {};
    state.aiConfig = { ...defaultAiConfig };
    loadLastSuccessfulAiConfig();
    state.isConnected = false;
    state.hasSavedApiKey = false;
    state.hasSavedVertexServiceAccount = false;
    state.aiUsed = false;
    updatePresetNameDisplay('');
    updatePresetSelect();
    applyConfigToUI();
    syncWorkspaceInteractivity();
}

function applyWorkspaceState(workspace = {}) {
    if (workspace.worldBook?.entries) state.worldBook = workspace.worldBook;
    if (Array.isArray(workspace.characters)) state.characters = workspace.characters;
    if (workspace.presets && typeof workspace.presets === 'object' && !Array.isArray(workspace.presets)) {
        state.presets = workspace.presets;
    }
    if (typeof workspace.presetName === 'string') state.presetName = workspace.presetName;
    if (Array.isArray(workspace.promptTemplates)) state.promptTemplates = workspace.promptTemplates;
    if (Array.isArray(workspace.promptOrder)) state.promptOrder = workspace.promptOrder;
    if (workspace.enabledTemplates && typeof workspace.enabledTemplates === 'object') {
        state.enabledTemplates = workspace.enabledTemplates;
    }
    if (workspace.specialPrompts && typeof workspace.specialPrompts === 'object') {
        state.specialPrompts = workspace.specialPrompts;
    }
    if (workspace.formatStrings && typeof workspace.formatStrings === 'object') {
        state.formatStrings = workspace.formatStrings;
    }
    if (Array.isArray(workspace.regexBindings)) {
        state.regexBindings = workspace.regexBindings;
        updateRegexDisplay();
    }
    if (workspace.writingReference && typeof workspace.writingReference === 'object') {
        state.writingReference = {
            ...state.writingReference,
            ...workspace.writingReference,
        };
    }
    if (workspace.aiConfig && typeof workspace.aiConfig === 'object') {
        const legacyApiKey = workspace.aiConfig.apiKey;
        const legacyVertexSecret = workspace.aiConfig.vertexServiceAccountJson;
        Object.assign(state.aiConfig, workspace.aiConfig, {
            apiKey: '',
            vertexServiceAccountJson: '',
        });
        if (legacyApiKey && state.aiConfig.provider) {
            saveSecretForProvider(state.aiConfig.provider, legacyApiKey).catch(() => {});
        }
        if (legacyVertexSecret) {
            saveSecretForProvider('google-vertex-service-account', legacyVertexSecret).catch(() => {});
        }
    }
    if (workspace.panelLayout && typeof workspace.panelLayout === 'object') {
        state.panelLayout = workspace.panelLayout;
        if (typeof ResizablePanels !== 'undefined') {
            ResizablePanels.applyServerSizes(state.panelLayout);
        }
    }
    updatePresetNameDisplay(state.presetName);
    ensureBuiltinPreset();
    updatePresetSelect();
    applyConfigToUI();
}
