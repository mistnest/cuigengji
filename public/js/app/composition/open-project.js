/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
async function enterWorkspace(id, title) {
    if (state.workspaceLoaded && state.currentNovel?.id !== id) {
        if (state.isDirty && !await onSave({ silent: true })) return;
        await saveWorkspaceState({ silent: true });
    }

    workspaceLoadController?.abort();
    workspaceLoadController = new AbortController();
    const loadVersion = ++workspaceLoadVersion;

    try {
        const accessed = { ...Preferences.get('recentProjectAccess', {}) };
        accessed[id] = Date.now();
        setPreference('recentProjectAccess', accessed);
    } catch {}

    resetWorkspaceState();
    state.currentNovel = { id, title };
    $('#current-novel-title').textContent = title;
    $('#welcome-page')?.classList.add('hidden');
    if ($('#app-main')) $('#app-main').style.display = '';
    window.AgentWorkbenchFeature?.setVisible(
        $('#panel-chat')?.classList.contains('active') === true,
    );

    try {
        const [chapterData, outlineData, diskWorkspace] = await Promise.all([
            Repositories.chapters.list(id),
            Repositories.outlines.get(id),
            Repositories.workspaces.get(id),
        ]);
        if (loadVersion !== workspaceLoadVersion || state.currentNovel.id !== id) return;
        const workspaceData = diskWorkspace || {};
        state.chapters = Array.isArray(chapterData) ? chapterData : [];
        state.outline = Array.isArray(outlineData.nodes) ? outlineData.nodes : [];
        state.outlineRevision = Number(outlineData.revision || 0);
        applyWorkspaceState(workspaceData);
        state.workspaceLoaded = true;
        setPreference('lastWorkspace', id);
        syncWorkspaceInteractivity();

        state.currentChapter = null;
        const firstChapter = state.chapters.find(item => item.type !== 'volume');
        if (firstChapter) {
            const chapter = await Repositories.chapters.get(id, firstChapter.id);
            if (loadVersion !== workspaceLoadVersion || state.currentNovel.id !== id) return;
            Object.assign(firstChapter, chapter);
            loadChapter(firstChapter, { refreshTree: false });
        } else {
            clearChapterEditor();
        }

        refreshChapterTree();
        renderOutlineTree();
        renderWorldBookList();
        renderCharacterList();
        renderPromptTemplates();

        void restoreAiConnection({ silent: true });
    } catch (err) {
        if (err.name === 'AbortError') return;
        setStatus(`\u5de5\u4f5c\u533a\u52a0\u8f7d\u5931\u8d25: ${err.message}`, 'error');
    }
}

async function showWelcomePage() {
    if (state.workspaceLoaded) {
        if (state.isDirty && !await onSave({ silent: true })) return;
        await saveWorkspaceState({ silent: true });
    }
    window.AgentWorkbenchFeature?.setVisible(false);
    $('#welcome-page')?.classList.remove('hidden');
    if ($('#app-main')) $('#app-main').style.display = 'none';
    loadRecentWorkspaces();
}

async function ensureNovelExists() {
    const novelId = state.currentNovel?.id || 'default';
    try {
        // Check if project exists
        const projects = await Repositories.projects.list();
        const exists = projects.some(project => project.id === novelId);
        if (!exists) {
            // Use novelId as title so the resulting directory matches
            const created = await Repositories.projects.create({ title: novelId });
            // Update state with the actual created id
            if (created.id) state.currentNovel.id = created.id;
        }
    } catch { /* ignore — project might already exist */ }
}

// ==================== World Book Import ====================

async function onNewNovel() {
    if (state.isDirty && !safeConfirm('未保存的更改将丢失，确认新建？')) return;
    await createWorkspaceFromWelcome();
}

// ==================== Safe Confirm ====================
// Wrapper around native confirm() that prevents focus loss from breaking input
