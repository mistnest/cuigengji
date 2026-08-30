/**
 * Renderer-side collaboration coordinator.
 *
 * Domain writes are committed by the trusted main process and announced on
 * the project event channel.  This module keeps the existing editor/sidebar
 * as the single workspace surface: clean views refresh automatically, while
 * dirty views receive an explicit, reversible reload choice.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
(function (root) {
    let unsubscribe = null;
    let notice = null;
    const seenEvents = new Set();
    const latestEvents = new Map();
    let lifecycleToken = 0;
    let reloadInFlight = false;
    let activeProjectId = '';

    function start() {
        if (unsubscribe || !root.CuigengjiProjectEvents?.subscribe) return;
        unsubscribe = root.CuigengjiProjectEvents.subscribe(handleChange);
    }

    function stop() {
        lifecycleToken += 1;
        activeProjectId = '';
        unsubscribe?.();
        unsubscribe = null;
        notice?.remove();
        notice = null;
        seenEvents.clear();
        latestEvents.clear();
    }

    /**
     * Advance the renderer lifecycle whenever the active project changes.
     * Event reconciliation is asynchronous; without a project boundary an
     * old `get`/reload response could land after a quick project switch (or
     * after switching back to the same id) and mutate the new view.
     */
    function setProject(projectId) {
        const nextProjectId = typeof projectId === 'string' ? projectId : '';
        if (nextProjectId === activeProjectId) return lifecycleToken;
        lifecycleToken += 1;
        activeProjectId = nextProjectId;
        reloadInFlight = false;
        notice?.remove();
        notice = null;
        seenEvents.clear();
        latestEvents.clear();
        if (state.externalChange) state.externalChange = null;
        return lifecycleToken;
    }

    function handleChange(event) {
        if (!event?.projectId || typeof state === 'undefined'
            || event.projectId !== state.currentNovel?.id) return;
        const key = `${event.streamId || 'default'}:${event.seq || event.eventId || ''}`;
        if (seenEvents.has(key)) return;
        seenEvents.add(key);
        if (seenEvents.size > 2_000) seenEvents.delete(seenEvents.values().next().value);
        const entityKey = `${event.streamId || 'default'}:${event.entityType || 'project'}:${event.entityId || event.projectId}`;
        const previous = latestEvents.get(entityKey);
        if (!previous || Number(event.seq || 0) >= Number(previous.seq || 0)) {
            latestEvents.set(entityKey, event);
        }

        // Every renderer gets a stable per-window identity from preload.  A
        // write made by this window is an acknowledgement, not an external
        // edit.  Advance the local baseline immediately so a following Agent
        // open/refresh cannot submit a stale workspace revision while the
        // renderer is still processing the IPC response.
        if (isOwnRendererEvent(event)) {
            acknowledgeOwnWrite(event);
            // The event bus broadcasts every committed aggregate, including
            // worldbook/character records that this renderer may not have in
            // its current view.  An echo of our own write is an acknowledgement
            // for every entity type, never an external-edit warning.
            return;
        }

        // The IPC response and its broadcast are delivered on adjacent event
        // loop turns. Give the local response a chance to update its revision
        // before treating a renderer-originated echo as an external edit.
        if (event.actor?.kind === 'human' && event.actor?.id === 'renderer'
            && !isAlreadyApplied(event)) {
            setTimeout(() => {
                if (isLatestEvent(event) && !isAlreadyApplied(event)) processChange(event);
            }, 25);
            return;
        }
        processChange(event);
    }

    function isOwnRendererEvent(event) {
        const clientId = root.cuigengji?.project?.clientId;
        return Boolean(clientId && event?.actor?.kind === 'human'
            && event.actor.id === clientId);
    }

    function acknowledgeOwnWrite(event) {
        const revision = Number(event.revision || 0);
        if (!Number.isFinite(revision) || revision <= 0) return;
        if (event.entityType === 'workspace') {
            state.workspaceRevision = Math.max(Number(state.workspaceRevision || 0), revision);
            if (event.contentHash) state.workspaceContentHash = event.contentHash;
        } else if (event.entityType === 'outline') {
            state.outlineRevision = Math.max(Number(state.outlineRevision || 0), revision);
            if (event.contentHash) state.outlineContentHash = event.contentHash;
        } else if (event.entityType === 'chapter') {
            const local = state.chapters?.find(item => item.id === event.entityId)
                || (state.currentChapter?.id === event.entityId ? state.currentChapter : null);
            if (local) {
                local.revision = Math.max(Number(local.revision || 0), revision);
                if (event.contentHash) local.contentHash = event.contentHash;
            }
        }
        // An acknowledgement supersedes a stale conflict notice for the same
        // resource, but never clears a conflict belonging to another event.
        const conflict = state.externalChange;
        const conflictEvent = conflict?.event;
        const sameResource = Boolean(conflict
            && conflict.projectId === event.projectId
            && conflict.kind === event.entityType
            && (!conflictEvent || conflictEvent.entityId === event.entityId));
        if (conflictEvent?.eventId === event.eventId || sameResource) {
            state.externalChange = null;
        }
        // A create/delete response may be ignored by a newer renderer action
        // token.  Reconcile those structural changes from the authoritative
        // chapter index after the normal IPC response has had a chance to
        // update local state, so a fast double-click cannot hide a chapter.
        if ((event.entityType === 'chapter' || event.entityType === 'volume')
            && ['created', 'deleted'].includes(event.operation)) {
            const token = lifecycleToken;
            setTimeout(() => {
                if (isCurrentProject(event.projectId, token) && isLatestEvent(event)) {
                    processChange(event);
                }
            }, 25);
        }
        root.AgentWorkbenchFeature?.refreshContext(0);
    }

    function processChange(event) {
        if (!isLatestEvent(event)) return;
        // A local response already contains the committed revision.  Ignore
        // the broadcast echo, but keep the Agent context synchronised.
        if (isAlreadyApplied(event)) {
            root.AgentWorkbenchFeature?.refreshContext(0);
            return;
        }

        if (event.entityType === 'chapter' || event.entityType === 'volume') {
            void reconcileChapter(event);
            return;
        }
        if (event.entityType === 'outline') {
            void reconcileOutline(event);
            return;
        }

        // Workspace/reference aggregates do not expose a local dirty bit for
        // every control.  Do not silently replace user edits; show a compact
        // choice in the existing status bar instead.
        markExternalChange(event);
    }

    function isAlreadyApplied(event) {
        const revision = Number(event.revision || 0);
        if (event.entityType === 'chapter') {
            const local = state.chapters?.find(item => item.id === event.entityId)
                || (state.currentChapter?.id === event.entityId ? state.currentChapter : null);
            return local && revision > 0 && Number(local.revision || 0) >= revision;
        }
        if (event.entityType === 'outline') return Number(state.outlineRevision || 0) >= revision;
        if (event.entityType === 'workspace') return Number(state.workspaceRevision || 0) >= revision;
        return false;
    }

    function isLatestEvent(event) {
        const key = `${event.streamId || 'default'}:${event.entityType || 'project'}:${event.entityId || event.projectId}`;
        const latest = latestEvents.get(key);
        return !latest || latest.eventId === event.eventId
            || Number(latest.seq || 0) <= Number(event.seq || 0);
    }

    async function reconcileChapter(event) {
        const projectId = event.projectId;
        const token = lifecycleToken;
        // Deletions (and volume mutations, which can move several chapters)
        // cannot be reconciled by fetching one chapter id.  Reload the small
        // chapter index and only replace the active editor when it is safe.
        if (event.operation === 'deleted' || event.entityType === 'volume') {
            if (state.isDirty && (event.entityType === 'volume'
                || state.currentChapter?.id === event.entityId)) {
                markExternalChange(event);
                return;
            }
            try {
                const chapters = await Repositories.chapters.list(projectId);
                if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
                const currentId = state.currentChapter?.id || '';
                state.chapters = Array.isArray(chapters) ? chapters : [];
                const replacement = state.chapters.find(item => item.id === currentId
                    && item.type !== 'volume');
                if (replacement) {
                    const chapter = typeof replacement.content === 'string'
                        ? replacement
                        : await Repositories.chapters.get(projectId, currentId);
                    if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
                    Object.assign(replacement, chapter);
                    if (state.currentChapter?.id === currentId) {
                        loadChapter(replacement, { refreshTree: false });
                    }
                } else if (state.currentChapter?.id === currentId) {
                    clearChapterEditor();
                }
                refreshChapterTree();
                state.externalChange = null;
                setStatus('章节目录已同步更新', 'success');
                root.AgentWorkbenchFeature?.refreshContext(0);
            } catch (error) {
                markExternalChange(event, error);
            }
            return;
        }
        const local = state.chapters?.find(item => item.id === event.entityId);
        if (local && Number(local.revision || 0) >= Number(event.revision || 0)) return;
        if (state.isDirty && state.currentChapter?.id === event.entityId) {
            markExternalChange(event);
            return;
        }
        try {
            const chapter = await Repositories.chapters.get(projectId, event.entityId);
            if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
            const index = state.chapters.findIndex(item => item.id === event.entityId);
            if (index >= 0) state.chapters[index] = chapter;
            else state.chapters.push(chapter);
            if (state.currentChapter?.id === event.entityId) {
                loadChapter(chapter, { refreshTree: false });
            }
            refreshChapterTree();
            state.externalChange = null;
            setStatus('章节已同步更新', 'success');
            root.AgentWorkbenchFeature?.refreshContext(0);
        } catch (error) {
            markExternalChange(event, error);
        }
    }

    async function reconcileOutline(event) {
        const projectId = event.projectId;
        const token = lifecycleToken;
        if (Number(state.outlineRevision || 0) >= Number(event.revision || 0)) return;
        try {
            const result = await Repositories.outlines.get(projectId);
            if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
            state.outline = Array.isArray(result?.nodes) ? result.nodes : [];
            state.outlineRevision = Number(result?.revision || 0);
            state.outlineContentHash = String(result?.contentHash || state.outlineContentHash || '');
            renderOutlineTree();
            state.externalChange = null;
            setStatus('大纲已同步更新', 'success');
            root.AgentWorkbenchFeature?.refreshContext(0);
        } catch (error) {
            markExternalChange(event, error);
        }
    }

    function markExternalChange(event, error) {
        if (!isCurrentProject(event?.projectId, lifecycleToken) || !isLatestEvent(event)) return;
        state.externalChange = {
            kind: event.entityType || 'project',
            projectId: event.projectId,
            event,
            error: error ? String(error.message || error) : '',
            detectedAt: Date.now(),
        };
        const actor = event.actor?.kind === 'agent' ? 'Agent' : '其他操作';
        setStatus(`检测到${actor}修改，当前内容未被覆盖`, 'warn');
        showNotice(event, actor);
        root.AgentWorkbenchFeature?.refreshContext(0);
    }

    /**
     * Surface a CAS conflict even when the competing writer was an external
     * process and therefore could not publish a live domain event.  The
     * synthetic event is deliberately local (seq 0) and is not inserted into
     * the replay index, so it can never hide a later authoritative event.
     */
    function reportConflict(input = {}) {
        const projectId = String(input.projectId || state.currentNovel?.id || '');
        if (!isCurrentProject(projectId, lifecycleToken)) return false;
        const details = input.details && typeof input.details === 'object' ? input.details : {};
        markExternalChange({
            schemaVersion: 1,
            type: 'project.changed',
            eventId: `local-conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            streamId: 'local-conflict',
            projectId,
            seq: 0,
            entityType: input.entityType || 'project',
            entityId: input.entityId || projectId,
            operation: 'updated',
            revision: Number(details.currentRevision || details.currentVersion?.revision || 0),
            updatedAt: Date.now(),
            contentHash: String(details.currentContentHash || ''),
            changedFields: [],
            actor: { kind: 'system', id: 'cas-conflict' },
        }, input.error);
        return true;
    }

    function showNotice(event, actor) {
        const bar = document.getElementById('status-bar');
        if (!bar) return;
        if (!notice) {
            notice = document.createElement('span');
            notice.id = 'collaboration-notice';
            notice.className = 'collaboration-notice';
            bar.appendChild(notice);
        }
        notice.replaceChildren();
        const text = document.createElement('span');
        text.textContent = `${actor}已更新${labelFor(event.entityType)}。`;
        const reload = document.createElement('button');
        reload.type = 'button';
        reload.textContent = '重新加载';
        reload.addEventListener('click', () => { void reloadFromDisk(event); });
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = '稍后';
        dismiss.addEventListener('click', () => {
            notice?.remove();
            notice = null;
        }, { once: true });
        notice.append(text, reload, dismiss);
    }

    async function reloadFromDisk(event) {
        if (reloadInFlight) return;
        const projectId = event?.projectId;
        let token = lifecycleToken;
        if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
        const aggregateReload = !['chapter', 'volume', 'outline'].includes(event.entityType);
        const workspaceDraft = aggregateReload
            && (state.workspaceDirty || root.CuigengjiWorkspacePersistence?.isDirty?.());
        const hasLocalDraft = Boolean(state.isDirty || workspaceDraft);
        if (hasLocalDraft && !safeConfirm(
            aggregateReload && state.isDirty && workspaceDraft
                ? '当前章节和工作区都有未保存修改，重新加载会放弃本地修改。继续吗？'
                : state.isDirty
                    ? '当前章节有未保存修改，重新加载会放弃本地修改。继续吗？'
                    : '当前工作区有未保存修改，重新加载会放弃本地修改。继续吗？',
        )) return;
        if (hasLocalDraft) {
            // Invalidate delayed editor/auto-save callbacks before replacing
            // state.  An already sent request remains CAS-protected; its
            // eventual result is ignored and the subsequent read wins.
            root.CuigengjiWorkspaceLifecycle?.invalidate?.();
            state.isDirty = false;
            state.workspaceDirty = false;
        }
        token = lifecycleToken;
        reloadInFlight = true;
        try {
            if (event.entityType === 'chapter' && event.operation === 'deleted') {
                const chapters = await Repositories.chapters.list(projectId);
                if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
                const currentId = state.currentChapter?.id || '';
                state.chapters = Array.isArray(chapters) ? chapters : [];
                if (!state.chapters.some(item => item.id === currentId)) clearChapterEditor();
                refreshChapterTree();
            } else if (event.entityType === 'chapter') {
                const chapter = await Repositories.chapters.get(projectId, event.entityId);
                if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
                const index = state.chapters.findIndex(item => item.id === event.entityId);
                if (index >= 0) state.chapters[index] = chapter;
                if (state.currentChapter?.id === event.entityId) loadChapter(chapter, { refreshTree: false });
                refreshChapterTree();
            } else if (event.entityType === 'volume') {
                const chapters = await Repositories.chapters.list(projectId);
                if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
                state.chapters = Array.isArray(chapters) ? chapters : [];
                const currentId = state.currentChapter?.id || '';
                const replacement = state.chapters.find(item => item.id === currentId
                    && item.type !== 'volume');
                if (replacement) {
                    const chapter = typeof replacement.content === 'string'
                        ? replacement
                        : await Repositories.chapters.get(projectId, currentId);
                    if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
                    Object.assign(replacement, chapter);
                    if (state.currentChapter?.id === currentId) {
                        loadChapter(replacement, { refreshTree: false });
                    }
                } else if (currentId) {
                    clearChapterEditor();
                }
                refreshChapterTree();
            } else if (event.entityType === 'outline') {
                const result = await Repositories.outlines.get(projectId);
                if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
                state.outline = Array.isArray(result?.nodes) ? result.nodes : [];
                state.outlineRevision = Number(result?.revision || 0);
                state.outlineContentHash = String(result?.contentHash || state.outlineContentHash || '');
                renderOutlineTree();
            } else {
                // Re-entering the current workspace reloads all aggregate
                // records through the normal, already-tested path.
                // Mark it unloaded so enterWorkspace does not attempt to save
                // the view we just decided to discard.
                state.workspaceLoaded = false;
                await enterWorkspace(projectId, state.currentNovel.title);
                if (!isCurrentProject(projectId, token) || !isLatestEvent(event)) return;
            }
            state.externalChange = null;
            notice?.remove();
            notice = null;
            setStatus('已从最新版本重新加载', 'success');
        } catch (error) {
            setStatus(`重新加载失败: ${error.message}`, 'error');
        } finally {
            reloadInFlight = false;
        }
    }

    function isCurrentProject(projectId, token) {
        return token === lifecycleToken && Boolean(projectId)
            && state.currentNovel?.id === projectId;
    }

    function labelFor(type) {
        return type === 'chapter' ? '章节' : type === 'outline' ? '大纲' : type === 'worldbook'
            ? '世界书' : type === 'character' ? '角色卡' : '项目资料';
    }

    root.CuigengjiCollaboration = Object.freeze({
        start, stop, setProject, reloadFromDisk, reportConflict,
    });
    start();
}(window));
