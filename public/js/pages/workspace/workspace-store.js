/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function resetWorkspaceState() {
    // Keep tokens monotonic across resets; resetting them to zero would let
    // an old promise accidentally look current after a fast project switch.
    state.workspaceActionToken = Number(state.workspaceActionToken || 0) + 1;
    state.chapterMutationToken = Number(state.chapterMutationToken || 0) + 1;
    state.outlineMutationToken = Number(state.outlineMutationToken || 0) + 1;
    state.summaryRequestToken = Number(state.summaryRequestToken || 0) + 1;
    state.chapterContextToken = Number(state.chapterContextToken || 0) + 1;
    state.editorSaveToken = Number(state.editorSaveToken || 0) + 1;
    state.automationRequestToken = Number(state.automationRequestToken || 0) + 1;
    state.currentChapter = null;
    state.chapters = [];
    state.outline = [];
    state.outlineRevision = 0;
    state.outlineContentHash = '';
    state.worldBook = { entries: {} };
    state.characters = [];
    state.regexBindings = [];
    state.sessions = [];
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
    state.workspaceDirty = false;
    window.CuigengjiWorkspacePersistence?.clearBaseline?.();
    state.workspaceRevision = 0;
    state.workspaceContentHash = '';
    state.externalChange = null;
    state.workspaceLoaded = false;
    state.isGenerating = false;
    state.panelLayout = {};
    state._modelCache = [];
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

// Leaving the workspace (without a full reset yet) still has to invalidate
// promises that may be resolving in the background, such as auto-save or AI
// summary extraction.
function invalidateWorkspaceActions() {
    state.workspaceActionToken = Number(state.workspaceActionToken || 0) + 1;
    state.chapterMutationToken = Number(state.chapterMutationToken || 0) + 1;
    state.outlineMutationToken = Number(state.outlineMutationToken || 0) + 1;
    state.summaryRequestToken = Number(state.summaryRequestToken || 0) + 1;
    state.chapterContextToken = Number(state.chapterContextToken || 0) + 1;
    state.editorSaveToken = Number(state.editorSaveToken || 0) + 1;
    state.automationRequestToken = Number(state.automationRequestToken || 0) + 1;
    state.isGenerating = false;
}

/**
 * Capture the renderer-side identity of the active workspace before starting
 * an asynchronous operation.  A project id alone is not enough: a user can
 * leave a project and quickly open it again while an old IPC response is
 * still in flight.  The monotonic token makes that old response stale even
 * when the id happens to be the same.
 */
function captureWorkspaceActionContext(options = {}) {
    const chapterId = options.chapterId === undefined
        ? (state.currentChapter?.id || '')
        : (options.chapterId || '');
    return Object.freeze({
        projectId: String(state.currentNovel?.id || ''),
        workspaceToken: Number(state.workspaceActionToken || 0),
        chapterId: String(chapterId || ''),
        chapterToken: Number(state.chapterContextToken || 0),
    });
}

function isCurrentWorkspaceAction(context, options = {}) {
    if (!context || typeof context !== 'object') return false;
    if (String(state.currentNovel?.id || '') !== String(context.projectId || '')) return false;
    if (Number(state.workspaceActionToken || 0) !== Number(context.workspaceToken || 0)) return false;
    if (options.requireLoaded !== false && !state.workspaceLoaded) return false;
    if (options.chapter === true) {
        if (String(state.currentChapter?.id || '') !== String(context.chapterId || '')) return false;
        if (Number(state.chapterContextToken || 0) !== Number(context.chapterToken || 0)) return false;
    }
    return true;
}

// Expose a tiny, dependency-free bridge for page modules that are loaded as
// classic scripts.  Keeping the token logic here prevents each feature from
// inventing a subtly different stale-response check.
window.CuigengjiWorkspaceLifecycle = Object.freeze({
    capture: captureWorkspaceActionContext,
    isCurrent: isCurrentWorkspaceAction,
    invalidate: invalidateWorkspaceActions,
});

function applyWorkspaceState(workspace = {}) {
    state.workspaceRevision = Number(workspace.revision || 0);
    state.workspaceContentHash = String(workspace.contentHash || '');
    state.workspaceDirty = false;
    state.externalChange = null;
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
    } else if (Array.isArray(workspace.promptTemplates)) {
        state.enabledTemplates = Object.fromEntries(workspace.promptTemplates
            .filter(template => template?.identifier)
            .map(template => [
                template.identifier,
                template.enabled !== false && template.disabled !== true,
            ]));
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
    window.CuigengjiWorkspacePersistence?.markBaseline?.();
}
