(function () {
    'use strict';

    const desktopAgent = window.DesktopApi?.agent;
    const store = window.AgentStoreModule.createAgentStore();
    let root;
    let getContext = () => ({});
    let beforeOpen = async () => {};
    let onStatus = () => {};
    let enabled = false;
    let visible = true;
    let mounted = false;
    let openPromise = null;
    let refreshTimer = null;
    let openTimer = null;
    let disposers = [];

    function mount(options = {}) {
        if (mounted) return unmount;
        mounted = true;
        root = options.root || document.getElementById('agent-sidebar-root');
        getContext = options.getContext || getContext;
        beforeOpen = options.beforeOpen || beforeOpen;
        onStatus = options.onStatus || onStatus;
        if (!root) return unmount;
        const conversationDispose = window.AgentConversationModule.mountAgentConversation({
            store,
            viewport: root.querySelector('.agent-conversation'),
            list: root.querySelector('.agent-conversation__list'),
            empty: root.querySelector('.agent-empty-state'),
            jumpButton: root.querySelector('.agent-jump-bottom'),
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
        const newSessionButton = root.querySelector('.agent-new-session');
        const sessionsButton = root.querySelector('.agent-session-menu-button');
        const retryButton = root.querySelector('.agent-retry');
        newSessionButton.addEventListener('click', createSession);
        sessionsButton.addEventListener('click', toggleSessionMenu);
        retryButton.addEventListener('click', retry);
        disposers = [
            conversationDispose, composerDispose, unsubscribeStore, unsubscribeEvents,
            () => newSessionButton.removeEventListener('click', createSession),
            () => sessionsButton.removeEventListener('click', toggleSessionMenu),
            () => retryButton.removeEventListener('click', retry),
        ];
        return unmount;
    }

    function unmount() {
        clearTimeout(refreshTimer);
        clearTimeout(openTimer);
        for (const dispose of disposers.splice(0)) dispose();
        mounted = false;
    }
    function setEnabled(value) {
        enabled = Boolean(value);
        if (!enabled) {
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
        if (!desktopAgent || openPromise) return openPromise;
        const context = getContext();
        if (!context?.projectId) return undefined;
        if (!force && store.getState().project.projectId === context.projectId
            && store.getState().runtime.ready) return undefined;
        store.applyEvent({
            schemaVersion: 1,
            type: 'runtime.state',
            projectId: context.projectId,
            generation: store.getState().runtime.generation,
            data: { state: 'starting', ready: false, message: '正在启动 Agent…' },
        });
        openPromise = (async () => {
            await beforeOpen();
            const project = await desktopAgent.openProject(context);
            store.setProject(project);
            const [history, sessions] = await Promise.all([
                desktopAgent.getHistory({
                    projectId: project.projectId,
                    sessionId: project.sessionId,
                    maxMessages: 30,
                }),
                desktopAgent.listSessions({ projectId: project.projectId }),
            ]);
            store.applyHistory(project.sessionId, history.events);
            store.setSessions(sessions);
            report(project.status.hasCredential ? 'success' : 'warn', project.status.hasCredential
                ? 'Agent 已就绪。'
                : '请先在 AI 设置中保存 DeepSeek API Key。');
            return project;
        })().catch(error => {
            report('error', `Agent 启动失败：${error.message}`);
            return undefined;
        }).finally(() => { openPromise = null; });
        return openPromise;
    }

    async function send(rawText) {
        const text = String(rawText || '').trim();
        const state = store.getState();
        if (!text || !state.activeSessionId) return;
        const mode = state.running ? state.composer.mode : 'queue';
        const pendingId = store.addOptimistic(text, mode);
        try {
            await desktopAgent.prompt({
                projectId: state.project.projectId,
                sessionId: state.activeSessionId,
                text,
                mode,
            });
            store.acceptOptimistic(pendingId);
        } catch (error) {
            store.rejectOptimistic(pendingId, error.message || '发送失败');
        }
    }
    async function cancel() {
        const state = store.getState();
        if (!state.activeSessionId || !state.running) return;
        try {
            await desktopAgent.cancel({
                projectId: state.project.projectId,
                sessionId: state.activeSessionId,
            });
        } catch (error) {
            report('error', `停止失败：${error.message}`);
        }
    }
    async function createSession() {
        const state = store.getState();
        if (!state.project.projectId || state.running) return;
        try {
            const created = await desktopAgent.createSession({ projectId: state.project.projectId });
            store.setActiveSession(created.sessionId);
            store.setSessions(await desktopAgent.listSessions({ projectId: state.project.projectId }));
            closeSessionMenu();
        } catch (error) {
            report('error', `新建会话失败：${error.message}`);
        }
    }

    function refreshContext(delay = 250) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            const context = getContext();
            if (!enabled || !context.projectId || !store.getState().runtime.ready) return;
            store.setContextState('syncing');
            try {
                const result = await desktopAgent.refreshContext(context);
                store.setContextState('synced', {
                    chapterId: context.chapterId || '',
                    generatedAt: result.generatedAt || result.context?.generatedAt || '',
                });
            } catch (error) {
                store.setContextState('error');
                report('warn', `Agent 上下文刷新失败：${error.message}`);
            }
        }, delay);
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
                try {
                    await desktopAgent.activateSession({
                        projectId: state.project.projectId,
                        sessionId: session.sessionId,
                    });
                    store.setActiveSession(session.sessionId);
                    const history = await desktopAgent.getHistory({
                        projectId: state.project.projectId,
                        sessionId: session.sessionId,
                        maxMessages: 30,
                    });
                    store.applyHistory(session.sessionId, history.events);
                    closeSessionMenu();
                } catch (error) {
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
        root.querySelector('.agent-context-bar__sync').textContent = contextText(state.project.contextState);
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
