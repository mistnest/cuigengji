(function () {
    'use strict';

    const desktopAgent = window.DesktopApi?.agent;
    const desktopOutlines = window.DesktopApi?.project?.outlines;
    const store = window.AgentStoreModule.createAgentStore();
    let root;
    let getContext = () => ({});
    let beforeOpen = async () => {};
    let onStatus = () => {};
    let onOutlinePatchApplied = async () => {};
    let getOutlineRevision = () => 0;
    let enabled = false;
    let visible = true;
    let mounted = false;
    let openPromise = null;
    let openProjectId = '';
    let openToken = 0;
    let refreshTimer = null;
    let refreshToken = 0;
    let openTimer = null;
    let sessionActionToken = 0;
    let proposalActionToken = 0;
    let sendToken = 0;
    let disposers = [];

    function mount(options = {}) {
        if (mounted) return unmount;
        mounted = true;
        root = options.root || document.getElementById('agent-sidebar-root');
        getContext = options.getContext || getContext;
        beforeOpen = options.beforeOpen || beforeOpen;
        onStatus = options.onStatus || onStatus;
        onOutlinePatchApplied = options.onOutlinePatchApplied || onOutlinePatchApplied;
        getOutlineRevision = options.getOutlineRevision || getOutlineRevision;
        if (!root) return unmount;
        const conversationDispose = window.AgentConversationModule.mountAgentConversation({
            store,
            viewport: root.querySelector('.agent-conversation'),
            list: root.querySelector('.agent-conversation__list'),
            empty: root.querySelector('.agent-empty-state'),
            jumpButton: root.querySelector('.agent-jump-bottom'),
            onApplyProposal: applyOutlineProposal,
            getOutlineRevision,
        });
        const composerDispose = window.AgentComposerModule.mountAgentComposer({
            store,
            form: root.querySelector('.agent-composer'),
            textarea: root.querySelector('.agent-composer__input'),
            sendButton: root.querySelector('.agent-composer__send'),
            cancelButton: root.querySelector('.agent-composer__cancel'),
            modeButton: root.querySelector('.agent-composer__mode'),
            onSend: send,
            onCancel: cancel,
        });
        const unsubscribeStore = store.subscribe(renderChrome);
        const unsubscribeEvents = desktopAgent?.onEvent(event => store.applyEvent(event)) || (() => {});
        const unsubscribeProjectChanges = window.CuigengjiProjectEvents?.subscribe(handleProjectChange)
            || (() => {});
        const newSessionButton = root.querySelector('.agent-new-session');
        const sessionsButton = root.querySelector('.agent-session-menu-button');
        const retryButton = root.querySelector('.agent-retry');
        newSessionButton.addEventListener('click', createSession);
        sessionsButton.addEventListener('click', toggleSessionMenu);
        retryButton.addEventListener('click', retry);
        disposers = [
            conversationDispose, composerDispose, unsubscribeStore, unsubscribeEvents,
            unsubscribeProjectChanges,
            () => newSessionButton.removeEventListener('click', createSession),
            () => sessionsButton.removeEventListener('click', toggleSessionMenu),
            () => retryButton.removeEventListener('click', retry),
        ];
        return unmount;
    }

    function unmount() {
        openToken += 1;
        refreshToken += 1;
        sessionActionToken += 1;
        proposalActionToken += 1;
        sendToken += 1;
        clearTimeout(refreshTimer);
        clearTimeout(openTimer);
        for (const dispose of disposers.splice(0)) dispose();
        mounted = false;
    }
    function setEnabled(value) {
        enabled = Boolean(value);
        if (!enabled) {
            openToken += 1;
            refreshToken += 1;
            sessionActionToken += 1;
            proposalActionToken += 1;
            sendToken += 1;
            clearTimeout(refreshTimer);
            clearTimeout(openTimer);
            store.clear();
            return;
        }
        scheduleOpen();
    }
    function setVisible(value) {
        visible = Boolean(value);
        if (visible && enabled && !store.getState().activeSessionId) scheduleOpen(0);
    }
    function scheduleOpen(delay = 80) {
        clearTimeout(openTimer);
        openTimer = setTimeout(() => {
            if (enabled) void open();
        }, delay);
    }

    async function open({ force = false } = {}) {
        if (!desktopAgent || !enabled) return undefined;
        const requestedContext = getContext();
        if (!requestedContext?.projectId) return undefined;
        if (openPromise) {
            if (!force && openProjectId === requestedContext.projectId) return openPromise;
            const activeOpen = openPromise;
            if (force) openToken += 1;
            await activeOpen.catch(() => {});
            if (openPromise === activeOpen) {
                openPromise = null;
                openProjectId = '';
            }
            if (!enabled || !getContext()?.projectId) return undefined;
            return open({ force: true });
        }
        const context = requestedContext;
        if (!force && store.getState().project.projectId === context.projectId
            && store.getState().runtime.ready) return undefined;
        const requestToken = ++openToken;
        const requestedProjectId = context.projectId;
        const isCurrentOpen = () => enabled
            && requestToken === openToken
            && getContext()?.projectId === requestedProjectId;
        store.applyEvent({
            schemaVersion: 1,
            type: 'runtime.state',
            projectId: context.projectId,
            generation: store.getState().runtime.generation,
            data: { state: 'starting', ready: false, message: '正在启动 Agent…' },
        });
        const operation = (async () => {
            await beforeOpen();
            if (!isCurrentOpen()) return undefined;
            const project = await desktopAgent.openProject(context);
            if (!isCurrentOpen() || project?.projectId !== requestedProjectId) return undefined;
            store.setProject(project);
            const [history, sessions] = await Promise.all([
                desktopAgent.getHistory({
                    projectId: project.projectId,
                    sessionId: project.sessionId,
                    maxMessages: 30,
                }),
                desktopAgent.listSessions({ projectId: project.projectId }),
            ]);
            if (!isCurrentOpen() || store.getState().project.projectId !== requestedProjectId) {
                return undefined;
            }
            store.applyHistory(project.sessionId, history.events);
            store.setSessions(sessions);
            report(project.status.hasCredential ? 'success' : 'warn', project.status.hasCredential
                ? 'Agent 已就绪。'
                : '请先在 AI 设置中保存所选模型服务的 API Key。');
            return project;
        })().catch(error => {
            if (!isCurrentOpen()) return undefined;
            report('error', `Agent 启动失败：${error.message}`);
            return undefined;
        });
        openPromise = operation;
        openProjectId = requestedProjectId;
        operation.then(() => {
            if (openPromise === operation) {
                openPromise = null;
                openProjectId = '';
            }
        }, () => {
            if (openPromise === operation) {
                openPromise = null;
                openProjectId = '';
            }
        });
        return operation;
    }

    async function send(rawText) {
        const text = String(rawText || '').trim();
        const state = store.getState();
        if (!text || !state.activeSessionId || state.project.contextState === 'stale'
            || state.project.contextState === 'syncing' || state.project.contextState === 'error') return;
        const requestToken = ++sendToken;
        const projectId = state.project.projectId;
        const sessionId = state.activeSessionId;
        const mode = state.running ? state.composer.mode : 'queue';
        const pendingId = store.addOptimistic(text, mode);
        try {
            await desktopAgent.prompt({
                projectId,
                sessionId,
                text,
                mode,
            });
            if (requestToken === sendToken
                && store.getState().project.projectId === projectId
                && store.getState().activeSessionId === sessionId) {
                store.acceptOptimistic(pendingId);
            }
        } catch (error) {
            if (requestToken !== sendToken
                || store.getState().project.projectId !== projectId
                || store.getState().activeSessionId !== sessionId) return;
            store.rejectOptimistic(pendingId, error.message || '发送失败');
        }
    }
    async function cancel() {
        const state = store.getState();
        if (!state.activeSessionId || !state.running) return;
        const projectId = state.project.projectId;
        const sessionId = state.activeSessionId;
        const actionToken = ++sessionActionToken;
        try {
            await desktopAgent.cancel({
                projectId,
                sessionId,
            });
        } catch (error) {
            if (actionToken !== sessionActionToken
                || getContext()?.projectId !== projectId
                || store.getState().project.projectId !== projectId
                || store.getState().activeSessionId !== sessionId) return;
            report('error', `停止失败：${error.message}`);
        }
    }
    async function createSession() {
        const state = store.getState();
        if (!state.project.projectId || state.running) return;
        const projectId = state.project.projectId;
        const actionToken = ++sessionActionToken;
        try {
            const created = await desktopAgent.createSession({ projectId });
            if (actionToken !== sessionActionToken
                || getContext()?.projectId !== projectId
                || store.getState().project.projectId !== projectId) return;
            store.setActiveSession(created.sessionId);
            const sessions = await desktopAgent.listSessions({ projectId });
            if (actionToken !== sessionActionToken
                || getContext()?.projectId !== projectId
                || store.getState().project.projectId !== projectId) return;
            store.setSessions(sessions);
            closeSessionMenu();
        } catch (error) {
            if (actionToken !== sessionActionToken
                || getContext()?.projectId !== projectId
                || store.getState().project.projectId !== projectId) return;
            report('error', `新建会话失败：${error.message}`);
        }
    }

    async function applyOutlineProposal(proposal) {
        const state = store.getState();
        if (!desktopOutlines || !state.project.projectId || !proposal?.proposalId) return;
        const projectId = state.project.projectId;
        const actionToken = ++proposalActionToken;
        const isCurrentProposal = () => actionToken === proposalActionToken
            && enabled
            && getContext()?.projectId === projectId
            && store.getState().project.projectId === projectId;
        if (Number(getOutlineRevision()) !== Number(proposal.baseRevision)) {
            store.setProposalApplyState(
                proposal.proposalId,
                'error',
                '当前大纲已经变化，请让 Agent 基于最新版本重新整理。',
            );
            return;
        }
        let confirmed = true;
        if (proposal.hasDelete) {
            confirmed = window.confirm('该提案包含删除大纲节点的操作。确认应用整组修改吗？');
        }
        if (!confirmed) return;
        if (!isCurrentProposal()) return;
        store.setProposalApplyState(proposal.proposalId, 'applying', '正在验证并应用整组修改…');
        try {
            const result = await desktopOutlines.applyPatch(projectId, {
                expectedRevision: proposal.baseRevision,
                operations: proposal.operations,
                confirmed,
            });
            if (!isCurrentProposal()) return;
            await onOutlinePatchApplied(result);
            if (!isCurrentProposal()) return;
            store.setProposalApplyState(
                proposal.proposalId,
                'applied',
                `已应用，大纲版本更新为 ${result.revision}。`,
            );
            refreshContext(0);
            report('success', `已应用 ${result.operationCount} 项大纲修改。`);
        } catch (error) {
            if (!isCurrentProposal()) return;
            store.setProposalApplyState(
                proposal.proposalId,
                'error',
                error.message || '大纲修改应用失败。',
            );
            report('error', `大纲修改应用失败：${error.message}`);
        }
    }

    function refreshContext(delay = 250) {
        const requestToken = ++refreshToken;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            const context = getContext();
            if (requestToken !== refreshToken || !enabled || !context.projectId
                || !store.getState().runtime.ready
                || store.getState().project.projectId !== context.projectId) return;
            store.setContextState('syncing');
            try {
                const result = await desktopAgent.refreshContext(context);
                if (requestToken !== refreshToken || !enabled
                    || getContext()?.projectId !== context.projectId
                    || store.getState().project.projectId !== context.projectId) return;
                const nextContext = result.context || {};
                store.setContextState(nextContext.contextState === 'stale' ? 'stale' : 'synced', {
                    chapterId: context.chapterId || '',
                    generatedAt: result.generatedAt || nextContext.generatedAt || '',
                    projectChangeSeq: Number(
                        result.projectChangeSeq ?? nextContext.projectChangeSeq ?? 0,
                    ),
                    lastChangeSeq: Number(nextContext.lastChangeSeq || 0),
                    snapshotId: nextContext.snapshotId || '',
                    streamId: nextContext.streamId || '',
                    knowledgeEntries: Number(nextContext.knowledgeEntries || 0),
                });
            } catch (error) {
                if (requestToken !== refreshToken || !enabled
                    || getContext()?.projectId !== context.projectId
                    || store.getState().project.projectId !== context.projectId) return;
                store.setContextState('error');
                report('warn', `Agent 上下文刷新失败：${error.message}`);
            }
        }, delay);
    }

    function handleProjectChange(event) {
        const current = store.getState();
        if (!event?.projectId || event.projectId !== current.project.projectId) return;
        store.setProjectChange(event);
        refreshContext(80);
    }
    function retry() { void open({ force: true }); }
    function toggleSessionMenu() {
        const menu = root.querySelector('.agent-session-menu');
        menu.hidden = !menu.hidden;
        if (!menu.hidden) renderSessionMenu();
    }
    function closeSessionMenu() { root.querySelector('.agent-session-menu').hidden = true; }
    function renderSessionMenu() {
        const state = store.getState();
        const menu = root.querySelector('.agent-session-menu');
        menu.replaceChildren(...state.sessions.map(session => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'agent-session-row';
            button.classList.toggle('is-active', session.sessionId === state.activeSessionId);
            button.textContent = session.blank ? '新会话' : `会话 · ${new Date(session.updatedAt).toLocaleString()}`;
            button.addEventListener('click', async () => {
                const actionToken = ++sessionActionToken;
                const projectId = state.project.projectId;
                try {
                    await desktopAgent.activateSession({
                        projectId,
                        sessionId: session.sessionId,
                    });
                    if (actionToken !== sessionActionToken
                        || getContext()?.projectId !== projectId
                        || store.getState().project.projectId !== projectId) return;
                    store.setActiveSession(session.sessionId);
                    const history = await desktopAgent.getHistory({
                        projectId,
                        sessionId: session.sessionId,
                        maxMessages: 30,
                    });
                    if (actionToken !== sessionActionToken
                        || getContext()?.projectId !== projectId
                        || store.getState().project.projectId !== projectId
                        || store.getState().activeSessionId !== session.sessionId) return;
                    store.applyHistory(session.sessionId, history.events);
                    closeSessionMenu();
                } catch (error) {
                    if (actionToken !== sessionActionToken
                        || getContext()?.projectId !== projectId
                        || store.getState().project.projectId !== projectId) return;
                    report('error', `切换会话失败：${error.message}`);
                }
            });
            return button;
        }));
    }

    function renderChrome(state) {
        if (!root) return;
        const status = root.querySelector('.agent-runtime-status');
        status.dataset.state = state.runtime.state;
        status.querySelector('.agent-runtime-status__text').textContent = statusText(state.runtime);
        root.querySelector('.agent-context-bar__chapter').textContent = state.project.chapterId
            ? '当前章节已接入' : '未选择章节';
        const sync = root.querySelector('.agent-context-bar__sync');
        sync.textContent = contextText(state.project.contextState);
        if (state.project.lastChangedEntity) {
            const changed = state.project.lastChangedEntity;
            sync.title = `${changed.actor?.kind === 'agent' ? 'Agent' : '项目'}更新了${changed.entityType || '资料'}（版本 ${changed.revision || 0}）`;
        } else {
            sync.removeAttribute('title');
        }
        root.querySelector('.agent-new-session').disabled = !state.runtime.ready || state.running;
        root.querySelector('.agent-retry').hidden = state.runtime.state !== 'failed';
        root.dataset.visible = String(visible);
    }
    function statusText(runtime) {
        if (!runtime.hasCredential && runtime.state === 'ready') return '缺少 API Key';
        if (runtime.state === 'ready') return '已就绪';
        if (runtime.state === 'starting') return '启动中';
        if (runtime.state === 'reconnecting') return '正在重连';
        if (runtime.state === 'failed') return '需要重试';
        return '未启动';
    }
    function contextText(value) {
        if (value === 'stale') return '项目已变化，正在同步';
        if (value === 'syncing') return '上下文同步中';
        if (value === 'error') return '上下文同步失败';
        if (value === 'synced') return '上下文已同步';
        return '等待项目';
    }
    function report(type, message) { onStatus({ type, message }); }

    window.AgentWorkbenchFeature = Object.freeze({
        mount, unmount, open, setEnabled, setVisible, refreshContext, store,
    });
}());
