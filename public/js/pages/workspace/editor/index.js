/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
async function onChapterSelect(e) {
    const id = e.target.value;
    if (!id) return;
    await switchChapter(id);
}

function loadChapter(chapter, { refreshTree = true } = {}) {
    if (!chapter) return;
    state.chapterContextToken = Number(state.chapterContextToken || 0) + 1;
    // A newly selected chapter invalidates in-flight summary/save responses
    // even when the user quickly switches back to the same id.
    state.editorSaveToken = Number(state.editorSaveToken || 0) + 1;
    state.currentChapter = chapter;
    syncWorkspaceInteractivity();
    // Defensive: after a tick, ensure editor is still enabled
    // (async operations during load might race with disable calls)
    setTimeout(() => {
        if (state.currentChapter?.id === chapter.id) syncWorkspaceInteractivity();
    }, 100);
    $('#chapter-editor').value = chapter.content || '';
    $('#chapter-title-input').value = chapter.title || '';
    $('#current-chapter-title').textContent = `- ${chapter.title || '无标题'}`;
    showChapterSummary(chapter);
    state.isDirty = false;
    updateWordCount();
    updateStatusBar();
    if (refreshTree) refreshChapterTree();
    setStatus(`已加载: ${chapter.title}`, 'info');
}

function showChapterSummary(chapter) {
    const area = $('#chapter-summary-area');
    const input = $('#chapter-summary-input');
    const hint = $('#summary-hint');
    if (!area || !input) return;
    area.style.display = 'block';

    const summary = chapter.summary || chapter.aiSummary?.brief || '';
    const generator = chapter.summaryGenerator || '';
    if (summary) {
        input.value = summary;
        if (hint) hint.textContent = generator === 'manual' ? '已手动编辑' :
            generator === 'ai-v1' ? 'AI 生成' : '自动生成 · 可编辑';
    } else {
        const text = (chapter.content || '').replace(/\s+/g, ' ').trim();
        input.value = text ? text.slice(0, 200) + (text.length > 200 ? '…' : '') : '';
        if (hint) hint.textContent = '自动生成 · 可编辑';
    }
}

function getChapterSummary() {
    const input = $('#chapter-summary-input');
    return input ? input.value.trim() : '';
}

function initSummaryDrag() {
    const handle = $('#summary-drag');
    const area = $('#chapter-summary-area');
    if (!handle || !area) return;
    let d = false, sy, sh;
    handle.addEventListener('mousedown', e => {
        d = true; sy = e.clientY; sh = area.offsetHeight;
        document.body.style.userSelect = 'none'; e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!d) return;
        area.style.height = Math.max(80, Math.min(500, sh + sy - e.clientY)) + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (!d) return; d = false; document.body.style.userSelect = '';
        setPreference('summaryHeight', area.style.height);
    });
    const savedHeight = Preferences.get('summaryHeight', '');
    if (savedHeight) area.style.height = savedHeight;
}

async function onAiExtractSummary() {
    const editor = $('#chapter-editor');
    const text = editor?.value?.trim();
    if (!text) { setStatus('请先编写正文', 'warn'); return; }
    const projectId = state.currentNovel?.id;
    const chapterId = state.currentChapter?.id;
    const chapterToken = Number(state.chapterContextToken || 0);
    const requestToken = ++state.summaryRequestToken;
    const expectedRevision = state.currentChapter?.revision;
    const expectedContentHash = state.currentChapter?.contentHash;
    if (!projectId || !chapterId) {
        setStatus('请先选择章节', 'warn');
        return;
    }
    const btn = $('#btn-ai-summary');
    if (btn) { btn.disabled = true; btn.textContent = '提取中…'; }
    setStatus('AI 正在分析本章…', 'loading');
    try {
        const data = await AutomationRuntime.execute('extraction.analyze', {
            text,
            config: state.aiConfig,
            presetName: state.presetName || '__default__',
        });
        if (!isEditorContextCurrent(projectId, chapterId, chapterToken)
            || requestToken !== Number(state.summaryRequestToken || 0)) return;
        if (data.chapterSummary?.brief) {
            const brief = data.chapterSummary.brief;
            const updated = await Repositories.chapters.update(
                projectId,
                chapterId,
                {
                    summary: brief,
                    expectedRevision,
                    expectedContentHash,
                },
            );
            if (!isEditorContextCurrent(projectId, chapterId, chapterToken)
                || requestToken !== Number(state.summaryRequestToken || 0)) return;
            const input = $('#chapter-summary-input');
            if (input) input.value = brief;
            const hint = $('#summary-hint');
            if (hint) hint.textContent = 'AI 生成 · ' + new Date().toLocaleTimeString();
            Object.assign(state.currentChapter, updated);
        }
        setStatus('摘要已更新', 'success');
    } catch (err) {
        if (!isEditorContextCurrent(projectId, chapterId, chapterToken)
            || requestToken !== Number(state.summaryRequestToken || 0)) return;
        if (handleEditorConflict(err, projectId, chapterId)) return;
        setStatus('提取失败: ' + err.message, 'error');
    } finally {
        if (btn && requestToken === Number(state.summaryRequestToken || 0)) {
            btn.disabled = false; btn.textContent = 'AI 提取';
        }
    }
}

async function saveChapterSummaryEdit() {
    if (!state.currentChapter?.id || !state.currentNovel?.id) {
        setStatus('请先选择章节', 'warn');
        return;
    }
    const projectId = state.currentNovel.id;
    const chapterId = state.currentChapter.id;
    const chapterToken = Number(state.chapterContextToken || 0);
    const saveToken = ++state.editorSaveToken;
    const expectedRevision = state.currentChapter.revision;
    const expectedContentHash = state.currentChapter.contentHash;
    const summary = getChapterSummary();
    const btn = $('#btn-save-summary');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '保存中';
    }
    try {
        const updated = await Repositories.chapters.update(
            projectId,
            chapterId,
            {
            title: $('#chapter-title-input')?.value || state.currentChapter.title,
            content: $('#chapter-editor')?.value || state.currentChapter.content || '',
            summary,
            expectedRevision,
            expectedContentHash,
            },
        );
        if (!isEditorContextCurrent(projectId, chapterId, chapterToken)
            || saveToken !== Number(state.editorSaveToken || 0)) return;
        Object.assign(state.currentChapter, updated);
        window.AgentWorkbenchFeature?.refreshContext();
        const hint = $('#summary-hint');
        if (hint) hint.textContent = '已手动保存 · ' + new Date().toLocaleTimeString();
        setStatus('本章摘要已保存', 'success');
    } catch (err) {
        if (!isEditorContextCurrent(projectId, chapterId, chapterToken)
            || saveToken !== Number(state.editorSaveToken || 0)) return;
        if (handleEditorConflict(err, projectId, chapterId)) return;
        setStatus('摘要保存失败: ' + err.message, 'error');
    } finally {
        if (btn && saveToken === Number(state.editorSaveToken || 0)) {
            btn.disabled = false;
            btn.textContent = '保存修改';
        }
    }
}

async function onSave({ silent = false } = {}) {
    if (!state.currentChapter) {
        const content = $('#chapter-editor').value;
        const title = $('#chapter-title-input').value;
        return Boolean(await createChapter({ title, content, silent }));
    }

    const projectId = state.currentNovel?.id;
    const chapterToken = Number(state.chapterContextToken || 0);
    const saveToken = ++state.editorSaveToken;
    const ch = state.currentChapter;
    const chapterId = ch.id;
    if (!projectId || !chapterId) return false;
    const content = $('#chapter-editor').value;
    const title = $('#chapter-title-input').value || ch.title;

    try {
        const summary = getChapterSummary();
        const saveBody = { title, content };
        saveBody.expectedRevision = ch.revision;
        saveBody.expectedContentHash = ch.contentHash;
        if (summary && summary !== (ch.summary || ch.aiSummary?.brief || '')) {
            saveBody.summary = summary;
        }
        const updated = await Repositories.chapters.update(
            projectId,
            chapterId,
            saveBody,
        );

        if (!isEditorContextCurrent(projectId, chapterId, chapterToken)
            || saveToken !== Number(state.editorSaveToken || 0)) return false;

        // Update local state
        const idx = state.chapters.findIndex(c => c.id === ch.id);
        if (idx >= 0) state.chapters[idx] = updated;
        state.currentChapter = updated;
        state.isDirty = false;
        updateStatusBar();
        refreshChapterTree();
        window.AgentWorkbenchFeature?.refreshContext();
        if (!silent) showToast('已保存', 'success');
        return true;
    } catch (err) {
        if (!isEditorContextCurrent(projectId, chapterId, chapterToken)
            || saveToken !== Number(state.editorSaveToken || 0)) return false;
        if (handleEditorConflict(err, projectId, chapterId)) return false;
        setStatus(`保存失败: ${err.message}`, 'error');
        return false;
    }
}

function refreshChapterTree() {
    if (typeof ChapterTree !== 'undefined') {
        ChapterTree.render(state.chapters, state.currentChapter?.id);
    }
}

function onEditorInput() {
    state.isDirty = true;
    updateWordCount();
    updateStatusBar();
    autoSave();
}

function onTitleChange() {
    state.isDirty = true;
    $('#current-chapter-title').textContent = `- ${$('#chapter-title-input').value || '无标题'}`;
    updateStatusBar();
    autoSave();
}

function setChapterEditorEnabled(enabled) {
    $('#chapter-editor').disabled = !enabled;
    $('#chapter-title-input').disabled = !enabled;
    $('#chapter-select').disabled = !enabled;
    $('#btn-editor-bold').disabled = !enabled;
    $('#btn-editor-italic').disabled = !enabled;
    $('#btn-editor-format').disabled = !enabled;
}

function syncWorkspaceInteractivity() {
    setChapterEditorEnabled(Boolean(state.workspaceLoaded && state.currentChapter));
    const workspaceReady = Boolean(state.workspaceLoaded);
    const addChapterButton = $('#btn-add-chapter');
    if (addChapterButton) addChapterButton.disabled = !workspaceReady;
    const addVolumeButton = $('#btn-add-volume');
    if (addVolumeButton) addVolumeButton.disabled = !workspaceReady;
    window.AgentWorkbenchFeature?.setEnabled(workspaceReady);
}

function clearChapterEditor() {
    state.chapterContextToken = Number(state.chapterContextToken || 0) + 1;
    state.editorSaveToken = Number(state.editorSaveToken || 0) + 1;
    state.summaryRequestToken = Number(state.summaryRequestToken || 0) + 1;
    state.currentChapter = null;
    state.isDirty = false;
    $('#chapter-editor').value = '';
    $('#chapter-title-input').value = '';
    $('#current-chapter-title').textContent = '- 未选择章节';
    setChapterEditorEnabled(false);
    updateWordCount();
    updateStatusBar();
    refreshChapterTree();
}

function isEditorContextCurrent(projectId, chapterId, chapterToken) {
    return Boolean(projectId && chapterId)
        && state.currentNovel?.id === projectId
        && state.currentChapter?.id === chapterId
        && Number(state.chapterContextToken || 0) === chapterToken;
}

/**
 * Keep a local draft visible when a human/Agent write wins the CAS race.
 * The conflict is surfaced through the existing collaboration notice so the
 * user gets an explicit reload/copy decision instead of a generic save error.
 */
function handleEditorConflict(error, projectId, chapterId) {
    if (error?.code !== 'REVISION_CONFLICT') return false;
    state.externalChange = {
        kind: 'chapter',
        projectId,
        entityId: chapterId,
        details: error.details || null,
        detectedAt: Date.now(),
    };
    window.CuigengjiCollaboration?.reportConflict?.({
        projectId,
        entityType: 'chapter',
        entityId: chapterId,
        details: error.details || null,
    });
    setStatus('本章已被其他操作修改，当前本地内容未覆盖；请重新加载或复制后处理', 'warn');
    window.AgentWorkbenchFeature?.refreshContext(0);
    return true;
}
