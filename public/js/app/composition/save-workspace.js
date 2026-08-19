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
        specialPrompts: state.specialPrompts || {},
        formatStrings: state.formatStrings || {},
        regexBindings: state.regexBindings || [],
        writingReference: state.writingReference || {},
        aiConfig: { ...safeAiConfig(), maxContext: 0 },
        panelLayout: state.panelLayout || {},
    };
}

async function saveWorkspaceState({ silent = false } = {}) {
    if (!state.workspaceLoaded || !state.currentNovel?.id) return;
    const novelId = state.currentNovel.id;
    const workspace = serializeWorkspace();
    try {
        await Repositories.workspaces.save(novelId, workspace);
        window.AgentWorkbenchFeature?.refreshContext();
        if (!silent) setStatus('工作区已保存', 'success');
    } catch (err) {
        if (!silent) setStatus(`工作区保存失败: ${err.message}`, 'error');
        throw err;
    }
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
    if (state.isDirty && state.currentChapter?.id) {
        Repositories.chapters.update(
            state.currentNovel.id,
            state.currentChapter.id,
            {
                title: $('#chapter-title-input').value || state.currentChapter.title,
                content: $('#chapter-editor').value,
                expectedRevision: state.currentChapter.revision,
            },
        ).catch(() => {});
    }
    Repositories.workspaces.save(
        state.currentNovel.id,
        serializeWorkspace(),
    ).catch(() => {});
}

// Debounced auto-save (fires 2s after last edit)
const autoSave = debounce(() => {
    requestAnimationFrame(async () => {
        // Save chapter content if dirty, then always save workspace
        if (state.isDirty) await onSave({ silent: true });
        await saveWorkspaceState({ silent: true }).catch(() => {});
        $('#status-save').textContent = '已自动保存';
        setTimeout(() => { if ($('#status-save')) $('#status-save').textContent = '已保存'; }, 2000);
    });
}, () => state.appSettings.autoSaveDelay);

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
