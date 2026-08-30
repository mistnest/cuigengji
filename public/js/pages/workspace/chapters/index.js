/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
async function createChapter({ title, content = '', silent = false } = {}) {
    const projectId = state.currentNovel?.id;
    const workspaceToken = Number(state.workspaceActionToken || 0);
    const mutationToken = ++state.chapterMutationToken;
    if (!projectId) return null;
    const defaultTitle = `第${state.chapters.filter(c => c.type !== 'volume').length + 1}章`;
    const chapterTitle = title?.trim() || defaultTitle;
    try {
        const chapter = await Repositories.chapters.create(projectId, {
            title: chapterTitle,
            content,
        });
        if (!isChapterMutationCurrent(projectId, workspaceToken, mutationToken)) return null;
        state.chapters.push(chapter);
        loadChapter(chapter);
        if (!silent) setStatus(`已创建: ${chapterTitle}`, 'success');
        return chapter;
    } catch (err) {
        setStatus(`创建章节失败: ${err.message}`, 'error');
        return null;
    }
}

async function onAddChapter() {
    if (!state.workspaceLoaded) {
        setStatus('工作区正在加载，请稍候', 'loading');
        return;
    }
    if (state.isDirty && !await onSave({ silent: true })) return;
    await createChapter();
}

async function onAddVolume() {
    if (!state.workspaceLoaded) {
        setStatus('工作区正在加载，请稍候', 'loading');
        return;
    }
    const projectId = state.currentNovel?.id;
    const workspaceToken = Number(state.workspaceActionToken || 0);
    const mutationToken = ++state.chapterMutationToken;
    if (!projectId) return;
    const title = `第${state.chapters.filter(c => c.type === 'volume').length + 1}卷`;
    try {
        const volume = await Repositories.chapters.create(projectId, {
            title,
            type: 'volume',
        });
        if (!isChapterMutationCurrent(projectId, workspaceToken, mutationToken)) return;
        state.chapters.push(volume);
        refreshChapterTree();
        setStatus(`已创建: ${volume.title}`, 'success');
    } catch (err) {
        setStatus(`创建卷失败: ${err.message}`, 'error');
    }
}

async function switchChapter(id) {
    if (!id || id === state.currentChapter?.id) return true;
    const switchToken = (state.chapterSwitchToken || 0) + 1;
    state.chapterSwitchToken = switchToken;
    const projectId = state.currentNovel?.id;
    if (state.isDirty && !await onSave({ silent: true })) {
        refreshChapterTree();
        return false;
    }
    if (state.chapterSwitchToken !== switchToken || state.currentNovel?.id !== projectId) return false;
    const chapterMeta = state.chapters.find(item => item.id === id);
    if (!chapterMeta || chapterMeta.type === 'volume') return false;
    try {
        setStatus(`正在加载: ${chapterMeta.title}`, 'loading');
        const chapter = typeof chapterMeta.content === 'string'
            ? chapterMeta
            : await Repositories.chapters.get(projectId, id);
        if (state.chapterSwitchToken !== switchToken || state.currentNovel?.id !== projectId) return false;
        Object.assign(chapterMeta, chapter);
        loadChapter(chapterMeta, { refreshTree: false });
        ChapterTree?.select?.(chapterMeta.id);
        return true;
    } catch (error) {
        setStatus(`章节加载失败: ${error.message}`, 'error');
        refreshChapterTree();
        return false;
    }
}

async function onChapterTreeSelect(id) {
    await switchChapter(id);
}

async function onChapterTreeRename(id) {
    const ch = state.chapters.find(c => c.id === id);
    if (!ch) return;
    const projectId = state.currentNovel?.id;
    const workspaceToken = Number(state.workspaceActionToken || 0);
    const mutationToken = ++state.chapterMutationToken;
    const newTitle = prompt('重命名章节:', ch.title);
    if (newTitle && newTitle !== ch.title && projectId) {
        try {
            const updated = await Repositories.chapters.update(projectId, id, {
                title: newTitle,
                expectedRevision: ch.revision,
                expectedContentHash: ch.contentHash,
            });
            if (!isChapterMutationCurrent(projectId, workspaceToken, mutationToken)) return;
            Object.assign(ch, updated);
            if (state.currentChapter?.id === id) {
                state.currentChapter = ch;
                $('#chapter-title-input').value = newTitle;
                $('#current-chapter-title').textContent = `— ${newTitle}`;
            }
            refreshChapterTree();
            setStatus(`已重命名: ${newTitle}`, 'success');
        } catch (err) {
            if (err?.code === 'REVISION_CONFLICT') {
                window.CuigengjiCollaboration?.reportConflict?.({
                    projectId,
                    entityType: 'chapter',
                    entityId: id,
                    details: err.details || null,
                    error: err,
                });
            }
            setStatus(`重命名失败: ${err.message}`, 'error');
        }
    }
}

async function onChapterTreeDelete(id) {
    const item = state.chapters.find(chapter => chapter.id === id);
    if (!item) return;
    const projectId = state.currentNovel?.id;
    const workspaceToken = Number(state.workspaceActionToken || 0);
    const mutationToken = ++state.chapterMutationToken;
    if (!projectId) return;
    try {
        await Repositories.chapters.delete(projectId, id, {
            confirmed: true,
            expectedRevision: item.revision,
            expectedContentHash: item.contentHash,
        });

        if (!isChapterMutationCurrent(projectId, workspaceToken, mutationToken)) return;

        if (item.type === 'volume') {
            state.chapters.forEach(chapter => {
                if (chapter.volumeId === id) chapter.volumeId = '';
            });
        }
        state.chapters = state.chapters.filter(chapter => chapter.id !== id);
        if (state.currentChapter?.id === id) {
            clearChapterEditor();
        }
        sortChapterState();
        refreshChapterTree();
        setStatus(`已删除: ${item.title}`, 'success');
    } catch (err) {
        if (err?.code === 'REVISION_CONFLICT') {
            window.CuigengjiCollaboration?.reportConflict?.({
                projectId,
                entityType: item.type === 'volume' ? 'volume' : 'chapter',
                entityId: id,
                details: err.details || null,
                error: err,
            });
        }
        setStatus(`删除失败: ${err.message}`, 'error');
    }
}

async function onChapterTreeReorder({ chapterId, volumeId, beforeChapterId }) {
    const chapter = state.chapters.find(item => item.id === chapterId && item.type !== 'volume');
    if (!chapter) return;
    const projectId = state.currentNovel?.id;
    const workspaceToken = Number(state.workspaceActionToken || 0);
    const mutationToken = ++state.chapterMutationToken;
    if (!projectId) return;
    const snapshot = state.chapters.map(item => ({ ...item }));
    const sourceVolumeId = chapter.volumeId || '';
    const targetVolumeId = volumeId || '';
    const groups = new Map();
    for (const item of state.chapters.filter(item => item.type !== 'volume')) {
        const groupId = item.volumeId || '';
        if (!groups.has(groupId)) groups.set(groupId, []);
        if (item.id !== chapterId) groups.get(groupId).push(item);
    }
    if (!groups.has(targetVolumeId)) groups.set(targetVolumeId, []);
    const siblings = groups.get(targetVolumeId)
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const beforeIndex = beforeChapterId
        ? siblings.findIndex(item => item.id === beforeChapterId)
        : -1;
    const insertAt = beforeIndex >= 0 ? beforeIndex : siblings.length;
    siblings.splice(insertAt, 0, chapter);
    chapter.volumeId = targetVolumeId;
    siblings.forEach((item, index) => { item.order = index; });
    if (sourceVolumeId !== targetVolumeId) {
        const sourceSiblings = groups.get(sourceVolumeId) || [];
        sourceSiblings.forEach((item, index) => { item.order = index; });
    }
    const updates = [...new Set([
        ...siblings,
        ...(sourceVolumeId !== targetVolumeId ? (groups.get(sourceVolumeId) || []) : []),
    ])];
    sortChapterState();
    refreshChapterTree();

    try {
        for (const item of updates) {
            if (!isChapterMutationCurrent(projectId, workspaceToken, mutationToken)) return;
            const updated = await Repositories.chapters.update(projectId, item.id, {
                volumeId: item.volumeId || '',
                order: item.order,
                expectedRevision: item.revision,
                expectedContentHash: item.contentHash,
            });
            if (!isChapterMutationCurrent(projectId, workspaceToken, mutationToken)) return;
            Object.assign(item, updated);
        }
        sortChapterState();
        refreshChapterTree();
        setStatus(targetVolumeId ? '章节已移入卷' : '章节已移出卷', 'success');
    } catch (err) {
        // Some updates may already have committed when a later CAS check
        // fails.  Reload the authoritative list instead of rolling the UI
        // back to a snapshot that no longer matches disk.
        if (!isChapterMutationCurrent(projectId, workspaceToken, mutationToken)) return;
        if (err?.code === 'REVISION_CONFLICT') {
            window.CuigengjiCollaboration?.reportConflict?.({
                projectId,
                entityType: 'chapter',
                entityId: chapterId,
                details: err.details || null,
                error: err,
            });
        }
        state.chapters = await Repositories.chapters.list(projectId)
            .catch(() => snapshot);
        if (!isChapterMutationCurrent(projectId, workspaceToken, mutationToken)) return;
        refreshChapterTree();
        setStatus(`移动章节失败: ${err.message}`, 'error');
    }
}

function isChapterMutationCurrent(projectId, workspaceToken, mutationToken) {
    return Boolean(projectId)
        && state.currentNovel?.id === projectId
        && Number(state.workspaceActionToken || 0) === workspaceToken
        && Number(state.chapterMutationToken || 0) === mutationToken;
}

function sortChapterState() {
    const volumes = state.chapters.filter(item => item.type === 'volume');
    const chapters = state.chapters.filter(item => item.type !== 'volume');
    const byOrder = (a, b) =>
        Number(a.order || 0) - Number(b.order || 0)
        || Number(a.created || 0) - Number(b.created || 0);
    const ordered = [];
    volumes.forEach(volume => {
        ordered.push(volume);
        ordered.push(...chapters.filter(chapter => chapter.volumeId === volume.id).sort(byOrder));
    });
    ordered.push(...chapters.filter(chapter => !chapter.volumeId).sort(byOrder));
    state.chapters = ordered;
}
