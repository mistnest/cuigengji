/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function serializeWorkspace() {
    return {
        worldBook: state.worldBook,
        worldBookName: state.currentNovel?.id || '',
        characters: state.characters,
        characterNames: state.characters
            .map(character => character.data?.name || character.name || '')
            .filter(Boolean),
        presets: state.presets || {},
        presetName: state.presetName || '',
        promptTemplates: state.promptTemplates || [],
        promptOrder: state.promptOrder || [],
        enabledTemplates: state.enabledTemplates || {},
        regexBindings: state.regexBindings || [],
        writingReference: state.writingReference || {},
        aiConfig: { ...safeAiConfig(), maxContext: 0 },
        panelLayout: state.panelLayout || {},
    };
}

// Serialize workspace checkpoints so concurrent UI triggers cannot reuse an
// old revision. The backend remains the authoritative compare-and-swap guard.
let workspaceSavePromise = null;
let workspaceSavePending = false;
let workspaceSaveNotify = false;
let workspaceSaveProjectId = '';
let workspaceSaveWorkspaceToken = 0;
let workspaceEditGeneration = 0;
let workspaceBaselineFingerprint = '';

function stableWorkspaceValue(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object') {
        return typeof value === 'undefined' || typeof value === 'function' ? null : value;
    }
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    try {
        if (Array.isArray(value)) return value.map(item => stableWorkspaceValue(item, seen));
        const result = {};
        Object.keys(value).sort().forEach(key => {
            result[key] = stableWorkspaceValue(value[key], seen);
        });
        return result;
    } finally {
        // Only the current recursion path is a cycle.  Shared references in
        // two independent fields should fingerprint identically to a cloned
        // workspace rather than being mistaken for a cycle.
        seen.delete(value);
    }
}

function computeWorkspaceFingerprint() {
    try {
        return JSON.stringify(stableWorkspaceValue(serializeWorkspace()));
    } catch {
        return '';
    }
}

function markWorkspaceBaseline() {
    workspaceBaselineFingerprint = computeWorkspaceFingerprint();
    state.workspaceDirty = false;
}

function clearWorkspaceBaseline() {
    workspaceBaselineFingerprint = '';
}

function isWorkspaceDraftDirty() {
    if (state.workspaceDirty) return true;
    if (!state.workspaceLoaded) return false;
    // A missing baseline is treated conservatively.  It can happen during the
    // very short bootstrap window before the persistence module is available;
    // prompting is safer than silently replacing an untracked local edit.
    if (!workspaceBaselineFingerprint) return true;
    return computeWorkspaceFingerprint() !== workspaceBaselineFingerprint;
}

async function saveWorkspaceState({ silent = false } = {}) {
    if (!state.workspaceLoaded || !state.currentNovel?.id) return false;
    const requestedProjectId = state.currentNovel.id;
    const requestedWorkspaceToken = Number(state.workspaceActionToken || 0);
    if (workspaceSavePromise) {
        // Do not join a save belonging to another project/lifecycle. Wait for
        // that operation to settle, then start a fresh save with the current
        // snapshot; otherwise its response could update the new project's
        // revision/hash state.
        if (workspaceSaveProjectId !== requestedProjectId
            || workspaceSaveWorkspaceToken !== requestedWorkspaceToken) {
            const previous = workspaceSavePromise;
            await previous.catch(() => {});
            if (workspaceSavePromise === previous) workspaceSavePromise = null;
            return saveWorkspaceState({ silent });
        }
        workspaceSavePending = true;
        workspaceSaveNotify = workspaceSaveNotify || !silent;
        return workspaceSavePromise;
    }
    workspaceSaveProjectId = requestedProjectId;
    workspaceSaveWorkspaceToken = requestedWorkspaceToken;
    workspaceSavePending = true;
    workspaceSaveNotify = workspaceSaveNotify || !silent;
    const operation = (async () => {
        let result = false;
        while (workspaceSavePending) {
            workspaceSavePending = false;
            const notify = workspaceSaveNotify;
            workspaceSaveNotify = false;
            silent = !notify;
            const novelId = state.currentNovel?.id;
            const savedEditGeneration = workspaceEditGeneration;
            if (!isCurrentWorkspaceSave(novelId, requestedWorkspaceToken)) break;
            const workspace = {
                ...serializeWorkspace(),
                expectedRevision: Number(state.workspaceRevision || 0),
                expectedContentHash: state.workspaceContentHash || undefined,
            };
            try {
                const saved = await Repositories.workspaces.save(novelId, workspace);
                if (!isCurrentWorkspaceSave(novelId, requestedWorkspaceToken)) break;
                if (saved && saved.revision !== undefined) {
                    state.workspaceRevision = Number(saved.revision) || state.workspaceRevision;
                    state.workspaceContentHash = saved.contentHash || state.workspaceContentHash;
                }
                // A second edit may have queued another pass while this
                // request was in flight.  Only clear the dirty marker when
                // the serialized save queue is actually drained.
                if (!workspaceSavePending
                    && workspaceEditGeneration === savedEditGeneration
                    && isCurrentWorkspaceSave(novelId, requestedWorkspaceToken)) {
                    markWorkspaceBaseline();
                    if (typeof updateStatusBar === 'function') updateStatusBar();
                }
                if (state.externalChange?.kind === 'workspace'
                    && state.externalChange.projectId === novelId) {
                    state.externalChange = null;
                }
                window.AgentWorkbenchFeature?.refreshContext();
                if (!silent) setStatus('工作区已保存', 'success');
                result = true;
            } catch (err) {
                workspaceSavePending = false;
                workspaceSaveNotify = false;
                if (err?.code === 'REVISION_CONFLICT'
                    && isCurrentWorkspaceSave(novelId, requestedWorkspaceToken)) {
                    state.externalChange = {
                        kind: 'workspace', projectId: novelId,
                        details: err.details || null, detectedAt: Date.now(),
                    };
                    window.CuigengjiCollaboration?.reportConflict?.({
                        projectId: novelId,
                        entityType: 'workspace',
                        entityId: novelId,
                        details: err.details || null,
                        error: err,
                    });
                    setStatus('工作区已被其他操作更新，请重新加载', 'warn');
                    silent = true;
                }
                if (!silent) setStatus(`工作区保存失败: ${err.message}`, 'error');
                throw err;
            }
        }
        return result;
    })();
    workspaceSavePromise = operation;
    operation.finally(() => {
        if (workspaceSavePromise !== operation) return;
        workspaceSavePromise = null;
        workspaceSaveProjectId = '';
        workspaceSaveWorkspaceToken = 0;
        workspaceSavePending = false;
        workspaceSaveNotify = false;
    }).catch(() => {});
    return operation;
}

function isCurrentWorkspaceSave(projectId, workspaceToken) {
    return Boolean(state.workspaceLoaded && projectId)
        && state.currentNovel?.id === projectId
        && Number(state.workspaceActionToken || 0) === workspaceToken;
}

function getOrderedTextChapters() {
    return (state.chapters || [])
        .filter(chapter => chapter && chapter.type !== 'volume')
        .slice()
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function deriveChapterWindowAnchor(reason = 'new-session') {
    const chapters = getOrderedTextChapters();
    if (!chapters.length) return null;
    let currentIndex = chapters.findIndex(chapter => chapter.id === state.currentChapter?.id);
    if (currentIndex < 0) {
        const title = ($('#chapter-title-input')?.value || state.currentChapter?.title || '').trim();
        currentIndex = chapters.findIndex(chapter => String(chapter.title || '').trim() === title);
    }
    if (currentIndex < 0) currentIndex = chapters.length - 1;
    const anchor = chapters[Math.max(0, currentIndex - 5)] || chapters[currentIndex];
    return anchor ? {
        id: anchor.id || '',
        title: anchor.title || '',
        order: anchor.order ?? currentIndex,
        reason,
        updatedAt: Date.now(),
    } : null;
}

function ensureChapterWindowAnchor() {
    if (!state.writingContextAnchor) {
        state.writingContextAnchor = deriveChapterWindowAnchor('fallback');
    }
    return state.writingContextAnchor;
}

function refreshChapterWindowAnchor(reason = 'context-pack') {
    state.writingContextAnchor = deriveChapterWindowAnchor(reason);
    return state.writingContextAnchor;
}

function persistBeforeUnload() {
    if (!state.workspaceLoaded || !state.currentNovel?.id) return;
    const projectId = state.currentNovel.id;
    const workspaceToken = Number(state.workspaceActionToken || 0);
    const chapterId = state.currentChapter?.id || '';
    const chapterRevision = state.currentChapter?.revision;
    const chapterContentHash = state.currentChapter?.contentHash;
    if (state.isDirty && state.currentChapter?.id) {
        Repositories.chapters.update(
            projectId,
            chapterId,
            {
                title: $('#chapter-title-input').value || state.currentChapter.title,
                content: $('#chapter-editor').value,
                expectedRevision: chapterRevision,
                expectedContentHash: chapterContentHash,
            },
        ).catch(() => {});
    }
    Repositories.workspaces.save(
        projectId,
        {
            ...serializeWorkspace(),
            expectedRevision: Number(state.workspaceRevision || 0),
            expectedContentHash: state.workspaceContentHash || undefined,
        },
    ).then(result => {
        if (!isCurrentWorkspaceSave(projectId, workspaceToken)) return;
        if (result?.revision !== undefined) state.workspaceRevision = Number(result.revision);
        if (result?.contentHash) state.workspaceContentHash = result.contentHash;
    }).catch(error => {
        if (error?.code === 'REVISION_CONFLICT' && isCurrentWorkspaceSave(projectId, workspaceToken)) {
            state.externalChange = {
                kind: 'workspace', projectId,
                details: error.details || null, detectedAt: Date.now(),
            };
        }
    });
}

// Debounced auto-save (fires 2s after last edit).  Capture the workspace
// lifecycle token at schedule time: after a project switch or an explicit
// reload, a delayed callback must not serialize the new view with the old
// edit's intent.
const scheduleAutoSave = debounce((scheduledWorkspaceToken) => {
    requestAnimationFrame(async () => {
        if (scheduledWorkspaceToken !== Number(state.workspaceActionToken || 0)
            || !state.workspaceLoaded) return;
        // Save chapter content if dirty, then always save workspace
        if (state.isDirty && !await onSave({ silent: true })) return;
        const saved = await saveWorkspaceState({ silent: true }).catch(() => false);
        if (!saved) return;
        $('#status-save').textContent = '已自动保存';
        setTimeout(() => { if ($('#status-save')) $('#status-save').textContent = '已保存'; }, 2000);
    });
}, () => state.appSettings.autoSaveDelay);

function autoSave() {
    if (state.workspaceLoaded && state.currentNovel?.id) {
        workspaceEditGeneration += 1;
        state.workspaceDirty = true;
        if (typeof updateStatusBar === 'function') updateStatusBar();
    }
    return scheduleAutoSave(Number(state.workspaceActionToken || 0));
}

window.CuigengjiWorkspacePersistence = Object.freeze({
    isDirty: isWorkspaceDraftDirty,
    markBaseline: markWorkspaceBaseline,
    clearBaseline: clearWorkspaceBaseline,
});

// Expose autoSave for manual triggers
window.autoSaveEditor = autoSave;
window.applyRegexBindings = applyRegexBindings;
window.saveWorkspaceState = saveWorkspaceState;
window.onAISuccess = () => {
    state.aiUsed = true;
    setPreference('selectedProvider', state.aiConfig.provider);
    setPreference('connectedProvider', state.aiConfig.provider);
    rememberLastSuccessfulAiConfig();
    updateStatusBar();
};
