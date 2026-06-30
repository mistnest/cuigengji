/**
 * 催更姬 — Main Application
 * 前端应用入口 — 整合所有模块
 */
(function () {
    'use strict';
    const ApiClient = window.ApiClient;

    // ==================== State ====================
    const defaultAiConfig = {
        provider: 'anthropic',
        apiKey: '',
        endpoint: '',
        model: 'claude-sonnet-4-6',
        temperature: 0.7,
        maxTokens: 4096,
        maxTokensPct: 5,
        topP: 0.9,
        memoryBudget: 15,
        maxContext: 0,
        referenceMode: 'tool',
        compactReference: false,
        referenceTools: false,
        enableReferenceTools: false,
    };

    const state = {
        currentNovel: { id: 'default', title: '未命名小说' },
        currentChapter: null,
        chapters: [],
        outline: [],
        worldBook: { entries: {} },
        characters: [],
        promptTemplates: [],
        promptOrder: [],
        enabledTemplates: {},
        selectedPromptTemplates: {},
        specialPrompts: {},
        formatStrings: {},
        regexBindings: [],
        writingReference: {
            worldbookMode: 'all',
            selectedWorldbookGroups: [],
            characterMode: 'auto',
            selectedCharacters: [],
        },
        sessions: [],
        activeSessionId: null,
        activeSessionName: '',
        activeSessionAnchor: null,
        presets: {},
        presetName: '',
        aiConfig: { ...defaultAiConfig },
        appSettings: {
            theme: 'auto',
            editorFont: 'serif',
            editorFontSize: 17,
            editorLineHeight: 2,
            autoSaveDelay: 2000,
        },
        isDirty: false,
        isConnected: false,
        isGenerating: false,
        hasSavedApiKey: false,
        aiUsed: false,  // Track whether user has successfully used AI
        workspaceLoaded: false,
    };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);
    const LAST_SUCCESSFUL_AI_CONFIG_KEY = 'novel-ai-last-successful-config';
    let workspaceLoadController = null;
    let workspaceLoadVersion = 0;
    let autoConnectInFlight = false;
    const extractionJobs = new Map();
    const extractionJobNotices = new Set();
    let extractionJobPollTimer = null;

    // ==================== Initialization ====================
    function init() {
        persistAppSignature();
        initWelcomePage();
        initSettingsDialog();
        initContactAuthorDialog();
        bindPromptEditor();
        bindRegexEditor();
        bindGlobalTooltip();
        loadAppSettings();
        loadLastSuccessfulAiConfig();
        applyAppSettings();
        applyConfigToUI();
        void restoreAiConnection({ preferDeepseek: true, silent: true });
        bindEvents();
        initExtractionJobDock();
        void refreshExtractionJobs();
        renderWorldBookList();
        renderCharacterList();
        renderPromptTemplates();
        updatePresetSelect();
        updateStatusBar();
        console.log('📖 催更姬 v1.0 — Ready (状态已恢复)');
        setStatus('就绪 — 开始创作吧', 'info');
    }

    function persistAppSignature() {
        const build = window.__CUIGENGJI_BUILD__;
        if (!build?.schemaOwner) return;
        try {
            localStorage.setItem('cgj-mistnest-cuigengji-provenance', JSON.stringify({
                schemaOwner: build.schemaOwner,
                appId: build.appId,
                signature: build.buildSignature,
                version: build.version,
            }));
        } catch {}
    }

    function initWelcomePage() {
        // Wire welcome modal buttons
        const btnCreate = document.getElementById('btn-welcome-create');
        const btnImport = document.getElementById('btn-welcome-import');
        if (btnCreate) btnCreate.addEventListener('click', showWelcomeCreateModal);
        if (btnImport) btnImport.addEventListener('click', () => {
            const input = $('#file-input-document');
            if (!input) return;
            input.dataset.welcomeImport = 'true';
            input.value = '';
            input.click();
        });
        bindWelcomeModal();
        bindPresetSaveModal();
        loadRecentWorkspaces();
    }

    let _welcomeCloseTimer = 0;

    function showWelcomeCreateModal() {
        const overlay = document.getElementById('welcome-modal-overlay');
        const input = document.getElementById('welcome-modal-input');
        if (!overlay || !input) return;
        clearTimeout(_welcomeCloseTimer);
        const errorEl = document.getElementById('welcome-modal-error');
        if (errorEl) errorEl.classList.remove('show');
        overlay.style.display = '';
        input.value = '';
        requestAnimationFrame(() => overlay.classList.add('active'));
        input.focus();
    }

    function bindWelcomeModal() {
        const overlay = document.getElementById('welcome-modal-overlay');
        const input = document.getElementById('welcome-modal-input');
        const confirmBtn = document.getElementById('btn-welcome-modal-confirm');
        const cancelBtn = document.getElementById('btn-welcome-modal-cancel');
        if (!overlay) return;

        const close = () => {
            overlay.classList.remove('active');
            _welcomeCloseTimer = setTimeout(() => { overlay.style.display = 'none'; }, 200);
        };

        if (confirmBtn) confirmBtn.addEventListener('click', async () => {
            const title = (input?.value || '').trim();
            if (!title) { close(); return; }
            if (confirmBtn.disabled) return;
            confirmBtn.disabled = true;
            await doCreateWorkspace(title);
            confirmBtn.disabled = false;
        });

        if (cancelBtn) cancelBtn.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        input?.addEventListener('keydown', e => {
            if (e.key === 'Enter') confirmBtn?.click();
            if (e.key === 'Escape') cancelBtn?.click();
        });
    }

    async function doCreateWorkspace(title) {
        try {
            const response = await fetch('/api/novels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            // 成功后关弹窗再进入
            const overlay = document.getElementById('welcome-modal-overlay');
            if (overlay) { overlay.classList.remove('active'); overlay.style.display = 'none'; }
            await enterWorkspace(data.id, data.config?.title || title);
        } catch (err) {
            // 在输入框下方显示红色错误提示
            const errorEl = document.getElementById('welcome-modal-error');
            if (errorEl) {
                errorEl.textContent = err.message === 'Project already exists' ? '该工作区名称已存在' : `创建失败: ${err.message}`;
                errorEl.classList.add('show');
            }
            // 保持弹窗打开，让用户可以直接修改重试
            const input = document.getElementById('welcome-modal-input');
            if (input) { input.focus(); input.select(); }
        }
    }

    async function loadRecentWorkspaces() {
        const list = $('#welcome-novel-list');
        if (!list) return;

        try {
            const response = await fetch('/api/novels');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            let novels = Array.isArray(data.novels) ? data.novels : [];
            const accessed = JSON.parse(localStorage.getItem('novel-editor-accessed') || '{}');
            novels.sort((a, b) => {
                const aTime = accessed[a.id] || a.updated || a.created || 0;
                const bTime = accessed[b.id] || b.updated || b.created || 0;
                return bTime - aTime;
            });

            list.replaceChildren();
            if (!novels.length) {
                const empty = document.createElement('div');
                empty.className = 'welcome-empty';
                empty.textContent = '\u6682\u65e0\u5de5\u4f5c\u533a';
                list.appendChild(empty);
                return;
            }

            let batchMode = false;
            const renderCards = (expanded) => {
                list.replaceChildren();
                const visible = expanded ? novels : novels.slice(0, 10);
                for (const novel of visible) {
                const card = document.createElement('div');
                card.className = 'welcome-novel-card';
                card.dataset.novelId = novel.id;

                if (batchMode) {
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'welcome-batch-check';
                    cb.dataset.novelId = novel.id;
                    card.appendChild(cb);
                }

                const icon = document.createElement('span');
                icon.className = 'welcome-novel-icon';
                icon.textContent = '\u25cf';

                const info = document.createElement('span');
                info.className = 'welcome-novel-info';

                const title = document.createElement('span');
                title.className = 'welcome-novel-title';
                title.textContent = novel.title || novel.id;
                info.appendChild(title);

                const timestamp = accessed[novel.id] || novel.updated || novel.created;
                if (timestamp) {
                    const date = document.createElement('span');
                    date.className = 'welcome-novel-path';
                    date.textContent = formatRelativeTime(timestamp);
                    info.appendChild(date);
                }

                const delBtn = document.createElement('button');
                delBtn.className = 'welcome-delete-btn';
                delBtn.textContent = '\u00d7';
                delBtn.title = '\u5220\u9664\u9879\u76ee';
                delBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm(`\u5220\u9664\u201c${novel.title || novel.id}\u201d\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002`)) return;
                    try {
                        await deleteWorkspace(novel.id);
                        delete accessed[novel.id];
                        localStorage.setItem('novel-editor-accessed', JSON.stringify(accessed));
                        novels.splice(novels.indexOf(novel), 1);
                        renderCards(expanded);
                    } catch (error) {
                        setStatus(`删除项目失败: ${error.message}`, 'error');
                    }
                });

                card.append(icon, info, delBtn);
                card.addEventListener('click', (e) => {
                    if (batchMode) return;
                    if (e.target.closest('.welcome-delete-btn')) return;
                    enterWorkspace(novel.id, novel.title || novel.id);
                });
                // In batch mode, only the checkbox toggles selection
                const cb = card.querySelector('.welcome-batch-check');
                if (cb) cb.addEventListener('click', (e) => e.stopPropagation());
                list.appendChild(card);
                }

                // Batch actions bar
                const existingBar = list.querySelector('.welcome-batch-bar');
                if (existingBar) existingBar.remove();
                if (batchMode) {
                    const bar = document.createElement('div');
                    bar.className = 'welcome-batch-bar';
                    bar.innerHTML = '<button id="btn-welcome-batch-delete" class="ai-btn-secondary" style="color:var(--error);border-color:rgba(229,72,77,0.4);">\u5220\u9664\u9009\u4e2d</button>';
                    bar.querySelector('button').addEventListener('click', async () => {
                        const checked = list.querySelectorAll('.welcome-batch-check:checked');
                        if (!checked.length) { setStatus('\u8bf7\u5148\u52fe\u9009\u9879\u76ee', 'warn'); return; }
                        const ids = [...checked].map(cb => cb.dataset.novelId);
                        if (!confirm(`\u5220\u9664\u9009\u4e2d\u7684 ${ids.length} \u4e2a\u9879\u76ee\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002`)) return;
                        const deleted = [];
                        for (const id of ids) {
                            try {
                                await deleteWorkspace(id);
                                deleted.push(id);
                                delete accessed[id];
                            } catch (error) {
                                setStatus(`删除项目失败: ${error.message}`, 'error');
                                break;
                            }
                        }
                        localStorage.setItem('novel-editor-accessed', JSON.stringify(accessed));
                        novels = novels.filter(n => !deleted.includes(n.id));
                        renderCards(expanded);
                    });
                    list.appendChild(bar);
                }

                // Batch toggle button
                const existingToggle = list.querySelector('.welcome-batch-toggle');
                if (existingToggle) existingToggle.remove();
                if (novels.length > 0) {
                    const bt = document.createElement('button');
                    bt.className = 'welcome-batch-toggle';
                    bt.textContent = batchMode ? '\u5b8c\u6210' : '\u6279\u91cf';
                    bt.addEventListener('click', () => {
                        batchMode = !batchMode;
                        renderCards(expanded);
                    });
                    list.appendChild(bt);
                }

                if (novels.length > 10) {
                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.className = 'welcome-fold-toggle';
                    toggle.title = expanded ? '\u6536\u8d77\u9879\u76ee\u8bb0\u5f55' : '\u663e\u793a\u66f4\u591a\u9879\u76ee';
                    toggle.setAttribute('aria-label', toggle.title);
                    toggle.textContent = expanded ? '\u6536\u8d77' : '\u2026';
                    toggle.addEventListener('click', () => renderCards(!expanded));
                    list.appendChild(toggle);
                }
            }
            renderCards(false);
        } catch (err) {
            list.replaceChildren();
            const error = document.createElement('div');
            error.className = 'welcome-empty';
            error.textContent = `\u52a0\u8f7d\u5931\u8d25: ${err.message}`;
            list.appendChild(error);
        }
    }

    async function deleteWorkspace(id) {
        const response = await fetch(`/api/novels/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    }

    function createWorkspaceFromWelcome() {
        showWelcomeCreateModal();
    }

    async function enterWorkspace(id, title) {
        if (state.workspaceLoaded && state.currentNovel?.id !== id) {
            if (state.isDirty && !await onSave({ silent: true })) return;
            await Promise.allSettled([
                saveWorkspaceState({ silent: true }),
                saveActiveSession(),
            ]);
        }

        workspaceLoadController?.abort();
        workspaceLoadController = new AbortController();
        const loadSignal = workspaceLoadController.signal;
        const loadVersion = ++workspaceLoadVersion;

        try {
            const accessed = JSON.parse(localStorage.getItem('novel-editor-accessed') || '{}');
            accessed[id] = Date.now();
            localStorage.setItem('novel-editor-accessed', JSON.stringify(accessed));
        } catch {}

        resetWorkspaceState();
        state.currentNovel = { id, title };
        $('#current-novel-title').textContent = title;
        $('#welcome-page')?.classList.add('hidden');
        if ($('#app-main')) $('#app-main').style.display = '';

        try {
            const [chapterData, outlineData, diskWorkspace] = await Promise.all([
                ApiClient.get(`/api/chapters?novelId=${encodeURIComponent(id)}`, { signal: loadSignal }),
                ApiClient.get(`/api/outline?novelId=${encodeURIComponent(id)}`, { signal: loadSignal }),
                ApiClient.get(`/api/save/workspace/${encodeURIComponent(id)}`, { signal: loadSignal }),
            ]);
            if (loadVersion !== workspaceLoadVersion || state.currentNovel.id !== id) return;
            const localWorkspace = loadWorkspaceFallback(id) || {};
            const workspaceData = localWorkspace.pendingSync
                || Number(localWorkspace.savedAt || 0) > Number(diskWorkspace.savedAt || 0)
                ? localWorkspace
                : diskWorkspace;
            state.chapters = Array.isArray(chapterData.chapters) ? chapterData.chapters : [];
            state.outline = Array.isArray(outlineData.nodes) ? outlineData.nodes : [];
            applyWorkspaceState(workspaceData);
            state.workspaceLoaded = true;
            localStorage.setItem('novel-editor-last-workspace', id);
            syncWorkspaceInteractivity();

            state.currentChapter = null;
            const firstChapter = state.chapters.find(item => item.type !== 'volume');
            if (firstChapter) {
                const chapter = await ApiClient.get(
                    `/api/chapters/${encodeURIComponent(firstChapter.id)}?novelId=${encodeURIComponent(id)}`,
                    { signal: loadSignal },
                );
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
            void loadSessions(workspaceData.activeSessionId, { novelId: id, signal: loadSignal })
                .catch(sessionError => {
                    if (loadVersion !== workspaceLoadVersion || state.currentNovel.id !== id) return;
                    ChatPanel?.clearChat();
                    syncWorkspaceInteractivity();
                    setStatus(`会话加载失败: ${sessionError.message}`, 'error');
                });
        } catch (err) {
            if (err.name === 'AbortError') return;
            setStatus(`\u5de5\u4f5c\u533a\u52a0\u8f7d\u5931\u8d25: ${err.message}`, 'error');
        }
    }

    async function showWelcomePage() {
        if (state.workspaceLoaded) {
            if (state.isDirty && !await onSave({ silent: true })) return;
            await Promise.allSettled([
                saveWorkspaceState({ silent: true }),
                saveActiveSession(),
            ]);
        }
        $('#welcome-page')?.classList.remove('hidden');
        if ($('#app-main')) $('#app-main').style.display = 'none';
        loadRecentWorkspaces();
    }

    function ensureBuiltinPreset() {
        // 仅在没有任何预设和提示模板时注入内置预设（首次创建工作区）
        if (Object.keys(state.presets).length > 0 || state.promptTemplates.length > 0) return;
        if (!window.__CUIGENGJI_BUILTIN_PRESET__) return;

        const data = window.__CUIGENGJI_BUILTIN_PRESET__;
        state.importedPreset = data;

        // 映射 prompt 模板（与 importPreset 逻辑一致）
        const isConfigTemplate = (p) => {
            const n = (p.name || '').toLowerCase();
            const c = (p.content || '').toLowerCase();
            return n.includes('spreset') || n.includes('regex') || n.includes('macro')
                || c.includes('"chatsquash"') || c.includes('"regexbinding"')
                || c.includes('"toolbindings"') || c.includes('"macronest"')
                || c.includes('window.spresettempdata') || c.includes('window.sillytavern');
        };
        const isCgjImportMarker = p => /^cgj-import-(worldSetting|characterState|plotHistory|recentPlot)$/.test(String(p.identifier || ''));

        if (Array.isArray(data.prompts)) {
            state.promptTemplates = data.prompts
                .filter(p => (p.content?.trim() || p.marker || isCgjImportMarker(p)) && !isConfigTemplate(p))
                .map(p => ({
                    identifier: p.identifier || '',
                    name: p.name || p.identifier || '',
                    role: p.role || 'system',
                    content: p.content || '',
                    isSystemPrompt: !!p.isSystemPrompt,
                    isMarker: !!p.isMarker,
                    markerId: p.markerId || '',
                }));
        }

        if (Array.isArray(data.prompt_order)) {
            state.promptOrder = data.prompt_order
                .filter(o => state.promptTemplates.some(t => t.identifier === o.identifier))
                .map(o => ({ identifier: o.identifier, enabled: o.enabled !== false }));
        }

        state.presetName = data.name || '催更姬_v1.0';
        console.log('📦 已加载内置预设:', state.presetName);
    }

    function resetWorkspaceState() {
        state.currentChapter = null;
        state.chapters = [];
        state.outline = [];
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
        state.sessions = [];
        state.activeSessionId = null;
        state.activeSessionName = '';
        state.isDirty = false;
        state.workspaceLoaded = false;
        state.panelLayout = {};
        state.aiConfig = { ...defaultAiConfig };
        loadLastSuccessfulAiConfig();
        state.isConnected = false;
        state.hasSavedApiKey = false;
        state.aiUsed = false;
        updatePresetNameDisplay('');
        updatePresetSelect();
        applyConfigToUI();
        if (typeof ChatPanel !== 'undefined') {
            ChatPanel.cancelActiveRequest?.();
            ChatPanel.clearChat();
        }
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
            Object.assign(state.aiConfig, workspace.aiConfig, { apiKey: '' });
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

    async function onDocumentSelected(event) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file) return;

        try {
            let novelId = state.currentNovel?.id;
            let novelTitle = state.currentNovel?.title;

            if (input.dataset.welcomeImport === 'true') {
                const suggested = file.name.replace(/\.[^.]+$/, '');
                const title = prompt('\u8bf7\u8f93\u5165\u5de5\u4f5c\u533a\u540d\u79f0', suggested);
                if (!title?.trim()) return;

                const createResponse = await fetch('/api/novels', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: title.trim() }),
                });
                const created = await createResponse.json().catch(() => ({}));
                if (!createResponse.ok) throw new Error(created.error || `HTTP ${createResponse.status}`);
                novelId = created.id;
                novelTitle = created.config?.title || title.trim();
            }

            const form = new FormData();
            form.append('file', file);
            form.append('novelId', novelId);
            form.append('autoSplit', 'true');

            const response = await fetch('/api/import/document', { method: 'POST', body: form });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            await enterWorkspace(novelId, novelTitle);
        } catch (err) {
            alert(`\u5bfc\u5165\u5931\u8d25: ${err.message}`);
        } finally {
            delete input.dataset.welcomeImport;
            input.value = '';
        }
    }

    function downloadFile(content, filename, type = 'text/plain;charset=utf-8') {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function exportCurrentChapter() {
        const text = $('#chapter-editor')?.value || '';
        if (!text.trim()) return setStatus('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u6b63\u6587', 'warn');
        const title = $('#chapter-title-input')?.value || state.currentChapter?.title || '\u672a\u547d\u540d\u7ae0\u8282';
        downloadFile(text, `${title}.txt`);
        setStatus('\u7ae0\u8282\u5df2\u5bfc\u51fa', 'success');
    }

    function downloadJson(data, filename) {
        downloadFile(JSON.stringify(data, null, 2), filename, 'application/json;charset=utf-8');
    }

    function exportWorldBook() {
        const entries = Object.entries(state.worldBook?.entries || {});
        if (!entries.length) return setStatus('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u4e16\u754c\u4e66', 'warn');
        showExportSelectionDialog({
            title: '导出世界书',
            subtitle: '选择要导出的世界书条目。',
            items: entries.map(([uid, entry]) => ({
                id: uid,
                title: entry.comment || entry.key?.[0] || `条目 ${uid}`,
                meta: getWorldBookFolder(entry) || entry.group || '未分组',
                checked: true,
            })),
            onConfirm: selectedIds => {
                const selected = new Set(selectedIds);
                const data = buildSelectedWorldBookExport(selected);
                if (!Object.keys(data.entries || {}).length) return setStatus('请选择至少一个世界书条目', 'warn');
                downloadJson(data, `${state.currentNovel?.title || 'worldbook'}-worldbook.json`);
                setStatus(`已导出 ${Object.keys(data.entries).length} 条世界书`, 'success');
            },
        });
    }

    function exportCharacters() {
        if (!state.characters.length) return setStatus('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u89d2\u8272', 'warn');
        showExportSelectionDialog({
            title: '导出角色卡',
            subtitle: '选择要导出的角色。单个角色会导出标准角色卡 JSON，多个角色会导出催更姬角色合集。',
            items: state.characters.map((character, index) => ({
                id: String(index),
                title: character.data?.name || character.name || `角色 ${index + 1}`,
                meta: character.data?.group || character.group || character._source || '未分组',
                checked: true,
            })),
            onConfirm: selectedIds => {
                const selected = selectedIds
                    .map(id => Number(id))
                    .filter(index => Number.isInteger(index) && state.characters[index]);
                if (!selected.length) return setStatus('请选择至少一个角色', 'warn');
                const characters = selected.map(index => state.characters[index]);
                if (characters.length === 1) {
                    const name = characters[0].data?.name || characters[0].name || 'character';
                    downloadJson(characters[0], `${safeFilename(name)}.json`);
                } else {
                    downloadJson({
                        spec: 'cuigengji_character_bundle_v1',
                        exportedAt: Date.now(),
                        characters,
                    }, `${state.currentNovel?.title || 'characters'}-characters.json`);
                }
                setStatus(`已导出 ${characters.length} 个角色`, 'success');
            },
        });
    }

    function buildSelectedWorldBookExport(selectedIds) {
        const source = state.worldBook || {};
        const entries = {};
        const folders = new Set();
        for (const [uid, entry] of Object.entries(source.entries || {})) {
            if (!selectedIds.has(String(uid))) continue;
            entries[uid] = { ...entry };
            const folder = getWorldBookFolder(entry);
            if (folder) folders.add(folder);
        }
        return {
            ...source,
            entries,
            folders: [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN')),
            sources: source.sources || {},
        };
    }

    function showExportSelectionDialog({ title, subtitle, items, onConfirm }) {
        document.getElementById('export-selection-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'export-selection-overlay';
        overlay.className = 'plot-modal-overlay';
        overlay.innerHTML = `
            <div class="plot-modal export-selection-modal">
                <div class="plot-modal-header">
                    <div>
                        <h3>${escHtml(title)}</h3>
                        <p class="settings-subtitle">${escHtml(subtitle || '')}</p>
                    </div>
                    <button class="plot-modal-close" aria-label="关闭">×</button>
                </div>
                <div class="plot-modal-body" style="display:flex;flex-direction:column;gap:10px;">
                    <div style="display:flex;gap:8px;justify-content:center;">
                        <button type="button" class="export-select-all" style="width:auto;min-height:auto;padding:5px 16px;font-size:11px;border-radius:var(--radius);border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;">全选</button>
                        <button type="button" class="export-select-none" style="width:auto;min-height:auto;padding:5px 16px;font-size:11px;border-radius:var(--radius);border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;">全不选</button>
                    </div>
                    <div class="export-selection-list" style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto;">
                        ${items.map(item => `
                            <label class="extract-check-row" style="align-items:center;">
                                <input type="checkbox" class="export-selection-check" value="${escAttr(item.id)}" ${item.checked ? 'checked' : ''}>
                                <span><b>${escHtml(item.title)}</b>${item.meta ? `<em>${escHtml(item.meta)}</em>` : ''}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="plot-modal-footer">
                    <button type="button" class="ai-btn-secondary export-selection-cancel">取消</button>
                    <button type="button" class="ai-btn-primary export-selection-confirm">导出选中</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
        overlay.querySelector('.export-selection-cancel')?.addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.querySelector('.export-select-all')?.addEventListener('click', () => {
            overlay.querySelectorAll('.export-selection-check').forEach(input => { input.checked = true; });
        });
        overlay.querySelector('.export-select-none')?.addEventListener('click', () => {
            overlay.querySelectorAll('.export-selection-check').forEach(input => { input.checked = false; });
        });
        overlay.querySelector('.export-selection-confirm')?.addEventListener('click', () => {
            const selectedIds = [...overlay.querySelectorAll('.export-selection-check:checked')].map(input => input.value);
            onConfirm?.(selectedIds);
            close();
        });
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function safeFilename(value = 'export') {
        return String(value || 'export').replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
    }

    function exportPreset() {
        downloadJson({
            name: state.presetName || 'preset',
            ...state.aiConfig,
            prompts: state.promptTemplates || [],
            prompt_order: state.promptOrder || [],
        }, `${state.presetName || 'preset'}.json`);
    }

    function wrapEditorSelection(before, after) {
        const editor = $('#chapter-editor');
        if (!editor) return;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const selected = editor.value.slice(start, end);
        editor.setRangeText(`${before}${selected}${after}`, start, end, 'select');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.focus();
    }

    function formatChapterText() {
        const editor = $('#chapter-editor');
        if (!editor || editor.disabled) return;
        const original = editor.value || '';
        if (!original.trim()) {
            setStatus('正文为空，暂无可排版内容', 'warn');
            editor.focus();
            return;
        }

        const formatted = formatNovelText(original);
        if (formatted === original) {
            setStatus('正文格式已经很整齐了', 'info');
            editor.focus();
            return;
        }

        editor.value = formatted;
        editor.selectionStart = editor.selectionEnd = formatted.length;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.focus();
        setStatus('已完成正文排版', 'success');
    }

    function formatNovelText(text = '') {
        const normalized = String(text)
            .replace(/\r\n?/g, '\n')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+$/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        let inCodeBlock = false;
        const lines = normalized.split('\n').map(line => {
            const trimmed = line.trim();
            if (!trimmed) return '';
            if (/^```/.test(trimmed)) {
                inCodeBlock = !inCodeBlock;
                return trimmed;
            }
            if (inCodeBlock || shouldKeepLineUnindented(trimmed)) return trimmed;
            return '\u3000\u3000' + trimmed.replace(/^[\s\u3000]+/, '');
        });

        return lines.join('\n').replace(/\n{3,}/g, '\n\n');
    }

    function shouldKeepLineUnindented(line = '') {
        return /^#{1,6}\s/.test(line)
            || /^[-*+]\s/.test(line)
            || /^\d+[.)、]\s?/.test(line)
            || /^>/.test(line)
            || /^<\/?[a-zA-Z][^>]*>$/.test(line)
            || /^<[^>]+>/.test(line);
    }

    function renderNetworkProxySettings(slot) {
        const mode = state.aiConfig.networkProxyMode || 'auto';
        const url = state.aiConfig.networkProxyUrl || '';
        slot.innerHTML = `
            <div class="settings-group">
                <h5>代理模式</h5>
                <label class="settings-row">
                    <span><strong>自动检测</strong><span>使用系统环境变量或常见 VPN 代理地址。</span></span>
                    <input type="radio" name="network-proxy-mode" value="auto" ${mode === 'auto' ? 'checked' : ''}>
                </label>
                <label class="settings-row">
                    <span><strong>手动指定</strong><span>输入代理地址，例如 http://127.0.0.1:7890。</span></span>
                    <input type="radio" name="network-proxy-mode" value="manual" ${mode === 'manual' ? 'checked' : ''}>
                </label>
                <label class="settings-row">
                    <span><strong>不使用代理</strong><span>直连模型服务，适合无需代理的网络环境。</span></span>
                    <input type="radio" name="network-proxy-mode" value="off" ${mode === 'off' ? 'checked' : ''}>
                </label>
            </div>
            <div class="settings-group" id="proxy-manual-group" style="${mode === 'manual' ? '' : 'display:none;'}">
                <h5>代理地址</h5>
                <label class="settings-row" for="setting-proxy-url">
                    <span><strong>URL</strong><span>支持 http/https 代理。</span></span>
                    <input type="text" id="setting-proxy-url" class="ai-input" value="${escAttr(url)}" placeholder="http://127.0.0.1:7890" style="width:260px;">
                </label>
            </div>
            <div class="settings-group">
                <div class="settings-actions">
                    <button type="button" id="btn-detect-proxy" class="ai-btn-secondary">探测代理</button>
                    <button type="button" id="btn-test-proxy" class="ai-btn-secondary" ${mode === 'off' ? 'disabled' : ''}>测试连接</button>
                </div>
                <div id="proxy-status" class="ai-key-status" style="margin-top:8px;"></div>
            </div>`;

        // 模式切换
        slot.querySelectorAll('input[name="network-proxy-mode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                state.aiConfig.networkProxyMode = radio.value;
                const manualGroup = slot.querySelector('#proxy-manual-group');
                if (manualGroup) manualGroup.style.display = radio.value === 'manual' ? '' : 'none';
                const testBtn = slot.querySelector('#btn-test-proxy');
                if (testBtn) testBtn.disabled = radio.value === 'off';
                autoSave();
            });
        });

        // 手动 URL 变更
        const urlInput = slot.querySelector('#setting-proxy-url');
        urlInput?.addEventListener('input', () => {
            state.aiConfig.networkProxyUrl = urlInput.value.trim();
            autoSave();
        });

        // 探测代理
        slot.querySelector('#btn-detect-proxy')?.addEventListener('click', async () => {
            const status = slot.querySelector('#proxy-status');
            if (!status) return;
            status.textContent = '正在探测本机代理...';
            try {
                const resp = await fetch('/api/ai/detect-network-proxy', { method: 'POST' });
                const data = await resp.json().catch(() => ({}));
                if (data.success && data.proxyUrl) {
                    const radios = slot.querySelectorAll('input[name="network-proxy-mode"]');
                    radios.forEach(r => { if (r.value === 'auto') r.checked = true; });
                    state.aiConfig.networkProxyMode = 'auto';
                    state.aiConfig.networkProxyUrl = '';
                    const manualGroup = slot.querySelector('#proxy-manual-group');
                    if (manualGroup) manualGroup.style.display = 'none';
                    const testBtn = slot.querySelector('#btn-test-proxy');
                    if (testBtn) testBtn.disabled = false;
                    if (urlInput) urlInput.value = '';
                    autoSave();
                    status.textContent = `✅ 已检测到代理 ${data.proxyUrl}，已切换为自动模式。`;
                } else {
                    status.textContent = `⚠️ ${data.error || '未检测到可用代理'}`;
                }
            } catch (err) {
                status.textContent = `❌ 探测失败: ${err.message}`;
            }
        });

        // 测试连接
        slot.querySelector('#btn-test-proxy')?.addEventListener('click', async () => {
            const status = slot.querySelector('#proxy-status');
            if (!status) return;
            status.textContent = '正在测试代理连通性...';
            try {
                const resp = await fetch('/api/ai/test-connection', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...state.aiConfig, silent: true }),
                });
                const data = await resp.json().catch(() => ({}));
                if (resp.ok) {
                    status.textContent = `✅ 连接成功 (${data.model || 'OK'})`;
                } else {
                    status.textContent = `❌ 连接失败: ${data.error || `HTTP ${resp.status}`}`;
                }
            } catch (err) {
                status.textContent = `❌ 测试失败: ${err.message}`;
            }
        });
    }

    function initSettingsDialog() {
        const serviceSlot = $('#settings-ai-service-slot');
        const generationSlot = $('#settings-generation-slot');
        const proxySlot = $('#settings-network-proxy-slot');
        const connection = $('#ai-connection-section');
        const generation = $('#ai-generation-settings');

        if (serviceSlot && connection) serviceSlot.appendChild(connection);
        if (generationSlot && generation) generationSlot.appendChild(generation);
        if (proxySlot) renderNetworkProxySettings(proxySlot);

        const overlay = $('#settings-overlay');
        const close = () => closeSettings();
        $('#btn-settings-close')?.addEventListener('click', close);
        $('#btn-settings-done')?.addEventListener('click', close);
        overlay?.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && overlay?.classList.contains('active')) close();
        });
        $$('.settings-nav [data-settings-page]').forEach(button => {
            button.addEventListener('click', () => showSettingsPage(button.dataset.settingsPage));
        });
    }

    function showSettingsPage(pageName = 'general') {
        $$('.settings-nav [data-settings-page]').forEach(button => {
            button.classList.toggle('active', button.dataset.settingsPage === pageName);
        });
        $$('[data-settings-content]').forEach(page => {
            page.classList.toggle('active', page.dataset.settingsContent === pageName);
        });
    }

    function openAiSettings(pageName = 'general') {
        const overlay = $('#settings-overlay');
        if (!overlay) return;
        showSettingsPage(pageName);
        overlay.style.display = '';
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function closeSettings() {
        const overlay = $('#settings-overlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        setTimeout(() => {
            if (!overlay.classList.contains('active')) overlay.style.display = 'none';
        }, 180);
    }

    function initContactAuthorDialog() {
        const overlay = $('#contact-author-overlay');
        if (!overlay) return;
        const close = () => closeContactAuthor();
        $('#btn-contact-author')?.addEventListener('click', openContactAuthor);
        $('#btn-contact-author-close')?.addEventListener('click', close);
        $('#btn-contact-author-done')?.addEventListener('click', close);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && overlay.classList.contains('active')) close();
        });
    }

    function openContactAuthor() {
        const overlay = $('#contact-author-overlay');
        if (!overlay) return;
        overlay.style.display = '';
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function closeContactAuthor() {
        const overlay = $('#contact-author-overlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        setTimeout(() => {
            if (!overlay.classList.contains('active')) overlay.style.display = 'none';
        }, 180);
    }

    function loadAppSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem('novel-editor-app-settings') || '{}');
            Object.assign(state.appSettings, saved);
        } catch (e) { /* ignore invalid local settings */ }
    }

    function saveAppSettings() {
        localStorage.setItem('novel-editor-app-settings', JSON.stringify(state.appSettings));
    }

    function loadLastSuccessfulAiConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem(LAST_SUCCESSFUL_AI_CONFIG_KEY) || '{}');
            if (!saved || typeof saved !== 'object' || !saved.provider) return;
            Object.assign(state.aiConfig, {
                provider: saved.provider || state.aiConfig.provider,
                endpoint: saved.endpoint || '',
                model: saved.model || state.aiConfig.model,
                temperature: saved.temperature ?? state.aiConfig.temperature,
                maxTokens: saved.maxTokens || state.aiConfig.maxTokens,
                maxTokensPct: saved.maxTokensPct || state.aiConfig.maxTokensPct,
                topP: saved.topP ?? state.aiConfig.topP,
                topK: saved.topK ?? state.aiConfig.topK,
                memoryBudget: saved.memoryBudget ?? state.aiConfig.memoryBudget,
                maxContext: saved.maxContext ?? state.aiConfig.maxContext,
                apiKey: '',
            });
            if (saved.referenceMode !== undefined) state.aiConfig.referenceMode = saved.referenceMode;
            if (saved.compactReference !== undefined) state.aiConfig.compactReference = saved.compactReference;
            if (saved.referenceTools !== undefined) state.aiConfig.referenceTools = saved.referenceTools;
            if (saved.enableReferenceTools !== undefined) state.aiConfig.enableReferenceTools = saved.enableReferenceTools;
        } catch {}
    }

    function rememberLastSuccessfulAiConfig() {
        const c = state.aiConfig || {};
        if (!c.provider) return;
        const snapshot = {
            provider: c.provider,
            endpoint: c.endpoint || '',
            model: c.model || '',
            temperature: c.temperature,
            maxTokens: c.maxTokens,
            maxTokensPct: c.maxTokensPct,
            topP: c.topP,
            topK: c.topK,
            memoryBudget: c.memoryBudget,
            maxContext: c.maxContext,
            referenceMode: c.referenceMode,
            compactReference: c.compactReference,
            referenceTools: c.referenceTools,
            enableReferenceTools: c.enableReferenceTools,
            presetName: state.presetName || '__default__',
            connectedAt: Date.now(),
        };
        localStorage.setItem(LAST_SUCCESSFUL_AI_CONFIG_KEY, JSON.stringify(snapshot));
    }

    async function restoreAiConnection(options = {}) {
        loadLastSuccessfulAiConfig();
        applyConfigToUI();
        await loadAiSecretStatus(options.preferDeepseek === true);
        await autoConnectLastSuccessfulAi(options);
    }

    async function autoConnectLastSuccessfulAi(options = {}) {
        if (autoConnectInFlight) return;
        const silent = options.silent !== false;
        const provider = state.aiConfig.provider;
        if (!provider) return;
        if (provider !== 'ollama' && !state.hasSavedApiKey) return;

        autoConnectInFlight = true;
        if (!silent) setStatus('正在自动连接上次成功的模型...', 'loading');
        try {
            const response = await fetch('/api/ai/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    config: { ...state.aiConfig, apiKey: '' },
                    presetName: state.presetName || '__default__',
                }),
            });
            const data = await response.json().catch(() => ({}));
            state.isConnected = !!data.success;
            if (data.success) {
                state.hasSavedApiKey = true;
                localStorage.setItem('novel-ai-provider-chosen', provider);
                localStorage.setItem('novel-ai-connected-provider', provider);
                rememberLastSuccessfulAiConfig();
                if (!silent) setStatus('已自动连接上次成功的模型', 'success');
            } else {
                if (localStorage.getItem('novel-ai-connected-provider') === provider) {
                    localStorage.removeItem('novel-ai-connected-provider');
                }
                if (!silent) setStatus(`自动连接失败: ${data.error || '未知错误'}`, 'warn');
            }
        } catch (err) {
            state.isConnected = false;
            if (localStorage.getItem('novel-ai-connected-provider') === provider) {
                localStorage.removeItem('novel-ai-connected-provider');
            }
            if (!silent) setStatus(`自动连接失败: ${err.message}`, 'warn');
        } finally {
            autoConnectInFlight = false;
            updateStatusBar();
        }
    }

    function applyAppSettings() {
        const settings = state.appSettings;
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        const resolvedTheme = settings.theme === 'auto'
            ? (prefersDark ? 'dark' : 'light')
            : settings.theme;
        document.documentElement.dataset.theme = resolvedTheme;

        const fontMap = {
            serif: 'var(--font-serif)',
            sans: 'var(--font-sans)',
            mono: 'var(--font-mono)',
        };
        document.documentElement.style.setProperty(
            '--editor-font-family',
            fontMap[settings.editorFont] || fontMap.serif
        );
        document.documentElement.style.setProperty('--editor-font-size', `${settings.editorFontSize}px`);
        document.documentElement.style.setProperty('--editor-line-height', settings.editorLineHeight);

        if ($('#setting-theme')) $('#setting-theme').value = settings.theme;
        if ($('#setting-editor-font')) $('#setting-editor-font').value = settings.editorFont;
        if ($('#setting-editor-font-size')) $('#setting-editor-font-size').value = settings.editorFontSize;
        if ($('#setting-editor-line-height')) $('#setting-editor-line-height').value = settings.editorLineHeight;
        if ($('#setting-autosave-delay')) $('#setting-autosave-delay').value = settings.autoSaveDelay;
        if ($('#setting-editor-font-size-value')) {
            $('#setting-editor-font-size-value').textContent = `${settings.editorFontSize}px`;
        }
        if ($('#setting-editor-line-height-value')) {
            $('#setting-editor-line-height-value').textContent = Number(settings.editorLineHeight).toFixed(1);
        }
    }

    function updateAppSetting(key, value) {
        state.appSettings[key] = value;
        saveAppSettings();
        applyAppSettings();
    }

    function resetPanelLayout() {
        if (typeof ResizablePanels !== 'undefined') {
            ResizablePanels.clearPersistedSizes();
        }
        ['#left-sidebar', '#right-sidebar'].forEach(selector => {
            const panel = $(selector);
            if (!panel) return;
            panel.style.width = '';
            panel.style.minWidth = '';
        });
        setStatus('已重置侧栏宽度', 'success');
    }

    function clearRecentOrder() {
        localStorage.removeItem('novel-editor-accessed');
        setStatus('已清除最近工作区排序', 'success');
    }

    function togglePanelSearch(selector, buttonSelector, forceOpen) {
        const input = $(selector);
        if (!input) return;
        const search = input.closest('.panel-search');
        const button = $(buttonSelector);
        if (!search) return;
        const shouldOpen = forceOpen ?? search.hidden;
        search.hidden = !shouldOpen;
        button?.classList.toggle('active', shouldOpen);
        button?.setAttribute('aria-expanded', String(shouldOpen));
        if (shouldOpen) {
            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        } else {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function bindPanelSearch(selector, buttonSelector) {
        const input = $(selector);
        const search = input?.closest('.panel-search');
        if (!input || !search) return;
        $(buttonSelector)?.addEventListener('click', () => {
            togglePanelSearch(selector, buttonSelector);
        });
        search.querySelector('.panel-search-clear')?.addEventListener('click', () => {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        });
        search.querySelector('.panel-search-close')?.addEventListener('click', () => {
            togglePanelSearch(selector, buttonSelector, false);
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') togglePanelSearch(selector, buttonSelector, false);
        });
    }

    function filterRenderedList(listSelector, itemSelector, query) {
        const normalized = query.trim().toLowerCase();
        document.querySelectorAll(`${listSelector} ${itemSelector}`).forEach(item => {
            item.style.display = !normalized || item.textContent.toLowerCase().includes(normalized) ? '' : 'none';
        });
    }

    function addCharacter() {
        openCharacterEditor(null, -1);
    }

    function getCharacterBookEntries(data) {
        const charBook = data?.character_book || data?.data?.character_book || {};
        const rawEntries = charBook.entries || {};
        return (Array.isArray(rawEntries) ? rawEntries : Object.values(rawEntries)).filter(Boolean);
    }

    function renderEmbeddedWorldBookEntries(entries) {
        return entries.filter(e => !e.disable).map((e, i) => `
            <div class="embedded-book-entry">
                <strong>${escHtml(e.comment || e.key?.[0] || `条目${e.uid ?? i + 1}`)}</strong>
                <span>触发词：${escHtml((e.key || []).join(', ') || '无')}</span>
                <p>${escHtml((e.content || '').substring(0, 220))}</p>
            </div>
        `).join('');
    }

    function importEmbeddedWorldBookEntries(character, entries) {
        if (!entries?.length) return 0;
        if (!state.worldBook) state.worldBook = { entries: {} };
        if (!state.worldBook.entries) state.worldBook.entries = {};
        if (!state.worldBook.sources) state.worldBook.sources = {};
        const data = character?.data || character || {};
        const name = data.name || character?.name || '角色卡';
        const sourceLabel = character?._source || `内嵌: ${name}`;
        const numericIds = Object.keys(state.worldBook.entries).map(Number).filter(Number.isFinite);
        const nextUid = Math.max(0, ...numericIds) + 1;
        let added = 0;
        entries.forEach((entry, i) => {
            const uid = nextUid + i;
            state.worldBook.entries[uid] = {
                ...entry,
                uid,
                _source: sourceLabel,
                folder: entry.folder || entry._folder || sourceLabel,
                sourceGroup: entry.sourceGroup || entry.group || '',
            };
            added++;
        });
        state.worldBook.sources[sourceLabel] = {
            name: sourceLabel,
            entryCount: (state.worldBook.sources[sourceLabel]?.entryCount || 0) + added,
            importedAt: Date.now(),
        };
        renderWorldBookList();
        renderReferenceControls();
        autoSave();
        return added;
    }

    function openCharacterEditor(existingChar, charIndex) {
        const isEdit = existingChar !== null && existingChar !== undefined && charIndex >= 0;
        const data = isEdit ? (existingChar.data || existingChar) : {};
        const name = isEdit ? (data.name || existingChar.name || '') : '';
        const description = isEdit ? (data.description || '') : '';
        const personality = isEdit ? (data.personality || '') : '';
        const scenario = isEdit ? (data.scenario || '') : '';
        const firstMsg = isEdit ? (data.first_mes || '') : '';
        const tags = isEdit ? (data.tags || []).join(', ') : '';
        const group = isEdit ? (data.group || existingChar.group || '') : '';
        const embeddedBookEntries = isEdit ? getCharacterBookEntries(data) : [];
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'plot-modal char-detail-modal character-edit-modal';
        modal.innerHTML = `
            <div class="plot-modal-header">
                <div>
                    <h3>${isEdit ? '编辑角色' : '新建角色'}</h3>
                    <p class="settings-subtitle">${isEdit ? '修改角色设定，保存后生效。' : '先建立基础角色卡，之后可继续导入或补充详细设定。'}</p>
                </div>
                <button type="button" class="plot-modal-close" aria-label="关闭">×</button>
            </div>
            <div class="plot-modal-body char-detail-body">
                <div class="char-field">
                    <h4>角色名称 <span class="required-mark">*</span></h4>
                    <input type="text" class="wb-edit-input" id="character-edit-name" placeholder="例如：林冬" maxlength="80" value="${escAttr(name)}">
                    <div class="field-error" id="character-name-error"></div>
                </div>
                <div class="char-field">
                    <h4>角色简介</h4>
                    <textarea class="wb-edit-textarea character-edit-short" id="character-edit-description" placeholder="身份、外貌、经历或核心特征">${escHtml(description)}</textarea>
                </div>
                <div class="char-field">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                        <h4 style="margin:0;">摘要</h4>
                        <button type="button" class="ai-btn-secondary" id="char-summarize-btn">AI 提取</button>
                    </div>
                    <textarea class="wb-edit-textarea character-edit-short" id="character-edit-summary" placeholder="智能摘要模式下使用的简略描述。留空则该角色不会注入摘要。" style="width:100%;">${escHtml(isEdit ? (data.summary || '') : '')}</textarea>
                </div>
                <div class="character-edit-grid">
                    <div class="char-field">
                        <h4>性格</h4>
                        <textarea class="wb-edit-textarea character-edit-short" id="character-edit-personality" placeholder="性格特点、行为习惯">${escHtml(personality)}</textarea>
                    </div>
                    <div class="char-field">
                        <h4>背景场景</h4>
                        <textarea class="wb-edit-textarea character-edit-short" id="character-edit-scenario" placeholder="角色所处环境和当前处境">${escHtml(scenario)}</textarea>
                    </div>
                </div>
                <div class="char-field">
                    <h4>开场白</h4>
                    <textarea class="wb-edit-textarea character-edit-short" id="character-edit-first-message" placeholder="可选：角色第一次出场时的台词或动作">${escHtml(firstMsg)}</textarea>
                </div>
                <div class="char-field">
                    <h4>标签</h4>
                    <input type="text" class="wb-edit-input" id="character-edit-tags" placeholder="主角, 调查员, 雾港（逗号分隔）" value="${escAttr(tags)}">
                </div>
                <div class="char-field">
                    <h4>分组</h4>
                    <input type="text" class="wb-edit-input" id="character-edit-group" placeholder="角色分组（可选）" list="char-group-list" value="${escAttr(group)}">
                    <datalist id="char-group-list">
                        <option value="主角">
                        <option value="配角">
                        <option value="反派">
                        <option value="NPC">
                    </datalist>
                </div>
                ${embeddedBookEntries.length > 0 ? `
                <div class="char-field character-embedded-field">
                    <h4>内嵌世界书</h4>
                    <p class="st-config-hint">从 ST 角色卡携带而来，可保留在角色卡内，也可以提取为当前项目的世界书条目。</p>
                    <div class="char-embedded-book">
                        ${renderEmbeddedWorldBookEntries(embeddedBookEntries)}
                    </div>
                    <div class="character-embedded-actions">
                        <button type="button" class="ai-btn-secondary character-extract-embedded-btn">提取到项目世界书</button>
                    </div>
                </div>` : ''}
            </div>
            <div class="plot-modal-footer">
                ${isEdit ? '<button type="button" class="char-btn-delete character-edit-delete">删除角色</button>' : ''}
                <button type="button" class="plot-btn-cancel character-edit-cancel">取消</button>
                <button type="button" class="char-btn-extract-book character-edit-save">${isEdit ? '保存修改' : '创建角色'}</button>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const nameInput = overlay.querySelector('#character-edit-name');
        const error = overlay.querySelector('#character-name-error');
        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close').addEventListener('click', close);
        overlay.querySelector('.character-edit-cancel').addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

        // AI summarize button
        overlay.querySelector('#char-summarize-btn')?.addEventListener('click', async () => {
            const btn = overlay.querySelector('#char-summarize-btn');
            const parts = [
                overlay.querySelector('#character-edit-description')?.value?.trim(),
                overlay.querySelector('#character-edit-personality')?.value?.trim(),
                overlay.querySelector('#character-edit-scenario')?.value?.trim(),
            ].filter(Boolean);
            if (!parts.length) { alert('请先填写角色简介、性格或背景场景。'); return; }
            btn.disabled = true; btn.textContent = '生成中...';
            try {
                const summary = await generateSummary(parts.join('\n'), 'character');
                const summaryEl = overlay.querySelector('#character-edit-summary');
                if (summaryEl) summaryEl.value = summary;
            } catch (e) { alert('生成失败: ' + e.message); }
            finally { btn.disabled = false; btn.textContent = 'AI 提取'; }
        });

        overlay.querySelector('.character-extract-embedded-btn')?.addEventListener('click', () => {
            const added = importEmbeddedWorldBookEntries(existingChar, embeddedBookEntries);
            setStatus(`已从角色卡提取 ${added} 条世界书条目`, added > 0 ? 'success' : 'warn');
        });

        overlay.querySelector('.character-edit-save').addEventListener('click', () => {
            const newName = nameInput.value.trim();
            if (!newName) {
                error.textContent = '请输入角色名称';
                nameInput.focus();
                return;
            }
            const newTags = (overlay.querySelector('#character-edit-tags').value || '')
                .split(/[,，]/)
                .map(tag => tag.trim())
                .filter(Boolean);
            const newGroup = overlay.querySelector('#character-edit-group').value.trim();
            const newData = {
                spec: 'chara_card_v3',
                spec_version: '3.0',
                data: {
                    name: newName,
                    description: overlay.querySelector('#character-edit-description').value.trim(),
                    personality: overlay.querySelector('#character-edit-personality').value.trim(),
                    scenario: overlay.querySelector('#character-edit-scenario').value.trim(),
                    first_mes: overlay.querySelector('#character-edit-first-message').value.trim(),
                    mes_example: isEdit ? (data.mes_example || '') : '',
                    creator_notes: isEdit ? (data.creator_notes || '') : '',
                    system_prompt: isEdit ? (data.system_prompt || '') : '',
                    post_history_instructions: isEdit ? (data.post_history_instructions || '') : '',
                    tags: newTags,
                    character_book: isEdit ? (data.character_book || { entries: [] }) : { entries: [] },
                    group: newGroup,
                    summary: overlay.querySelector('#character-edit-summary')?.value?.trim()
                        || [
                            overlay.querySelector('#character-edit-description')?.value?.trim(),
                            overlay.querySelector('#character-edit-personality')?.value?.trim(),
                            overlay.querySelector('#character-edit-scenario')?.value?.trim(),
                        ].filter(Boolean).join('；').replace(/\s+/g, ' ').trim().substring(0, 150),
                },
            };
            if (isEdit) {
                // Preserve root-level fields that aren't part of data (e.g. _source, _group, folder)
                const preserved = {};
                for (const key of Object.keys(existingChar)) {
                    if (!['spec', 'spec_version', 'data', 'name', 'description', 'personality',
                         'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt',
                         'post_history_instructions', 'tags', 'character_book', 'group'].includes(key)) {
                        preserved[key] = existingChar[key];
                    }
                }
                state.characters[charIndex] = { ...newData, ...preserved };
                setStatus(`已保存角色: ${newName}`, 'success');
            } else {
                state.characters.push(newData);
                setStatus(`已创建角色: ${newName}`, 'success');
            }
            renderCharacterList();
            autoSave();
            close();
        });

        // Delete button (edit mode only)
        const deleteBtn = overlay.querySelector('.character-edit-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (!confirm(`确定要删除角色「${name || '(未命名)'}」吗？此操作不可撤销。`)) return;
                state.characters.splice(charIndex, 1);
                renderCharacterList();
                autoSave();
                close();
                setStatus(`已删除角色: ${name}`, 'success');
            });
        }

        requestAnimationFrame(() => {
            overlay.classList.add('active');
            nameInput.focus();
        });
    }

    // Format text for debug display: ensures newlines render as real line breaks
    function debugFormat(text, maxLen) {
        const s = String(text || '');
        const truncated = maxLen && s.length > maxLen ? s.substring(0, maxLen) + '\n\u2026[\u622a\u65ad]' : s;
        return truncated;
    }

    async function showLastPrompt() {
        try {
            const response = await fetch('/api/debug/last-prompt');
            const data = await response.json();
            const overlay = document.createElement('div');
            overlay.className = 'plot-modal-overlay active';
            const modal = document.createElement('div');
            modal.className = 'plot-modal';
            modal.style.cssText = 'max-width:860px;max-height:90vh;display:flex;flex-direction:column;';
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'plot-modal-close';
            close.textContent = '\u00d7';
            close.addEventListener('click', () => overlay.remove());
            const body = document.createElement('div');
            body.style.cssText = 'flex:1;overflow-y:auto;padding:20px;font-size:13px;line-height:1.7;';
            if (data.empty) {
                body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:60px 0;">\u8fd8\u6ca1\u6709\u53d1\u9001\u8fc7 AI \u8bf7\u6c42</p>';
            } else {
                const parts = [];
                // Header
                const sysLen = (data.systemPrompt || '').length;
                const usrLen = (data.userPrompt || '').length;
                parts.push('<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid var(--accent-primary);">');
                parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">Provider: <b>' + escHtml(data.provider || '-') + '</b></span>');
                parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">Model: <b>' + escHtml(data.model || '-') + '</b></span>');
                parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">Temp: <b>' + (data.temperature ?? '-') + '</b></span>');
                parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">MaxTokens: <b>' + (data.maxTokens ?? '-') + '</b></span>');
                parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;margin-left:auto;">Sys: <b>' + Math.round(sysLen / 2.5) + ' tok</b></span>');
                parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">User: <b>' + Math.round(usrLen / 2.5) + ' tok</b></span>');
                parts.push('</div>');

                // Section 1: System Prompt (what goes to AI first)
                parts.push('<div style="margin-bottom:18px;">');
                parts.push('<h4 style="margin:0 0 8px;padding:4px 8px;background:var(--accent-glow);color:var(--accent-primary);border-radius:4px;font-size:13px;display:inline-block;">\u25b6 1. System Prompt \u53d1\u7ed9AI</h4>');
                const sysText = debugFormat(data.systemPrompt, 15000);
                const sysPre = document.createElement('pre');
                sysPre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:14px;max-height:400px;overflow:auto;font-size:12px;color:var(--text-primary);font-family:var(--font-mono);line-height:1.6;';
                sysPre.textContent = sysText || '(\u65e0)';
                const sysWrapper = document.createElement('div');
                sysWrapper.appendChild(sysPre);
                parts.push(sysWrapper.outerHTML);
                parts.push('</div>');

                // Separator
                parts.push('<div style="text-align:center;margin:12px 0;color:var(--text-muted);font-size:11px;">\u2500\u2500 \u4ee5\u4e0a\u4e3a System Prompt \u00b7 \u4ee5\u4e0b\u4e3a User Message \u2500\u2500</div>');

                // Section 2: User Prompt
                parts.push('<div style="margin-bottom:18px;">');
                parts.push('<h4 style="margin:0 0 8px;padding:4px 8px;background:rgba(91,60,196,0.1);color:#8b7cf0;border-radius:4px;font-size:13px;display:inline-block;">\u25b6 2. User Message \u53d1\u7ed9AI</h4>');
                const usrText = debugFormat(data.userPrompt, 15000);
                const usrPre = document.createElement('pre');
                usrPre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:14px;max-height:400px;overflow:auto;font-size:12px;color:var(--text-primary);font-family:var(--font-mono);line-height:1.6;';
                usrPre.textContent = usrText || '(\u65e0)';
                const usrWrapper = document.createElement('div');
                usrWrapper.appendChild(usrPre);
                parts.push(usrWrapper.outerHTML);
                parts.push('</div>');

                // Section 3: Memory Stats (collapsible)
                if (data.memoryStats) {
                    parts.push('<details style="margin-top:4px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:12px;">Memory Stats</summary>');
                    parts.push('<pre style="white-space:pre-wrap;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:10px;font-size:11px;margin-top:6px;">' + escHtml(JSON.stringify(data.memoryStats, null, 2)) + '</pre>');
                    parts.push('</details>');
                }
                body.innerHTML = parts.join('\n');
            }
            modal.append(close, body);
            overlay.appendChild(modal);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
            document.body.appendChild(overlay);
        } catch (err) {
            setStatus('\u8c03\u8bd5\u4fe1\u606f\u52a0\u8f7d\u5931\u8d25: ' + err.message, 'error');
        }
    }

    async function onInfill() {
        const editor = $('#chapter-editor');
        if (!editor) return;
        if (!state.aiConfig.apiKey && !state.hasSavedApiKey && state.aiConfig.provider !== 'ollama') {
            setStatus('请先配置 API Key', 'error');
            return;
        }
        if (state.isGenerating) return;
        const instruction = prompt('\u8bf7\u63cf\u8ff0\u4e2d\u95f4\u9700\u8981\u8865\u5199\u7684\u5185\u5bb9');
        if (!instruction?.trim()) return;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const button = $('#btn-infill');
        state.isGenerating = true;
        if (button) button.disabled = true;
        try {
            setStatus('AI \u6b63\u5728\u8865\u5199...', 'loading');
            const response = await fetch('/api/chat/infill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    beforeText: editor.value.slice(0, start),
                    afterText: editor.value.slice(end),
                    instruction: instruction.trim(),
                    config: { ...state.aiConfig, stream: false },
                    context: {
                        novelId: state.currentNovel?.id,
                        novelTitle: state.currentNovel?.title,
                        chapterTitle: $('#chapter-title-input')?.value || '',
                        writingReference: state.writingReference,
                    },
                    presetName: state.presetName || '__default__',
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            editor.setRangeText(data.reply || '', start, end, 'end');
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            setStatus('\u8865\u5199\u5b8c\u6210', 'success');
        } catch (err) {
            setStatus(`\u8865\u5199\u5931\u8d25: ${err.message}`, 'error');
        } finally {
            state.isGenerating = false;
            if (button) button.disabled = false;
        }
    }

    async function fetchModels() {
        try {
            setStatus('\u6b63\u5728\u83b7\u53d6\u6a21\u578b\u5217\u8868...', 'loading');
            const response = await fetch('/api/ai/list-models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: state.aiConfig, presetName: state.presetName }),
            });
            const data = await response.json();
            const models = Array.isArray(data.models) ? data.models : [];
            state._modelCache = models;
            populateModelSelect(models);
            // Update maxContext for currently selected model
            const selModel = $('#ai-model')?.value;
            if (selModel) {
                const found = models.find(m => (typeof m === 'string' ? m : m.id || m.name) === selModel);
                if (found && typeof found === 'object') {
                    state.aiConfig.maxContext = Number(found.contextLimit || 0);
                }
            }
            setStatus(`\u83b7\u53d6\u5230 ${models.length} \u4e2a\u6a21\u578b`, 'success');
        } catch (err) {
            setStatus(`\u83b7\u53d6\u6a21\u578b\u5931\u8d25: ${err.message}`, 'error');
        }
    }

    function populateModelSelect(models) {
        const select = $('#ai-model');
        if (!select) return;
        select.replaceChildren();
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '\u2014 \u9009\u62e9\u6a21\u578b \u2014';
        select.appendChild(emptyOpt);
        models.forEach(model => {
            const id = typeof model === 'string' ? model : model.id || model.name;
            const limit = typeof model === 'object' ? Number(model.contextLimit || 0) : 0;
            if (!id) return;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = id;
            if (limit > 0) opt.dataset.contextLimit = limit;
            if (id === state.aiConfig.model) opt.selected = true;
            select.appendChild(opt);
        });
    }

    function onModelSelectChange() {
        const select = $('#ai-model');
        if (!select) return;
        const selModel = select.value;
        state.aiConfig.model = selModel;
        const found = (state._modelCache || []).find(m =>
            (typeof m === 'string' ? m : m.id || m.name) === selModel
        );
        if (found && typeof found === 'object') {
            state.aiConfig.maxContext = Number(found.contextLimit || 0);
        }
        updateModelContextInfo(selModel);
        onConfigChange();
    }

    function updateModelContextInfo(selModel) {
        const infoEl = document.getElementById('model-context-info');
        if (!infoEl) return;
        if (!selModel) { infoEl.style.display = 'none'; return; }
        const opt = document.querySelector('#ai-model option:checked');
        const limit = parseInt(opt?.dataset?.contextLimit || 0);
        if (!limit) { infoEl.style.display = 'none'; return; }
        const ctxText = limit >= 1000000
            ? (limit / 1000000).toFixed(1) + 'M'
            : Math.round(limit / 1000) + 'K';
        infoEl.innerHTML = '<span>上下文窗口</span><span class="ctx-tag">' + ctxText + ' tokens</span>';
        infoEl.style.display = 'flex';
    }

    function addPromptTemplate() {
        openPromptEditor();
        addPromptInEditor();
    }

    // eslint-disable-next-line no-unused-vars
    function deleteSelectedPromptTemplates() {
        const ids = new Set(Object.entries(state.selectedPromptTemplates || {})
            .filter(([, selected]) => selected)
            .map(([id]) => id));
        if (!ids.size) return setStatus('请先勾选需要删除的模板', 'warn');
        if (!confirm(`删除选中的 ${ids.size} 个模板？`)) return;
        state.promptTemplates = state.promptTemplates.filter(template => !ids.has(template.identifier));
        ids.forEach(id => {
            delete state.enabledTemplates[id];
            delete state.selectedPromptTemplates[id];
        });
        renderPromptTemplates();
        autoSave();
    }

    // ==================== Global Tooltip ====================
    function bindGlobalTooltip() {
        document.addEventListener('mouseenter', (e) => {
            const el = e.target instanceof Element ? e.target : null;
            const icon = el?.closest('.info-tooltip-icon');
            if (!icon) return;
            const textEl = icon.parentElement?.querySelector('.info-tooltip-text');
            if (!textEl) return;
            const tip = document.getElementById('global-tooltip');
            if (!tip) return;
            tip.innerHTML = textEl.innerHTML;
            tip.style.display = '';
            const rect = icon.getBoundingClientRect();
            let left = rect.left + rect.width / 2 - 170;
            if (left < 8) left = 8;
            if (left + 340 > window.innerWidth - 8) left = window.innerWidth - 348;
            tip.style.left = left + 'px';
            tip.style.top = (rect.bottom + 8) + 'px';
            requestAnimationFrame(() => tip.classList.add('show'));
        }, true);
        document.addEventListener('mouseleave', (e) => {
            const el = e.target instanceof Element ? e.target : null;
            if (!el?.closest('.info-tooltip-icon')) return;
            const tip = document.getElementById('global-tooltip');
            if (tip) { tip.classList.remove('show'); tip.style.display = 'none'; }
        }, true);
    }

    // ==================== Prompt Editor ====================
    let _promptEditorCurrentId = null;

    function bindPromptEditor() {
        const overlay = document.getElementById('prompt-editor-overlay');
        if (!overlay) return;

        const close = () => closePromptEditor();
        document.getElementById('btn-prompt-editor-close')?.addEventListener('click', close);
        document.getElementById('btn-prompt-editor-done')?.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && overlay.classList.contains('active')) close();
        });

        document.getElementById('btn-prompt-editor-add')?.addEventListener('click', addPromptInEditor);
        document.getElementById('btn-prompt-editor-save')?.addEventListener('click', savePromptFromForm);
        document.getElementById('btn-prompt-editor-delete')?.addEventListener('click', deletePromptFromEditor);

        // Resizer between nav and content
        const resizer = document.getElementById('prompt-editor-resizer');
        const navEl = document.getElementById('prompt-editor-nav');
        if (resizer && navEl) {
            let startX, startW;
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                startX = e.clientX;
                startW = navEl.offsetWidth;
                resizer.classList.add('active');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });
            document.addEventListener('mousemove', (e) => {
                if (!resizer.classList.contains('active')) return;
                const delta = e.clientX - startX;
                const newW = Math.max(140, Math.min(400, startW + delta));
                navEl.style.width = newW + 'px';
            });
            document.addEventListener('mouseup', () => {
                if (resizer.classList.contains('active')) {
                    resizer.classList.remove('active');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                }
            });
        }

        // Batch mode
        const nav = document.getElementById('prompt-editor-nav');
        const batchToggle = document.getElementById('btn-prompt-batch-toggle');
        const batchActions = document.getElementById('prompt-editor-batch-actions');
        const navTools = document.getElementById('prompt-editor-nav-tools');
        if (navTools) navTools.style.display = '';
        const selectAllBtn = document.getElementById('btn-prompt-select-all');
        const invertBtn = document.getElementById('btn-prompt-invert');
        if (batchToggle) batchToggle.addEventListener('click', () => {
            const active = !nav.classList.contains('prompt-editor-nav-batch');
            nav.classList.toggle('prompt-editor-nav-batch', active);
            batchToggle.textContent = active ? '完成' : '批量';
            if (batchActions) batchActions.style.display = active ? '' : 'none';
            if (selectAllBtn) selectAllBtn.style.display = active ? '' : 'none';
            if (invertBtn) invertBtn.style.display = active ? '' : 'none';
            renderPromptNav();
        });
        if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
            nav.querySelectorAll('.pe-nav-check').forEach(cb => { cb.checked = true; });
        });
        if (invertBtn) invertBtn.addEventListener('click', () => {
            nav.querySelectorAll('.pe-nav-check').forEach(cb => { cb.checked = !cb.checked; });
        });
        if (batchActions) batchActions.addEventListener('click', (e) => {
            const action = e.target.closest('button')?.dataset.action;
            if (!action) return;
            const checked = nav.querySelectorAll('.pe-nav-check:checked');
            if (!checked.length) { setStatus('请先勾选模板', 'warn'); return; }
            const ids = [...checked].map(cb => cb.dataset.id);
            if (action === 'delete') {
                if (!confirm(`删除选中的 ${ids.length} 个模板？`)) return;
                state.promptTemplates = state.promptTemplates.filter(t => !ids.includes(t.identifier));
                ids.forEach(id => { delete state.enabledTemplates[id]; delete state.selectedPromptTemplates[id]; });
            } else if (action === 'enable') {
                ids.forEach(id => { state.enabledTemplates[id] = true; });
            } else if (action === 'disable') {
                ids.forEach(id => { state.enabledTemplates[id] = false; });
            }
            renderPromptNav();
            renderPromptTemplates();
            autoSave();
            setStatus(`已${action === 'delete' ? '删除' : action === 'enable' ? '启用' : '停用'} ${ids.length} 个模板`, 'success');
        });
    }

    function openPromptEditor(preselectedId) {
        const overlay = document.getElementById('prompt-editor-overlay');
        if (!overlay) return;
        _promptEditorCurrentId = null;
        overlay.style.display = '';
        renderPromptNav();
        if (preselectedId) {
            selectPromptForEdit(preselectedId);
        } else {
            const emptyState = overlay.querySelector('#prompt-editor-empty');
            const formArea = overlay.querySelector('#prompt-editor-form');
            if (emptyState) emptyState.style.display = '';
            if (formArea) formArea.style.display = 'none';
        }
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function normalizeWorldBookEditorLayout(overlay) {
        const st = overlay.querySelector('.wb-st-config');
        if (!st || st.dataset.normalized === 'true') return;
        st.dataset.normalized = 'true';
        let body = st.querySelector('.st-config-body');
        if (!body) {
            body = document.createElement('div');
            body.className = 'st-config-body';
            while (st.children.length > 1) body.appendChild(st.children[1]);
            st.appendChild(body);
        }

        const moveBefore = body.firstElementChild || null;
        [
            '#wb-edit-key',
            '#wb-edit-keysecondary',
            '#wb-edit-order',
            '#wb-edit-position',
        ].forEach(selector => {
            const node = overlay.querySelector(selector)?.closest('.char-field, .wb-edit-row');
            if (node && node.parentElement !== body) body.insertBefore(node, moveBefore);
        });

        const checks = overlay.querySelector('.wb-edit-checks');
        if (checks) {
            const disableLabel = overlay.querySelector('#wb-edit-disable')?.closest('label');
            if (disableLabel) {
                const nativeChecks = document.createElement('div');
                nativeChecks.className = 'wb-edit-checks wb-native-checks';
                nativeChecks.appendChild(disableLabel);
                st.before(nativeChecks);
            }
            if (checks.children.length) body.appendChild(checks);
            else checks.remove();
        }
    }

    function normalizeCharacterEditorLayout(_overlay) {
        // 角色卡所有字段按原始顺序排列，不再收进 ST 折叠区
    }

    function closePromptEditor() {
        const overlay = document.getElementById('prompt-editor-overlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        setTimeout(() => {
            if (!overlay.classList.contains('active')) overlay.style.display = 'none';
        }, 200);
        _promptEditorCurrentId = null;
        renderPromptTemplates();
    }

    function renderPromptNav() {
        const list = document.getElementById('prompt-editor-nav-list');
        if (!list) return;
        const nav = list.closest('#prompt-editor-nav');
        const templates = state.promptTemplates || [];
        const batchMode = nav?.classList.contains('prompt-editor-nav-batch');
        if (!templates.length) {
            list.innerHTML = '<div class="pe-nav-empty">暂无模板，点击 "+" 添加</div>';
            return;
        }
        list.innerHTML = templates.map(t => {
            const enabled = state.enabledTemplates[t.identifier] !== false;
            const disabledClass = enabled ? '' : ' pe-nav-disabled';
            let html = '<div class="pe-nav-item' + disabledClass + '" data-id="' + escHtml(t.identifier) + '">';
            // Batch checkbox (visible only in batch mode)
            html += '<input type="checkbox" class="pe-nav-check" style="display:' + (batchMode ? 'inline-block' : 'none') + '" data-id="' + escHtml(t.identifier) + '" aria-label="选择模板">';
            // Enable/disable indicator dot (clickable, visually distinct from batch checkbox)
            html += '<span class="pe-nav-dot' + (enabled ? ' pe-nav-dot-on' : '') + '" title="' + (enabled ? '已启用，点击禁用' : '已禁用，点击启用') + '">' + (enabled ? '●' : '○') + '</span>';
            html += '<span class="pe-nav-title">' + escHtml(t.name) + '</span>';
            html += '</div>';
            return html;
        }).join('');
        nav.querySelectorAll('.pe-nav-item').forEach(item => {
            // Dot click → toggle enable/disable
            const dot = item.querySelector('.pe-nav-dot');
            if (dot) dot.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = item.dataset.id;
                const cur = state.enabledTemplates[id] !== false;
                state.enabledTemplates[id] = !cur;
                dot.classList.toggle('pe-nav-dot-on', !cur);
                dot.textContent = !cur ? '●' : '○';
                dot.title = !cur ? '已启用，点击禁用' : '已禁用，点击启用';
                item.classList.toggle('pe-nav-disabled', cur);
                renderPromptTemplates();
                autoSave();
            });
            // Item click → select for edit (also toggles checkbox in batch mode)
            item.addEventListener('click', (e) => {
                if (e.target.closest('.pe-nav-check') || e.target.closest('.pe-nav-dot')) return;
                if (batchMode) {
                    const cb = item.querySelector('.pe-nav-check');
                    if (cb) cb.checked = !cb.checked;
                }
                selectPromptForEdit(item.dataset.id);
            });
        });
        if (_promptEditorCurrentId) {
            const current = nav.querySelector('.pe-nav-item.active');
            if (current) current.classList.remove('active');
            const target = nav.querySelector('.pe-nav-item[data-id="' + escHtml(_promptEditorCurrentId) + '"]');
            if (target) target.classList.add('active');
        }
    }

    function selectPromptForEdit(id) {
        const tmpl = state.promptTemplates.find(t => t.identifier === id);
        if (!tmpl) return;
        _promptEditorCurrentId = id;
        const overlay = document.getElementById('prompt-editor-overlay');
        if (!overlay) return;
        const emptyState = overlay.querySelector('#prompt-editor-empty');
        const formArea = overlay.querySelector('#prompt-editor-form');
        if (emptyState) emptyState.style.display = 'none';
        if (formArea) formArea.style.display = '';
        loadPromptToForm(tmpl);
        renderPromptNav();
    }

    function loadPromptToForm(tmpl) {
        const nameInput = document.getElementById('prompt-editor-name');
        const roleSelect = document.getElementById('prompt-editor-role');
        const contentTextarea = document.getElementById('prompt-editor-content');
        const isSystem = document.getElementById('prompt-editor-is-system');
        const isMarker = document.getElementById('prompt-editor-is-marker');
        if (nameInput) nameInput.value = tmpl.name || '';
        if (roleSelect) roleSelect.value = tmpl.role || 'user';
        if (contentTextarea) contentTextarea.value = tmpl.content || '';
        if (isSystem) isSystem.checked = !!tmpl.isSystemPrompt;
        if (isMarker) isMarker.checked = !!tmpl.isMarker;
        document.getElementById('prompt-editor-note').textContent = '标识符: ' + (tmpl.identifier || '');
    }

    function savePromptFromForm() {
        if (!_promptEditorCurrentId) return;
        const idx = state.promptTemplates.findIndex(t => t.identifier === _promptEditorCurrentId);
        if (idx === -1) return;
        const nameInput = document.getElementById('prompt-editor-name');
        const roleSelect = document.getElementById('prompt-editor-role');
        const contentTextarea = document.getElementById('prompt-editor-content');
        const isSystem = document.getElementById('prompt-editor-is-system');
        const isMarker = document.getElementById('prompt-editor-is-marker');
        if (!nameInput) return;
        const name = nameInput.value.trim();
        if (!name) { setStatus('请输入模板名称', 'warn'); nameInput.focus(); return; }
        state.promptTemplates[idx].name = name;
        state.promptTemplates[idx].role = roleSelect?.value || 'user';
        state.promptTemplates[idx].content = contentTextarea?.value || '';
        state.promptTemplates[idx].isSystemPrompt = isSystem?.checked || false;
        state.promptTemplates[idx].isMarker = isMarker?.checked || false;
        if (!state.enabledTemplates[_promptEditorCurrentId]) {
            state.enabledTemplates[_promptEditorCurrentId] = true;
        }
        renderPromptNav();
        renderPromptTemplates();
        autoSave();
        showToast('已保存: ' + name, 'success');
    }

    function deletePromptFromEditor() {
        if (!_promptEditorCurrentId) return;
        const idx = state.promptTemplates.findIndex(t => t.identifier === _promptEditorCurrentId);
        if (idx === -1) return;
        const tmpl = state.promptTemplates[idx];
        if (!confirm('确认删除模板 "' + tmpl.name + '"？')) return;
        state.promptTemplates.splice(idx, 1);
        delete state.enabledTemplates[_promptEditorCurrentId];
        _promptEditorCurrentId = null;
        renderPromptNav();
        renderPromptTemplates();
        autoSave();
        setStatus('已删除模板', 'success');
    }

    function addPromptInEditor() {
        const identifier = 'custom_' + Date.now();
        state.promptTemplates.push({
            identifier,
            name: '新模板',
            role: 'user',
            content: '',
        });
        state.enabledTemplates[identifier] = true;
        renderPromptNav();
        selectPromptForEdit(identifier);
        setTimeout(() => document.getElementById('prompt-editor-name')?.focus(), 100);
    }

    // eslint-disable-next-line no-unused-vars
    function collectWorldBookGroups() {
        const groups = new Set();
        if (state.worldBook?.entries) {
            Object.values(state.worldBook.entries).forEach(entry => {
                const folder = getWorldBookFolder(entry);
                if (folder) groups.add(folder);
            });
        }
        return [...groups].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }

    // eslint-disable-next-line no-unused-vars
    function collectCharacterGroups() {
        const groups = new Set();
        state.characters.forEach(ch => {
            const tags = ch.data?.tags || [];
            const group = ch.data?.group || '';
            if (group) groups.add(group);
            tags.forEach(tag => { if (tag.trim()) groups.add(tag.trim()); });
        });
        return [...groups].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }

    function filterPromptTemplates() {
        const query = ($('#prompt-template-search')?.value || '').trim().toLowerCase();
        document.querySelectorAll('#prompt-templates-list .prompt-template-toggle-item').forEach(item => {
            const searchText = item.dataset.searchText || item.textContent.toLowerCase();
            item.style.display = !query || searchText.includes(query) ? '' : 'none';
        });
    }

    async function importFolder(files) {
        if (!files?.length) return;
        const form = new FormData();
        Array.from(files).forEach(file => form.append('files', file, file.webkitRelativePath || file.name));
        form.append('novelId', state.currentNovel?.id || 'default');
        try {
            const response = await fetch('/api/import/folder', { method: 'POST', body: form });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            await enterWorkspace(state.currentNovel.id, state.currentNovel.title);
        } catch (err) {
            setStatus(`\u6587\u4ef6\u5939\u5bfc\u5165\u5931\u8d25: ${err.message}`, 'error');
        }
    }

    function saveConfig() {
        if (!state.workspaceLoaded) return;
        saveStateToLocal();
        autoSave();
    }

    function applyConfigToUI() {
        const c = state.aiConfig;
        $('#ai-provider').value = c.provider;
        resetApiKeyField();
        $('#ai-endpoint').value = c.endpoint;
        $('#ai-model').value = c.model;
        updateModelContextInfo(c.model);
        $('#ai-temperature').value = c.temperature;
        // Show percentage slider; compute from stored pct, or derive from absolute tokens
        let pct = c.maxTokensPct || 0;
        if (!pct && c.maxTokens > 0) {
            const ctx = getModelContextLimit();
            pct = Math.round(c.maxTokens / ctx * 100) || 5;
        }
        if (!pct) pct = 5;
        $('#ai-max-tokens').value = pct;
        $('#ai-top-p').value = c.topP;
        updateReferenceInjectionModeUI();
        updateRangeLabels();
        // 恢复提供商标识字段
        if (c.vertexAuthMode && $('#ai-vertex-auth-mode')) $('#ai-vertex-auth-mode').value = c.vertexAuthMode;
        if (c.vertexRegion && $('#ai-vertex-region')) $('#ai-vertex-region').value = c.vertexRegion;
        if (c.vertexProjectId && $('#ai-vertex-project-id')) $('#ai-vertex-project-id').value = c.vertexProjectId;
        if (c.vertexServiceAccountJson && $('#ai-vertex-service-account-json')) $('#ai-vertex-service-account-json').value = c.vertexServiceAccountJson;
        if (c.siliconflowEndpoint && $('#ai-siliconflow-endpoint')) $('#ai-siliconflow-endpoint').value = c.siliconflowEndpoint;
        if (c.minimaxEndpoint && $('#ai-minimax-endpoint')) $('#ai-minimax-endpoint').value = c.minimaxEndpoint;
        if (c.zaiEndpoint && $('#ai-zai-endpoint')) $('#ai-zai-endpoint').value = c.zaiEndpoint;
        updateProviderUI();
    }

    // ==================== Event Bindings ====================
    function bindEvents() {
        // Toolbar
        $('#btn-new-novel')?.addEventListener('click', onNewNovel);
        $('#btn-home')?.addEventListener('click', showWelcomePage);
        $('#btn-save').addEventListener('click', onSave);
        $('#btn-export')?.addEventListener('click', exportCurrentChapter);
        $('#btn-import').addEventListener('click', toggleImportMenu);
        $('#btn-settings').addEventListener('click', () => openAiSettings());
        $('#btn-manage-ai-settings')?.addEventListener('click', () => openAiSettings('ai-service'));
        $('#setting-theme')?.addEventListener('change', event => updateAppSetting('theme', event.target.value));
        $('#setting-editor-font')?.addEventListener('change', event => updateAppSetting('editorFont', event.target.value));
        $('#setting-editor-font-size')?.addEventListener('input', event => {
            updateAppSetting('editorFontSize', Number(event.target.value));
        });
        $('#setting-editor-line-height')?.addEventListener('input', event => {
            updateAppSetting('editorLineHeight', Number(event.target.value));
        });
        $('#setting-autosave-delay')?.addEventListener('change', event => {
            updateAppSetting('autoSaveDelay', Number(event.target.value));
        });
        $('#btn-reset-panel-layout')?.addEventListener('click', resetPanelLayout);
        $('#btn-clear-recent-order')?.addEventListener('click', clearRecentOrder);
        $('#btn-editor-bold')?.addEventListener('click', () => wrapEditorSelection('**', '**'));
        $('#btn-editor-italic')?.addEventListener('click', () => wrapEditorSelection('*', '*'));
        $('#btn-editor-format')?.addEventListener('click', formatChapterText);

        // AI buttons
        $('#btn-extract-setting')?.addEventListener('click', onExtractSetting);
        $('#btn-continue')?.addEventListener('click', onContinue);
        $('#btn-plot-suggestions')?.addEventListener('click', onPlotSuggestions);
        $('#btn-inspire')?.addEventListener('click', onInspire);
        // Summary
        $('#btn-save-summary')?.addEventListener('click', () => saveChapterSummaryEdit());
        $('#btn-ai-summary')?.addEventListener('click', onAiExtractSummary);
        $('#btn-summary-toggle')?.addEventListener('click', () => {
            const a = $('#chapter-summary-area'); if (!a) return;
            const wasCollapsed = a.classList.contains('collapsed');
            a.classList.toggle('collapsed');
            const b = $('#btn-summary-toggle');
            if (b) {
                b.textContent = wasCollapsed ? '−' : '+';
                b.title = wasCollapsed ? '折叠摘要' : '展开摘要';
            }
        });
        initSummaryDrag();
        $('#btn-infill')?.addEventListener('click', onInfill);
        $('#btn-debug-chat')?.addEventListener('click', showLastPrompt);
        const btnConnect = $('#btn-connect-model');
        if (btnConnect) btnConnect.addEventListener('click', onTestConnection);
        $('#btn-import-preset').addEventListener('click', () => $('#file-input-preset').click());
        $('#btn-save-preset').addEventListener('click', () => saveCurrentAsPreset());
        $('#btn-export-preset')?.addEventListener('click', exportPreset);
        $('#btn-fetch-models')?.addEventListener('click', fetchModels);
        $('#btn-add-prompt-template')?.addEventListener('click', addPromptTemplate);
        $('#btn-edit-prompt-templates')?.addEventListener('click', () => openPromptEditor());
        $('#btn-import-preset-inline')?.addEventListener('click', () => $('#file-input-preset').click());
        $('#prompt-template-search')?.addEventListener('input', filterPromptTemplates);

        // Load preset button — apply selected preset
        const btnLoadPreset = $('#btn-load-preset');
        if (btnLoadPreset) btnLoadPreset.addEventListener('click', () => {
            const name = $('#ai-preset').value;
            if (!name) { setStatus('请先选择一个配置方案', 'warn'); return; }
            const preset = state.presets[name];
            if (!preset) { setStatus('配置方案未找到', 'error'); return; }

            if (preset.provider) state.aiConfig.provider = preset.provider;
            if (preset.model) state.aiConfig.model = preset.model;
            if (preset.temperature !== undefined) state.aiConfig.temperature = preset.temperature;
            if (preset.maxTokens) state.aiConfig.maxTokens = preset.maxTokens;
            if (preset.maxTokensPct) {
                state.aiConfig.maxTokensPct = preset.maxTokensPct;
            } else if (preset.maxTokens) {
                // Backwards compat: old preset has absolute maxTokens, compute pct from context
                const ctx = getModelContextLimit();
                state.aiConfig.maxTokensPct = Math.round(preset.maxTokens / ctx * 100) || 5;
            }
            if (preset.topP !== undefined) state.aiConfig.topP = preset.topP;
            if (preset.topK !== undefined) state.aiConfig.topK = preset.topK;
            if (preset.memoryBudget !== undefined) state.aiConfig.memoryBudget = preset.memoryBudget;
            if (preset.maxContext !== undefined) state.aiConfig.maxContext = preset.maxContext;
            if (preset.prefill) state.aiConfig.prefill = preset.prefill;
            applyPresetReferenceSettings(preset);
            if (preset.templates) state.promptTemplates = preset.templates;
            if (preset.promptOrder) state.promptOrder = preset.promptOrder;
            if (preset.enabledTemplates) state.enabledTemplates = preset.enabledTemplates;
            if (preset.regexBindings) state.regexBindings = preset.regexBindings;
            updateRegexDisplay();

            state.presetName = name;
            localStorage.setItem('novel-ai-provider-chosen', state.aiConfig.provider);
            state.isConnected = false;
            applyConfigToUI();
            saveConfig();
            loadAiSecretStatus();
            updatePresetNameDisplay(name);
            updatePresetSelect();
            renderPromptTemplates();
            autoSave();
            setStatus(`✅ 已加载预设: ${name}`, 'success');
        });
        // AI config
        $('#ai-provider').addEventListener('change', onProviderChange);
        $('#ai-api-key').addEventListener('input', debounce(onConfigChange, 500));
        $('#btn-toggle-api-key').addEventListener('click', onToggleApiKey);
        $('#ai-endpoint').addEventListener('input', debounce(onConfigChange, 500));
        $('#ai-model').addEventListener('change', onModelSelectChange);
        $('#ai-temperature').addEventListener('input', () => { onConfigChange(); updateRangeLabels(); });
        $('#ai-max-tokens').addEventListener('input', () => { onConfigChange(); updateRangeLabels(); });
        $('#ai-top-p').addEventListener('input', () => { onConfigChange(); updateRangeLabels(); });
        document.querySelectorAll('input[name="reference-injection-mode"]').forEach(input => {
            input.addEventListener('change', () => {
                if (!input.checked) return;
                setReferenceInjectionMode(input.value);
            });
        });

        // Provider-specific fields
        const bindProviderField = (id, configKey, onChange) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', debounce(() => {
                state.aiConfig[configKey] = el.value.trim();
                saveConfig();
                if (onChange) onChange(el.value);
            }, 500));
            el.addEventListener('change', () => {
                state.aiConfig[configKey] = el.value.trim();
                saveConfig();
                if (onChange) onChange(el.value);
            });
        };
        bindProviderField('ai-vertex-auth-mode', 'vertexAuthMode', (val) => {
            const sa = $('#ai-vertex-service-account-field');
            if (sa) sa.style.display = val === 'full' ? '' : 'none';
        });
        bindProviderField('ai-vertex-region', 'vertexRegion');
        bindProviderField('ai-vertex-project-id', 'vertexProjectId');
        bindProviderField('ai-vertex-service-account-json', 'vertexServiceAccountJson');
        bindProviderField('ai-siliconflow-endpoint', 'siliconflowEndpoint');
        bindProviderField('ai-minimax-endpoint', 'minimaxEndpoint');
        bindProviderField('ai-zai-endpoint', 'zaiEndpoint');

        // Sidebar tabs
        $$('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab));
        });

        // Import menu
        document.addEventListener('click', (e) => {
            const menu = $('#import-menu');
            if (menu && !menu.classList.contains('hidden') && !e.target.closest('#btn-import') && !e.target.closest('#import-menu')) {
                menu.classList.add('hidden');
            }
        });
        $('#import-menu').addEventListener('click', (e) => {
            const item = e.target.closest('.dropdown-item');
            if (!item) return;
            handleImportAction(item.dataset.action);
            $('#import-menu').classList.add('hidden');
        });

        // File inputs
        $('#file-input-worldbook').addEventListener('change', (e) => importWorldBook(e.target.files));
        $('#file-input-character').addEventListener('change', (e) => importCharacters(e.target.files));
        $('#file-input-preset').addEventListener('change', (e) => importPreset(e.target.files));
        $('#file-input-document')?.addEventListener('change', onDocumentSelected);
        $('#file-input-folder')?.addEventListener('change', (e) => importFolder(e.target.files));

        // Editor
        $('#chapter-editor').addEventListener('input', onEditorInput);
        $('#chapter-title-input').addEventListener('input', onTitleChange);
        $('#chapter-select').addEventListener('change', onChapterSelect);

        // Chapter ops
        $('#btn-add-chapter').addEventListener('click', onAddChapter);
        $('#btn-add-volume').addEventListener('click', onAddVolume);

        // World book
        $('#btn-import-wb').addEventListener('click', () => $('#file-input-worldbook').click());
        $('#btn-export-wb')?.addEventListener('click', exportWorldBook);
        bindPanelSearch('#wb-search', '#btn-wb-search');
        $('#wb-search')?.addEventListener('input', () => filterRenderedList('#worldbook-list', '.wb-entry', $('#wb-search').value));
        $('#btn-add-wb-entry').addEventListener('click', () => {
            if (!state.worldBook) state.worldBook = { entries: {} };
            const nextUid = Math.max(0, ...Object.keys(state.worldBook.entries).map(Number)) + 1;
            const newEntry = {
                uid: nextUid,
                key: [],
                keysecondary: [],
                comment: '',
                content: '',
                constant: false,
                selective: true,
                order: 100,
                position: 0,
                disable: false,
                group: '',
                groupWeight: 100,
                sticky: 0,
                cooldown: 0,
                probability: 100,
                depth: 4,
                role: null,
                caseSensitive: null,
                matchWholeWords: null,
                useGroupScoring: null,
                scanDepth: null,
                automationId: '',
            };
            state.worldBook.entries[nextUid] = newEntry;
            renderWorldBookList();
            showWorldBookDetail(nextUid, newEntry);
        });

        // Character
        $('#btn-import-character').addEventListener('click', () => $('#file-input-character').click());
        $('#btn-add-character').addEventListener('click', addCharacter);
        $('#btn-export-char')?.addEventListener('click', exportCharacters);
        bindPanelSearch('#character-search', '#btn-char-search');
        $('#character-search')?.addEventListener('input', () => filterRenderedList('#character-list', '.character-entry', $('#character-search').value));
        $$('.btn-batch-toggle').forEach(button => {
            button.addEventListener('click', () => toggleBatchMode(button.dataset.list, button));
        });
        $$('[data-reference-kind] [data-reference-mode]').forEach(button => {
            button.addEventListener('click', () => {
                const kind = button.closest('[data-reference-kind]').dataset.referenceKind;
                if (kind === 'worldbook') state.writingReference.worldbookMode = button.dataset.referenceMode;
                if (kind === 'character') state.writingReference.characterMode = button.dataset.referenceMode;
                renderReferenceControls();
                autoSave();
            });
        });

        // Outline
        $('#btn-add-outline-node').addEventListener('click', onAddOutlineNode);

        // Keyboard
        document.addEventListener('keydown', onKeyboard);

        // Custom events
        document.addEventListener('inspire:refresh', onInspire);

        // Chat panel
        if (typeof ChatPanel !== 'undefined') {
            ChatPanel.init();
            ChatPanel.registerSessionCallbacks({
                onSwitch: switchChatSession,
                onDelete: deleteChatSession,
                onNew: () => createChatSession(),
            });
        }

        // Save on page unload
        window.addEventListener('beforeunload', () => {
            saveStateToLocal();
            saveChatHistory();
            persistBeforeUnload();
        });

        // Periodic auto-save (every 30 seconds)
        setInterval(() => {
            saveWorkspaceState({ silent: true }).catch(() => {});
            saveActiveSession().catch(() => {});
        }, 30000);

        // Resizable panels
        if (typeof ResizablePanels !== 'undefined') {
            ResizablePanels.init();
        }
        restoreSidebarTab();

        // Chapter tree events
        if (typeof ChapterTree !== 'undefined') {
            ChapterTree.on('select', onChapterTreeSelect);
            ChapterTree.on('rename', onChapterTreeRename);
            ChapterTree.on('delete', onChapterTreeDelete);
            ChapterTree.on('reorder', onChapterTreeReorder);
        }
    }

    // ==================== AI Actions ====================
    async function readSseCompletion(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
            return response.json();
        }
        const reader = response.body?.getReader?.();
        if (!reader) return { reply: '' };
        const decoder = new TextDecoder();
        let buffer = '';
        let reply = '';
        let meta = {};
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';
            for (const block of blocks) {
                const data = block
                    .split(/\r?\n/)
                    .filter(line => line.startsWith('data:'))
                    .map(line => line.slice(5).trimStart())
                    .join('\n');
                if (!data) continue;
                const event = JSON.parse(data);
                if (event.type === 'chunk') reply += event.content || '';
                if (event.type === 'meta') {
                    meta = {
                        context: event.context,
                        memory: event.memory,
                        contextDebug: event.contextDebug,
                    };
                }
                if (event.type === 'done') return { ...meta, reply: event.reply || reply };
                if (event.type === 'error') throw new Error(event.message || 'Stream error');
            }
        }
        return { ...meta, reply };
    }

    async function onContinue() {
        const text = $('#chapter-editor').value;
        if (!text.trim()) { setStatus('请先编写正文再续写', 'warn'); return; }
        if (!state.aiConfig.apiKey && !state.hasSavedApiKey && state.aiConfig.provider !== 'ollama') {
            setStatus('请先配置 API Key', 'error'); return;
        }
        if (state.isGenerating) return;

        state.isGenerating = true;
        setStatus('AI 正在续写...', 'loading');
        const btnC = $('#btn-continue'); if (btnC) { btnC.disabled = true; btnC.textContent = '⏳ 生成中...'; }

        try {
            const response = await fetch('/api/chat/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                body: JSON.stringify({
                    message: '请从当前正文结尾自然续写下一段，只输出小说正文，不要解释。',
                    history: [],
                    config: { ...state.aiConfig, stream: true },
                    context: {
                        currentText: text,
                        worldBookEntries: Object.values(getReferencedWorldBook().entries || {}),
                        characters: getReferencedCharacters(text),
                        outline: getIncompleteOutline(),
                        styleGuide: state.currentNovel?.styleGuide || '',
                        novelId: state.currentNovel?.id,
                        novelTitle: state.currentNovel?.title || '',
                        chapterTitle: state.currentChapter?.title || '',
                        chapterId: state.currentChapter?.id || '',
                        chapterOrder: state.currentChapter?.order ?? null,
                        chapterWindowAnchor: ensureChapterWindowAnchor(),
                    },
                    presetName: state.presetName || '__default__',
                    promptTemplates: (state.promptTemplates || [])
                        .filter(template => state.enabledTemplates?.[template.identifier] !== false),
                    promptOrder: state.promptOrder || [],
                }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            const data = await readSseCompletion(response);
            if (!data.reply?.trim()) throw new Error('模型没有返回正文，请提高单次输出长度后重试');
            const editor = $('#chapter-editor');
            // Append generated content
            editor.value = text + '\n\n' + data.reply;
            editor.scrollTop = editor.scrollHeight;
            state.isDirty = true;
            updateWordCount();
            state.aiUsed = true;
            updateStatusBar();
            updateContextInfo(data.context, data.memory, data.contextDebug);
            showToast('续写完成!', 'success');
        } catch (err) {
            setStatus(`续写失败: ${err.message}`, 'error');
        } finally {
            state.isGenerating = false;
            const btnC2 = $('#btn-continue'); if (btnC2) { btnC2.disabled = false; btnC2.textContent = '续写正文'; }
        }
    }

    async function onPlotSuggestions() {
        const text = $('#chapter-editor').value;
        if (!text.trim()) { setStatus('请先编写正文', 'warn'); return; }
        if (!state.aiConfig.apiKey && !state.hasSavedApiKey && state.aiConfig.provider !== 'ollama') {
            setStatus('请先配置 API Key', 'error'); return;
        }
        if (state.isGenerating) return;

        state.isGenerating = true;
        setStatus('正在生成情节候选...', 'loading');
        const ps = $('#btn-plot-suggestions'); if (ps) ps.disabled = true;

        try {
            const response = await fetch('/api/ai/plot-suggestions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    config: state.aiConfig,
                    worldBook: getReferencedWorldBook(),
                    characters: getReferencedCharacters(text),
                    outline: getIncompleteOutline(),
                    presetName: state.presetName || '__default__',
                }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.candidates?.length > 0) {
                PlotCandidates.show(data.candidates, (selected) => {
                    // Insert selected direction as guidance
                    const editor = $('#chapter-editor');
                    const guidance = `// 情节方向: ${selected.direction}\n// 冲突: ${selected.conflict || '无'}\n\n`;
                    editor.value = editor.value + '\n\n' + guidance;
                    editor.scrollTop = editor.scrollHeight;
                    state.isDirty = true;
                    setStatus(`已选择情节方向: ${selected.direction.substring(0, 30)}...`, 'success');
                });
                setStatus(`生成了 ${data.candidates.length} 条情节候选`, 'success');
            } else {
                setStatus('未能生成有效的情节候选，请重试', 'warn');
            }
        } catch (err) {
            setStatus(`情节生成失败: ${err.message}`, 'error');
        } finally {
            state.isGenerating = false;
            const ps2 = $('#btn-plot-suggestions'); if (ps2) ps2.disabled = false;
        }
    }

    async function onInspire() {
        const text = $('#chapter-editor').value;
        if (!state.aiConfig.apiKey && !state.hasSavedApiKey && state.aiConfig.provider !== 'ollama') {
            setStatus('请先配置 API Key', 'error'); return;
        }
        if (state.isGenerating) return;

        state.isGenerating = true;
        setStatus('正在生成灵感...', 'loading');
        const bi = $('#btn-inspire'); if (bi) bi.disabled = true;

        try {
            const response = await fetch('/api/ai/inspire', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    config: state.aiConfig,
                    worldBook: getReferencedWorldBook(),
                    characters: getReferencedCharacters(text),
                    presetName: state.presetName || '__default__',
                }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            PlotCandidates.showInspiration(data);
            setStatus('灵感已生成', 'success');
        } catch (err) {
            setStatus(`灵感生成失败: ${err.message}`, 'error');
        } finally {
            state.isGenerating = false;
            const bi2 = $('#btn-inspire'); if (bi2) bi2.disabled = false;
        }
    }

    async function onExtractSetting() {
        if (!state.aiConfig.apiKey && !state.hasSavedApiKey && state.aiConfig.provider !== 'ollama') {
            setStatus('请先配置 API Key', 'error'); return;
        }
        showExtractionLauncher();
    }

    function showExtractionLauncher() {
        const text = $('#chapter-editor').value;
        const textChapters = getOrderedTextChapters();
        const minOrder = 1;
        const maxOrder = Math.max(1, textChapters.length);
        document.getElementById('extract-launcher-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'extract-launcher-overlay';
        overlay.className = 'plot-modal-overlay';
        overlay.innerHTML = `
            <div class="plot-modal extraction-launcher-modal">
                <div class="plot-modal-header">
                    <div>
                        <h3>提取设定</h3>
                        <p class="settings-subtitle">从正文中提取角色、世界书和章节摘要。项目逐章扫描会按章节逐步更新进度。</p>
                    </div>
                    <button class="plot-modal-close" aria-label="关闭">×</button>
                </div>
                <div class="plot-modal-body extraction-launcher-body">
                    <section class="settings-group extraction-launcher-section">
                        <h4>当前章节</h4>
                        <p class="settings-subtitle">适合刚写完一章后快速补充角色和世界书。</p>
                        <button type="button" class="ai-btn-primary extract-current-btn extraction-action-btn"${text.trim() ? '' : ' disabled'}>提取当前章节</button>
                    </section>
                    <section class="settings-group extraction-launcher-section">
                        <h4>项目逐章扫描</h4>
                        <p class="settings-subtitle">适合导入长篇后，从已有章节逐章建立或更新设定库。</p>
                        <div class="extraction-range-fields">
                            <label>开始章节序号<input id="extract-project-start" class="ai-input" type="number" min="1" value="${minOrder}"></label>
                            <label>结束章节序号<input id="extract-project-end" class="ai-input" type="number" min="1" value="${maxOrder}"></label>
                            <button type="button" class="ai-btn-secondary extract-project-btn extraction-action-btn"${textChapters.length ? '' : ' disabled'}>逐章扫描</button>
                        </div>
                        <div id="extract-project-progress" class="extract-project-progress"></div>
                    </section>
                </div>
                <div class="plot-modal-footer">
                    <button class="ai-btn-secondary extract-launcher-close">取消</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
        overlay.querySelector('.extract-launcher-close')?.addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.querySelector('.extract-current-btn')?.addEventListener('click', () => runCurrentExtractionBackground(overlay));
        overlay.querySelector('.extract-project-btn')?.addEventListener('click', () => runProjectExtractionBackground(overlay));
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function setExtractionLauncherBusy(overlay, busy, label = '') {
        overlay?.querySelectorAll('button, input').forEach(el => { el.disabled = busy; });
        const progress = overlay?.querySelector('#extract-project-progress');
        if (progress && label) progress.innerHTML = `<div>${escHtml(label)}</div>`;
    }

    // eslint-disable-next-line no-unused-vars
    async function runCurrentExtraction(launcherOverlay) {
        const text = $('#chapter-editor').value;
        if (!text.trim()) { setStatus('请先编写正文再提取设定', 'warn'); return; }
        if (state.isGenerating) return;
        state.isGenerating = true;
        $('#btn-extract-setting').disabled = true;
        setExtractionLauncherBusy(launcherOverlay, true, '正在分析当前章节...');
        setStatus('正在分析正文提取设定...', 'loading');
        showToast('AI 正在提取角色和世界观...', 'loading', 0);
        try {
            const resp = await fetch('/api/ai/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text.slice(-12000),
                    config: state.aiConfig,
                    presetName: state.presetName || '__default__',
                }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Extraction failed');
            document.querySelectorAll('.toast-item').forEach(e => e.remove());
            launcherOverlay?.remove();
            showExtractionResults(data);
        } catch (err) {
            document.querySelectorAll('.toast-item').forEach(e => e.remove());
            setStatus(`提取失败: ${err.message}`, 'error');
        } finally {
            state.isGenerating = false;
            $('#btn-extract-setting').disabled = false;
            setExtractionLauncherBusy(launcherOverlay, false);
        }
    }

    // eslint-disable-next-line no-unused-vars
    async function runProjectExtraction(launcherOverlay) {
        if (!state.currentNovel?.id) { setStatus('请先打开项目', 'warn'); return; }
        if (state.isGenerating) return;
        const startOrder = Number(launcherOverlay.querySelector('#extract-project-start')?.value || 1);
        const endOrder = Number(launcherOverlay.querySelector('#extract-project-end')?.value || startOrder);
        state.isGenerating = true;
        $('#btn-extract-setting').disabled = true;
        setExtractionLauncherBusy(launcherOverlay, true, '正在连接逐章扫描...');
        setStatus('正在逐章扫描项目设定...', 'loading');
        try {
            const resp = await fetch('/api/ai/extract-project-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    config: state.aiConfig,
                    presetName: state.presetName || '__default__',
                    startOrder,
                    endOrder,
                }),
            });
            if (!resp.ok) {
                const data = await resp.json().catch(() => ({}));
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            const data = await readProjectExtractionStream(resp, launcherOverlay.querySelector('#extract-project-progress'));
            launcherOverlay?.remove();
            showExtractionResults(data);
            setStatus('项目逐章扫描完成', 'success');
        } catch (err) {
            setStatus(`逐章扫描失败: ${err.message}`, 'error');
            const progress = launcherOverlay?.querySelector('#extract-project-progress');
            if (progress) progress.insertAdjacentHTML('beforeend', `<div class="error">失败：${escHtml(err.message)}</div>`);
        } finally {
            state.isGenerating = false;
            $('#btn-extract-setting').disabled = false;
            setExtractionLauncherBusy(launcherOverlay, false);
        }
    }

    async function runCurrentExtractionBackground(launcherOverlay) {
        const text = $('#chapter-editor').value;
        if (!text.trim()) { setStatus('请先编写正文再提取设定', 'warn'); return; }
        setExtractionLauncherBusy(launcherOverlay, true, '正在创建后台任务...');
        setStatus('正在创建设定提取任务...', 'loading');
        try {
            const job = await createExtractionJob({
                type: 'current',
                text: text.slice(-12000),
                novelId: state.currentNovel?.id || '',
                chapterId: state.currentChapter?.id || '',
                chapterTitle: state.currentChapter?.title || '',
                chapterOrder: state.currentChapter?.order ?? null,
            });
            launcherOverlay?.remove();
            trackExtractionJob(job);
            showToast('设定提取已挂到后台，可从左下角查看进度。', 'success');
            setStatus('设定提取已在后台执行', 'success');
        } catch (err) {
            setStatus(`提取任务创建失败: ${err.message}`, 'error');
            const progress = launcherOverlay?.querySelector('#extract-project-progress');
            if (progress) progress.insertAdjacentHTML('beforeend', `<div class="error">失败：${escHtml(err.message)}</div>`);
        } finally {
            setExtractionLauncherBusy(launcherOverlay, false);
        }
    }

    async function runProjectExtractionBackground(launcherOverlay) {
        if (!state.currentNovel?.id) { setStatus('请先打开项目', 'warn'); return; }
        const startOrder = Number(launcherOverlay.querySelector('#extract-project-start')?.value || 1);
        const endOrder = Number(launcherOverlay.querySelector('#extract-project-end')?.value || startOrder);
        setExtractionLauncherBusy(launcherOverlay, true, '正在创建逐章扫描任务...');
        setStatus('正在创建逐章扫描任务...', 'loading');
        try {
            const job = await createExtractionJob({
                type: 'project',
                novelId: state.currentNovel.id,
                startOrder,
                endOrder,
            });
            launcherOverlay?.remove();
            trackExtractionJob(job);
            showToast('逐章扫描已挂到后台，可从左下角查看进度。', 'success');
            setStatus('逐章扫描已在后台执行', 'success');
        } catch (err) {
            setStatus(`逐章扫描任务创建失败: ${err.message}`, 'error');
            const progress = launcherOverlay?.querySelector('#extract-project-progress');
            if (progress) progress.insertAdjacentHTML('beforeend', `<div class="error">失败：${escHtml(err.message)}</div>`);
        } finally {
            setExtractionLauncherBusy(launcherOverlay, false);
        }
    }

    async function createExtractionJob(payload) {
        const resp = await fetch('/api/ai/extract-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...payload,
                config: state.aiConfig,
                presetName: state.presetName || '__default__',
            }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        return data.job;
    }

    function initExtractionJobDock() {
        if (document.getElementById('extract-job-dock')) return;
        const dock = document.createElement('div');
        dock.id = 'extract-job-dock';
        dock.hidden = true;
        dock.innerHTML = `
            <button type="button" class="extract-job-toggle" title="查看设定提取任务">
                <span class="extract-job-dot"></span>
                <span class="extract-job-toggle-text">设定提取</span>
            </button>
            <div class="extract-job-panel" hidden>
                <div class="extract-job-panel-head">
                    <div>
                        <strong>设定提取任务</strong>
                        <small>后台运行中，可继续写作</small>
                    </div>
                    <button type="button" class="extract-job-panel-close" aria-label="关闭">×</button>
                </div>
                <div class="extract-job-list"></div>
            </div>`;
        document.body.appendChild(dock);
        dock.querySelector('.extract-job-toggle')?.addEventListener('click', () => {
            const panel = dock.querySelector('.extract-job-panel');
            if (panel) panel.hidden = !panel.hidden;
        });
        dock.querySelector('.extract-job-panel-close')?.addEventListener('click', () => {
            const panel = dock.querySelector('.extract-job-panel');
            if (panel) panel.hidden = true;
        });
        dock.querySelector('.extract-job-list')?.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            const id = button.closest('.extract-job-item')?.dataset.jobId;
            if (!id) return;
            if (button.dataset.action === 'view') void openExtractionJobResult(id);
            if (button.dataset.action === 'remove') void removeExtractionJob(id);
        });
    }

    async function refreshExtractionJobs() {
        try {
            const resp = await fetch('/api/ai/extract-jobs');
            if (!resp.ok) return;
            const data = await resp.json().catch(() => ({}));
            (data.jobs || []).forEach(handleExtractionJobUpdate);
            renderExtractionJobDock();
            if ([...extractionJobs.values()].some(isExtractionJobActive)) startExtractionJobPolling();
        } catch {}
    }

    function trackExtractionJob(job) {
        handleExtractionJobUpdate(job);
        renderExtractionJobDock();
        startExtractionJobPolling();
    }

    function handleExtractionJobUpdate(job) {
        if (!job?.id) return;
        const prev = extractionJobs.get(job.id);
        extractionJobs.set(job.id, { ...(prev || {}), ...job });
        const wasActive = prev && isExtractionJobActive(prev);
        const isFinished = ['done', 'error'].includes(job.status);
        if (wasActive && isFinished && !extractionJobNotices.has(job.id)) {
            extractionJobNotices.add(job.id);
            if (job.status === 'done') {
                applyExtractionChapterSummary(job.result);
                void refreshChaptersAfterExtraction(job.result);
            }
            showToast(job.status === 'done' ? '设定提取完成，点击左下角查看结果。' : `设定提取失败：${job.error || '未知错误'}`, job.status === 'done' ? 'success' : 'error');
        }
    }

    function startExtractionJobPolling() {
        if (extractionJobPollTimer) return;
        extractionJobPollTimer = setInterval(() => { void pollExtractionJobs(); }, 1500);
        void pollExtractionJobs();
    }

    async function pollExtractionJobs() {
        const activeJobs = [...extractionJobs.values()].filter(isExtractionJobActive);
        if (!activeJobs.length) {
            clearInterval(extractionJobPollTimer);
            extractionJobPollTimer = null;
            renderExtractionJobDock();
            return;
        }
        await Promise.all(activeJobs.map(async job => {
            try {
                const resp = await fetch(`/api/ai/extract-jobs/${encodeURIComponent(job.id)}`);
                if (!resp.ok) return;
                const data = await resp.json().catch(() => ({}));
                handleExtractionJobUpdate(data.job);
            } catch {}
        }));
        renderExtractionJobDock();
    }

    function isExtractionJobActive(job) {
        return ['queued', 'running'].includes(job?.status);
    }

    function renderExtractionJobDock() {
        const dock = document.getElementById('extract-job-dock');
        if (!dock) return;
        const jobs = [...extractionJobs.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        dock.hidden = !jobs.length;
        const activeJobs = jobs.filter(isExtractionJobActive);
        const erroredJobs = jobs.filter(job => job.status === 'error');
        dock.classList.toggle('is-active', activeJobs.length > 0);
        dock.classList.toggle('has-error', erroredJobs.length > 0);
        const toggleText = dock.querySelector('.extract-job-toggle-text');
        if (toggleText) {
            toggleText.textContent = activeJobs.length
                ? `设定提取 ${activeJobs.length}`
                : jobs.some(job => job.status === 'done') ? '提取完成' : '设定提取';
        }
        const list = dock.querySelector('.extract-job-list');
        if (!list) return;
        list.innerHTML = jobs.map(renderExtractionJobItem).join('') || '<div class="extract-job-empty">暂无任务</div>';
    }

    function renderExtractionJobItem(job) {
        const labelMap = { queued: '等待中', running: '运行中', done: '已完成', error: '失败' };
        const percent = getExtractionJobPercent(job);
        const recent = (job.progress || []).slice(-4)
            .map(item => `<div>${escHtml(item.message || '')}</div>`)
            .join('');
        const current = job.current?.title ? `<div class="extract-job-current">当前：${escHtml(job.current.title)}</div>` : '';
        const error = job.error ? `<div class="extract-job-error">${escHtml(job.error)}</div>` : '';
        const viewBtn = job.status === 'done'
            ? '<button type="button" class="ai-btn-primary" data-action="view">查看结果</button>'
            : '';
        return `
            <div class="extract-job-item status-${escAttr(job.status || '')}" data-job-id="${escAttr(job.id)}">
                <div class="extract-job-item-head">
                    <b>${escHtml(job.title || '设定提取')}</b>
                    <span>${escHtml(labelMap[job.status] || job.status || '')}</span>
                </div>
                <div class="extract-job-progress"><i style="width:${percent}%"></i></div>
                ${current}
                <div class="extract-job-recent">${recent}</div>
                ${error}
                <div class="extract-job-actions">
                    ${viewBtn}
                    <button type="button" class="ai-btn-secondary" data-action="remove">清除</button>
                </div>
            </div>`;
    }

    function getExtractionJobPercent(job) {
        if (job.status === 'done') return 100;
        if (job.status === 'error') return 100;
        const total = Number(job.range?.total || 0);
        const processed = Number(job.range?.processed || 0);
        if (total > 0) return Math.max(8, Math.min(98, Math.round((processed / total) * 100)));
        return job.status === 'running' ? 35 : 8;
    }

    async function openExtractionJobResult(id) {
        try {
            const resp = await fetch(`/api/ai/extract-jobs/${encodeURIComponent(id)}`);
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
            handleExtractionJobUpdate(data.job);
            renderExtractionJobDock();
            if (!data.job?.result) throw new Error('任务还没有可查看的结果');
            applyExtractionChapterSummary(data.job.result);
            void refreshChaptersAfterExtraction(data.job.result);
            showExtractionResults(data.job.result);
        } catch (err) {
            setStatus(`查看提取结果失败: ${err.message}`, 'error');
        }
    }

    function applyExtractionChapterSummary(result = {}) {
        const brief = result.chapterSummary?.brief || result.chapterSummary || '';
        if (!brief || result.mode !== 'current') return;
        if (!state.currentChapter?.id || String(result.chapterId || '') !== String(state.currentChapter.id)) return;
        state.currentChapter.summary = brief;
        state.currentChapter.summaryGenerator = 'ai-v1';
        state.currentChapter.summaryUpdatedAt = Date.now();
        if (!state.currentChapter.aiSummary || typeof state.currentChapter.aiSummary !== 'object') {
            state.currentChapter.aiSummary = {};
        }
        state.currentChapter.aiSummary.brief = brief;
        const input = $('#chapter-summary-input');
        if (input) input.value = brief;
        const hint = $('#summary-hint');
        if (hint) hint.textContent = 'AI 生成 · 设定提取';
        updateStatusBar();
    }

    async function refreshChaptersAfterExtraction(result = {}) {
        if (!['current', 'project'].includes(result.mode) || !state.currentNovel?.id) return;
        try {
            const data = await ApiClient.get(`/api/chapters?novelId=${encodeURIComponent(state.currentNovel.id)}`);
            const nextChapters = Array.isArray(data.chapters) ? data.chapters : [];
            if (!nextChapters.length) return;
            state.chapters = nextChapters.map(chapter => {
                if (chapter.id !== state.currentChapter?.id) return chapter;
                return { ...state.currentChapter, ...chapter, content: state.currentChapter.content };
            });
            if (state.currentChapter?.id) {
                const latestMeta = nextChapters.find(chapter => chapter.id === state.currentChapter.id);
                const latest = await ApiClient.get(
                    `/api/chapters/${encodeURIComponent(state.currentChapter.id)}?novelId=${encodeURIComponent(state.currentNovel.id)}`,
                ).catch(() => latestMeta);
                if (latest) {
                    Object.assign(state.currentChapter, {
                        summary: latest.summary || state.currentChapter.summary || '',
                        aiSummary: latest.aiSummary || state.currentChapter.aiSummary,
                        summaryGenerator: latest.summaryGenerator || state.currentChapter.summaryGenerator,
                        summaryUpdatedAt: latest.summaryUpdatedAt || state.currentChapter.summaryUpdatedAt,
                    });
                    showChapterSummary(state.currentChapter);
                }
            }
            refreshChapterTree();
            updateStatusBar();
        } catch (err) {
            console.warn('[Extraction] Failed to refresh chapter summaries:', err.message);
        }
    }

    async function removeExtractionJob(id) {
        extractionJobs.delete(id);
        extractionJobNotices.delete(id);
        renderExtractionJobDock();
        try {
            await fetch(`/api/ai/extract-jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch {}
    }

    // eslint-disable-next-line no-unused-vars
    async function readProjectExtractionStream(response, progressEl) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) return response.json();
        const reader = response.body?.getReader?.();
        if (!reader) throw new Error('后端未返回流式响应');
        const decoder = new TextDecoder();
        let buffer = '';
        let finalData = null;
        const pushProgress = text => {
            if (!progressEl || !text) return;
            progressEl.insertAdjacentHTML('beforeend', `<div>${escHtml(text)}</div>`);
            progressEl.scrollTop = progressEl.scrollHeight;
        };
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';
            for (const block of blocks) {
                const data = block.split(/\r?\n/)
                    .filter(line => line.startsWith('data:'))
                    .map(line => line.slice(5).trimStart())
                    .join('\n');
                if (!data) continue;
                const event = JSON.parse(data);
                if (event.type === 'accepted') pushProgress(event.message || '已开始');
                if (event.type === 'start') pushProgress(`开始扫描 ${event.total || 0} 章`);
                if (event.type === 'chapter_start') pushProgress(`第 ${event.index}/${event.total} 章：${event.title || ''}`);
                if (event.type === 'chapter_done') pushProgress(`完成：${event.title || ''}（角色 ${event.characters || 0}，世界书 ${event.worldEntries || 0}）`);
                if (event.type === 'done') finalData = event;
                if (event.type === 'error') throw new Error(event.message || 'Project extraction failed');
            }
        }
        return finalData || { characters: [], worldEntries: [], summary: '逐章扫描完成，但后端未返回结果。' };
    }

    // eslint-disable-next-line no-unused-vars
    function showExtractionResultsLegacy(data) {
        const chars = data.characters || [];
        const entries = data.worldEntries || [];
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';
        const charRows = chars.map((c, i) => `<div class="extract-check-row"><input type="checkbox" class="extract-char-check" data-idx="${i}" checked><span><b>${escHtml(c.name)}</b> — ${escHtml(c.description?.substring(0, 60) || '')}</span></div>`).join('');
        const entryRows = entries.map((e, i) => `<div class="extract-check-row"><input type="checkbox" class="extract-entry-check" data-idx="${i}" checked><span><b>${escHtml(e.comment || e.key?.[0] || '条目')}</b> [${escHtml(e.group || '')}] — ${escHtml((e.key || []).join(', '))}</span></div>`).join('');
        const logRows = (data.extractionLog || []).map(log => `<div class="extract-check-row"><span><b>${escHtml(log.chapter || log.title || '章节')}</b>：角色 ${Number(log.characters || 0)}，世界书 ${Number(log.worldEntries || 0)}</span></div>`).join('');
        overlay.innerHTML = `<div class="plot-modal" style="max-width:700px;max-height:80vh;"><div class="plot-modal-header"><h3>提取结果</h3><p class="settings-subtitle">${data.summary || ''}</p><button class="plot-modal-close">×</button></div>
        <div class="plot-modal-body" style="max-height:55vh;overflow-y:auto;padding:16px;">
        <h4>角色 (${chars.length})</h4>${charRows || '<p style="color:var(--text-muted)">未提取到角色</p>'}
        <h4 style="margin-top:16px;">世界观条目 (${entries.length})</h4>${entryRows || '<p style="color:var(--text-muted)">未提取到世界观</p>'}
        ${logRows ? `<h4 style="margin-top:16px;">逐章扫描记录</h4>${logRows}` : ''}
        </div>
        <div class="plot-modal-footer"><div style="display:flex;gap:8px;"><label><input type="checkbox" id="extract-import-full" checked> 包含内容到正文</label></div><button class="ai-btn-secondary extract-close-btn">取消</button><button class="ai-btn-primary extract-import-btn">导入选中</button></div></div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
        overlay.querySelector('.extract-close-btn')?.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.querySelector('.extract-import-btn')?.addEventListener('click', () => {
            const selChars = overlay.querySelectorAll('.extract-char-check:checked');
            const selEntries = overlay.querySelectorAll('.extract-entry-check:checked');
            if (!chars.length && !entries.length) { close(); return; }
            // Import selected characters
            selChars.forEach(cb => {
                const c = chars[parseInt(cb.dataset.idx)];
                if (c) state.characters.push({ _source: 'AI提取', spec: 'chara_card_v3', spec_version: '3.0', data: { name: c.name, description: c.description || '', personality: c.personality || '', scenario: c.scenario || '', first_mes: c.first_mes || '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', tags: [], group: c.group || '', character_book: { entries: [] } } });
            });
            // Import selected world entries
            selEntries.forEach(cb => {
                const e = entries[parseInt(cb.dataset.idx)];
                if (e) {
                    if (!state.worldBook) state.worldBook = { entries: {} };
                    const uid = Date.now() + Math.random();
                    state.worldBook.entries[uid] = { _source: 'AI提取', folder: 'AI提取', sourceGroup: e.group || '', group: e.group || '', uid, key: e.key || [], keysecondary: [], content: e.content || '', comment: e.comment || '', constant: false, selective: true, order: 100, position: 0, disable: false, probability: 100, depth: 4 };
                }
            });
            renderCharacterList();
            renderWorldBookList();
            autoSave();
            close();
            showToast(`已导入 ${selChars.length} 个角色 + ${selEntries.length} 条世界书`, 'success');
        });
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function showExtractionResults(data) {
        const chars = data.characters || [];
        const entries = data.worldEntries || [];
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';
        const charRows = chars.map((c, i) => {
            const detail = (c.summary || c.description || '').substring(0, 120);
            return `<label class="extract-check-row"><input type="checkbox" class="extract-char-check" data-idx="${i}" checked><span><b>${escHtml(c.name || '未命名角色')}</b><em>${escHtml(detail)}</em></span></label>`;
        }).join('');
        const entryRows = entries.map((e, i) => {
            const detail = [
                e.group ? `分组：${e.group}` : '',
                (e.summary || (e.key || []).join(', ')).substring(0, 120),
            ].filter(Boolean).join(' · ');
            return `<label class="extract-check-row"><input type="checkbox" class="extract-entry-check" data-idx="${i}" checked><span><b>${escHtml(e.comment || e.key?.[0] || '条目')}</b><em>${escHtml(detail)}</em></span></label>`;
        }).join('');
        const logRows = (data.extractionLog || []).map(log => `<div class="extract-log-row"><b>${escHtml(log.chapter || log.title || '章节')}</b><span>角色 ${Number(log.characters || 0)}，世界书 ${Number(log.worldEntries || 0)}${log.chapterSummary ? ` · ${escHtml(log.chapterSummary.substring(0, 80))}` : ''}</span></div>`).join('');
        overlay.innerHTML = `<div class="plot-modal extraction-result-modal"><div class="plot-modal-header"><h3>提取结果</h3><p class="settings-subtitle">${escHtml(data.summary || '')}</p><button class="plot-modal-close">×</button></div>
        <div class="plot-modal-body extraction-result-body">
            <section class="extract-result-section"><h4>角色</h4><p class="settings-subtitle">共识别 ${chars.length} 个角色候选，可勾选后导入角色卡。</p></section>
            <section class="extract-result-section"><h4>提取的角色条目</h4><div class="extract-result-list">${charRows || '<p class="extract-empty">未提取到角色</p>'}</div></section>
            <section class="extract-result-section"><h4>世界观</h4><p class="settings-subtitle">共识别 ${entries.length} 条世界书候选，可勾选后导入世界书。</p></section>
            <section class="extract-result-section"><h4>提取的世界观条目</h4><div class="extract-result-list">${entryRows || '<p class="extract-empty">未提取到世界观</p>'}</div></section>
            ${logRows ? `<section class="extract-result-section"><h4>逐章扫描记录</h4><div class="extract-result-list">${logRows}</div></section>` : '<section class="extract-result-section"><h4>逐章扫描记录</h4><p class="extract-empty">当前不是逐章扫描任务</p></section>'}
        </div>
        <div class="plot-modal-footer"><button class="ai-btn-secondary extract-close-btn">取消</button><button class="ai-btn-primary extract-import-btn">导入选中</button></div></div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
        overlay.querySelector('.extract-close-btn')?.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.querySelector('.extract-import-btn')?.addEventListener('click', () => {
            const selChars = overlay.querySelectorAll('.extract-char-check:checked');
            const selEntries = overlay.querySelectorAll('.extract-entry-check:checked');
            if (!chars.length && !entries.length) { close(); return; }
            selChars.forEach(cb => {
                const c = chars[parseInt(cb.dataset.idx)];
                if (c) state.characters.push({ _source: 'AI提取', spec: 'chara_card_v3', spec_version: '3.0', data: { name: c.name, summary: c.summary || '', description: c.description || '', personality: c.personality || '', scenario: c.scenario || '', first_mes: c.first_mes || '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', tags: [], group: c.group || '', character_book: { entries: [] } } });
            });
            selEntries.forEach(cb => {
                const e = entries[parseInt(cb.dataset.idx)];
                if (e) {
                    if (!state.worldBook) state.worldBook = { entries: {} };
                    const uid = Date.now() + Math.random();
                    state.worldBook.entries[uid] = { _source: 'AI提取', folder: 'AI提取', sourceGroup: e.group || '', group: e.group || '', uid, key: e.key || [], keysecondary: [], summary: e.summary || '', content: e.content || '', comment: e.comment || '', constant: false, selective: true, order: 100, position: 0, disable: false, probability: 100, depth: 4 };
                }
            });
            renderCharacterList();
            renderWorldBookList();
            autoSave();
            close();
            showToast(`已导入 ${selChars.length} 个角色 + ${selEntries.length} 条世界书`, 'success');
        });
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    async function onTestConnection() {
        const apiKey = $('#ai-api-key').value.trim();
        state.aiConfig.provider = $('#ai-provider').value;
        state.aiConfig.apiKey = apiKey;
        state.aiConfig.endpoint = $('#ai-endpoint').value.trim();
        state.aiConfig.model = $('#ai-model').value.trim();
        saveConfig();
        setStatus('正在测试连接...', 'loading');
        try {
            if (apiKey) await saveAiSecret(apiKey);
            const response = await fetch('/api/ai/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    config: { ...state.aiConfig, apiKey: '' },
                    presetName: state.presetName || '__default__',
                }),
            });
            const data = await response.json();
            state.isConnected = data.success;
            if (data.success) {
                localStorage.setItem('novel-ai-provider-chosen', state.aiConfig.provider);
                localStorage.setItem('novel-ai-connected-provider', state.aiConfig.provider);
                rememberLastSuccessfulAiConfig();
            } else if (localStorage.getItem('novel-ai-connected-provider') === state.aiConfig.provider) {
                localStorage.removeItem('novel-ai-connected-provider');
            }
            updateStatusBar();
            setStatus(data.success ? '\u8fde\u63a5\u6210\u529f' : `\u8fde\u63a5\u5931\u8d25: ${data.error}`, data.success ? 'success' : 'error');
            return;
        } catch (err) {
            state.isConnected = false;
            if (localStorage.getItem('novel-ai-connected-provider') === state.aiConfig.provider) {
                localStorage.removeItem('novel-ai-connected-provider');
            }
            updateStatusBar();
            setStatus(`连接失败: ${err.message}`, 'error');
        }
    }

    // ==================== Chapter Management ====================
    async function createChapter({ title, content = '', silent = false } = {}) {
        const defaultTitle = `第${state.chapters.filter(c => c.type !== 'volume').length + 1}章`;
        const chapterTitle = title?.trim() || defaultTitle;
        try {
            const resp = await fetch('/api/chapters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    title: chapterTitle,
                    content,
                }),
            });
            const chapter = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(chapter.error || `HTTP ${resp.status}`);
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
        const title = `第${state.chapters.filter(c => c.type === 'volume').length + 1}卷`;
        try {
            const response = await fetch('/api/chapters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    title,
                    type: 'volume',
                }),
            });
            const volume = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(volume.error || `HTTP ${response.status}`);
            state.chapters.push(volume);
            refreshChapterTree();
            setStatus(`已创建: ${volume.title}`, 'success');
        } catch (err) {
            setStatus(`创建卷失败: ${err.message}`, 'error');
        }
    }

    async function onChapterSelect(e) {
        const id = e.target.value;
        if (!id) return;
        await switchChapter(id);
    }

    function loadChapter(chapter, { refreshTree = true } = {}) {
        if (!chapter) return;
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
        setTimeout(() => {
            if (state.currentChapter?.id === chapter.id) {
                maybePackChapterWindow().catch(() => {});
            }
        }, 250);
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
            try { localStorage.setItem('cgj-sum-h', area.style.height); } catch {}
        });
        try { const h = localStorage.getItem('cgj-sum-h'); if (h) area.style.height = h; } catch {}
    }

    async function onAiExtractSummary() {
        const editor = $('#chapter-editor');
        const text = editor?.value?.trim();
        if (!text) { setStatus('请先编写正文', 'warn'); return; }
        const btn = $('#btn-ai-summary');
        if (btn) { btn.disabled = true; btn.textContent = '提取中…'; }
        setStatus('AI 正在分析本章…', 'loading');
        try {
            const resp = await fetch('/api/ai/extract', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, config: state.aiConfig, presetName: state.presetName || '__default__' }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || '提取失败');
            if (data.chapterSummary?.brief) {
                const input = $('#chapter-summary-input');
                if (input) input.value = data.chapterSummary.brief;
                const hint = $('#summary-hint');
                if (hint) hint.textContent = 'AI 生成 · ' + new Date().toLocaleTimeString();
                state.currentChapter.summary = data.chapterSummary.brief;
                state.currentChapter.summaryGenerator = 'ai-v1';
                if (state.currentChapter?.id && state.currentNovel?.id) {
                    await fetch('/api/chapters/' + state.currentChapter.id, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ novelId: state.currentNovel.id, summary: data.chapterSummary.brief }),
                    }).catch(() => {});
                }
            }
            setStatus('摘要已更新', 'success');
        } catch (err) {
            setStatus('提取失败: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'AI 提取'; }
        }
    }

    async function saveChapterSummaryEdit() {
        if (!state.currentChapter?.id || !state.currentNovel?.id) {
            setStatus('请先选择章节', 'warn');
            return;
        }
        const summary = getChapterSummary();
        const btn = $('#btn-save-summary');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '保存中';
        }
        try {
            const resp = await fetch(`/api/chapters/${encodeURIComponent(state.currentChapter.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    title: $('#chapter-title-input')?.value || state.currentChapter.title,
                    content: $('#chapter-editor')?.value || state.currentChapter.content || '',
                    summary,
                }),
            });
            const updated = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(updated.error || `HTTP ${resp.status}`);
            state.currentChapter.summary = summary;
            state.currentChapter.summaryGenerator = 'manual';
            const hint = $('#summary-hint');
            if (hint) hint.textContent = '已手动保存 · ' + new Date().toLocaleTimeString();
            setStatus('本章摘要已保存', 'success');
        } catch (err) {
            setStatus('摘要保存失败: ' + err.message, 'error');
        } finally {
            if (btn) {
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

        const ch = state.currentChapter;
        const content = $('#chapter-editor').value;
        const title = $('#chapter-title-input').value || ch.title;

        try {
            const summary = getChapterSummary();
            const saveBody = { novelId: state.currentNovel.id, title, content };
            if (summary && summary !== (ch.summary || ch.aiSummary?.brief || '')) {
                saveBody.summary = summary;
            }
            const resp = await fetch(`/api/chapters/${ch.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(saveBody),
            });
            const updated = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(updated.error || `HTTP ${resp.status}`);

            // Update local state
            const idx = state.chapters.findIndex(c => c.id === ch.id);
            if (idx >= 0) state.chapters[idx] = updated;
            state.currentChapter = updated;
            state.isDirty = false;
            updateStatusBar();
            refreshChapterTree();
            if (!silent) showToast('已保存', 'success');
            return true;
        } catch (err) {
            setStatus(`保存失败: ${err.message}`, 'error');
            return false;
        }
    }

    function refreshChapterTree() {
        if (typeof ChapterTree !== 'undefined') {
            ChapterTree.render(state.chapters, state.currentChapter?.id);
        }
    }

    async function switchChapter(id) {
        if (!id || id === state.currentChapter?.id) return true;
        if (state.isDirty && !await onSave({ silent: true })) {
            refreshChapterTree();
            return false;
        }
        const chapterMeta = state.chapters.find(item => item.id === id);
        if (!chapterMeta || chapterMeta.type === 'volume') return false;
        try {
            setStatus(`正在加载: ${chapterMeta.title}`, 'loading');
            const chapter = typeof chapterMeta.content === 'string'
                ? chapterMeta
                : await ApiClient.get(
                    `/api/chapters/${encodeURIComponent(id)}?novelId=${encodeURIComponent(state.currentNovel.id)}`,
                );
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
        const newTitle = prompt('重命名章节:', ch.title);
        if (newTitle && newTitle !== ch.title) {
            try {
                const response = await fetch(`/api/chapters/${encodeURIComponent(id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        novelId: state.currentNovel.id,
                        title: newTitle,
                    }),
                });
                const updated = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(updated.error || `HTTP ${response.status}`);
                Object.assign(ch, updated);
                if (state.currentChapter?.id === id) {
                    state.currentChapter = ch;
                    $('#chapter-title-input').value = newTitle;
                    $('#current-chapter-title').textContent = `— ${newTitle}`;
                }
                refreshChapterTree();
                setStatus(`已重命名: ${newTitle}`, 'success');
            } catch (err) {
                setStatus(`重命名失败: ${err.message}`, 'error');
            }
        }
    }

    async function onChapterTreeDelete(id) {
        const item = state.chapters.find(chapter => chapter.id === id);
        if (!item) return;
        try {
            const response = await fetch(`/api/chapters/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ novelId: state.currentNovel.id }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

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
            setStatus(`删除失败: ${err.message}`, 'error');
        }
    }

    async function onChapterTreeReorder({ chapterId, volumeId, beforeChapterId }) {
        const chapter = state.chapters.find(item => item.id === chapterId && item.type !== 'volume');
        if (!chapter) return;
        const snapshot = state.chapters.map(item => ({ ...item }));
        const targetVolumeId = volumeId || '';
        const siblings = state.chapters
            .filter(item => item.type !== 'volume' && item.id !== chapterId && (item.volumeId || '') === targetVolumeId)
            .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
        const beforeIndex = beforeChapterId
            ? siblings.findIndex(item => item.id === beforeChapterId)
            : -1;
        const insertAt = beforeIndex >= 0 ? beforeIndex : siblings.length;
        siblings.splice(insertAt, 0, chapter);
        chapter.volumeId = targetVolumeId;
        siblings.forEach((item, index) => { item.order = index; });
        sortChapterState();
        refreshChapterTree();

        try {
            for (const item of siblings) {
                const response = await fetch(`/api/chapters/${encodeURIComponent(item.id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        novelId: state.currentNovel.id,
                        volumeId: item.volumeId || '',
                        order: item.order,
                    }),
                });
                const updated = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(updated.error || `HTTP ${response.status}`);
                Object.assign(item, updated);
            }
            sortChapterState();
            refreshChapterTree();
            setStatus(targetVolumeId ? '章节已移入卷' : '章节已移出卷', 'success');
        } catch (err) {
            state.chapters = snapshot;
            refreshChapterTree();
            setStatus(`移动章节失败: ${err.message}`, 'error');
        }
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

    async function ensureNovelExists() {
        const novelId = state.currentNovel?.id || 'default';
        try {
            // Check if project exists
            const listResp = await fetch('/api/novels');
            const list = await listResp.json();
            const exists = (list.novels || []).some(n => n.id === novelId);
            if (!exists) {
                // Use novelId as title so the resulting directory matches
                const resp = await fetch('/api/novels', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: novelId }),
                });
                const created = await resp.json();
                // Update state with the actual created id
                if (created.id) state.currentNovel.id = created.id;
            }
        } catch { /* ignore — project might already exist */ }
    }

    // ==================== World Book Import ====================
    async function importWorldBook(files) {
        if (!files?.[0]) return;
        const file = files[0];

        try {
            await ensureNovelExists();
            const text = await readFileAsText(file);
            const data = JSON.parse(text);

            const resp = await fetch('/api/import/worldbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    name: file.name.replace('.json', ''),
                    data,
                }),
            });

            if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);

            const result = await resp.json();
            // Merge into existing entries instead of replacing
            const sourceName = file.name.replace(/\.json$/i, '');
            const incoming = result.entries || {};
            if (!state.worldBook) state.worldBook = { entries: {}, sources: {} };
            if (!state.worldBook.entries) state.worldBook.entries = {};
            if (!state.worldBook.sources) state.worldBook.sources = {};
            // Tag each entry with its source file
            for (const [uid, entry] of Object.entries(incoming)) {
                entry._source = sourceName;
                entry.folder = entry.folder || entry._folder || sourceName;
                if (entry.group && !entry.sourceGroup) entry.sourceGroup = entry.group;
            }
            Object.assign(state.worldBook.entries, incoming);
            ensureWorldBookFolders().add(sourceName);
            state.worldBook.sources[sourceName] = {
                name: sourceName,
                entryCount: Object.keys(incoming).length,
                importedAt: Date.now(),
            };
            renderWorldBookList();
            autoSave();
            setStatus(`✅ 世界书导入成功: ${result.entryCount} 个条目`, 'success');
        } catch (err) {
            setStatus(`世界书导入失败: ${err.message}`, 'error');
        }
    }

    function getWorldBookGroups() {
        return getWorldBookFolders();
    }

    function ensureWorldBookFolders() {
        if (!state.worldBook) state.worldBook = { entries: {}, sources: {}, folders: [] };
        if (!state.worldBook.entries) state.worldBook.entries = {};
        if (!state.worldBook.sources) state.worldBook.sources = {};
        if (!Array.isArray(state.worldBook.folders)) state.worldBook.folders = [];
        const folders = new Set(state.worldBook.folders.map(folder => String(folder || '').trim()).filter(Boolean));
        state.worldBook.folders = [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        return folders;
    }

    function getWorldBookFolder(entry = {}) {
        return String(entry.folder || entry._folder || entry._source || entry.group || '').trim();
    }

    function setWorldBookFolder(entry = {}, folder = '') {
        const value = String(folder || '').trim();
        entry.folder = value;
        entry._folder = value;
        if (entry._source || value) entry._source = value;
        return entry;
    }

    function getWorldBookFolders() {
        const folderSet = ensureWorldBookFolders();
        const entries = state.worldBook?.entries || {};
        for (const entry of Object.values(entries)) {
            const folder = getWorldBookFolder(entry);
            if (folder) folderSet.add(folder);
        }
        state.worldBook.folders = [...folderSet].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        return state.worldBook.folders;
    }

    function showGroupManager(onChanged) {
        const groups = getWorldBookGroups();
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';
        const rows = groups.map(g => `
            <div class="group-mgr-row" data-group="${escHtml(g)}">
                <span class="group-mgr-name">${escHtml(g)}</span>
                <div class="group-mgr-actions">
                    <button class="ai-btn-secondary group-rename-btn">重命名</button>
                    <button class="ai-btn-secondary group-delete-btn">删除</button>
                </div>
            </div>`).join('');
        overlay.innerHTML = `<div class="plot-modal group-manager-modal">
            <div class="plot-modal-header">
                <h3>管理分组</h3>
                <button class="plot-modal-close">×</button>
            </div>
            <div class="plot-modal-body group-manager-body">
                <div class="group-manager-add">
                    <input type="text" id="group-new-input" class="ai-input" placeholder="新分组名称">
                    <button id="group-add-btn" class="ai-btn-primary">新建分组</button>
                </div>
                <div class="group-manager-list">
                    ${rows || '<p class="group-manager-empty">暂无分组</p>'}
                </div>
            </div>
            <div class="plot-modal-footer"><button class="ai-btn-secondary group-close-btn">关闭</button></div></div>`;
        document.body.appendChild(overlay);
        const close = () => { overlay.remove(); onChanged?.(); };
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
        overlay.querySelector('.group-close-btn')?.addEventListener('click', close);

        // New group
        overlay.querySelector('#group-add-btn')?.addEventListener('click', () => {
            const inp = overlay.querySelector('#group-new-input');
            const name = inp?.value?.trim();
            if (!name) return;
            const folders = ensureWorldBookFolders();
            if (!folders.has(name)) {
                // Create a dummy entry to register the group, then remove it — no, just reopen with the group added
                folders.add(name);
                state.worldBook.folders = [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
                autoSave();
            }
            close();
            showGroupManager(onChanged);
        });
        // Rename
        overlay.querySelectorAll('.group-rename-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.group-mgr-row');
                const oldName = row?.dataset.group;
                if (!oldName) return;
                const newName = prompt('重命名分组：', oldName)?.trim();
                if (!newName || newName === oldName) return;
                const entries = state.worldBook?.entries || {};
                for (const e of Object.values(entries)) {
                    if (getWorldBookFolder(e) === oldName) setWorldBookFolder(e, newName);
                }
                const folders = ensureWorldBookFolders();
                folders.delete(oldName);
                folders.add(newName);
                state.worldBook.folders = [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
                renderWorldBookList();
                renderReferenceControls();
                autoSave();
                close();
                showGroupManager(onChanged);
            });
        });

        // Delete
        overlay.querySelectorAll('.group-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.group-mgr-row');
                const name = row?.dataset.group;
                if (!name) return;
                if (!confirm('删除分组 "' + name + '" 不会删除其中的条目，它们会变成无分组。确认？')) return;
                const entries = state.worldBook?.entries || {};
                for (const e of Object.values(entries)) {
                    if (getWorldBookFolder(e) === name) setWorldBookFolder(e, '');
                }
                const folders = ensureWorldBookFolders();
                folders.delete(name);
                state.worldBook.folders = [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
                renderWorldBookList();
                renderReferenceControls();
                autoSave();
                close();
                showGroupManager(onChanged);
            });
        });

        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function renderWorldBookList() {
        const list = $('#worldbook-list');
        const entries = state.worldBook?.entries || {};
        const keys = Object.keys(entries);

        if (keys.length === 0) {
            list.innerHTML = '<div class="list-placeholder">尚未导入世界书<br>点击 "导入" 导入世界书</div>';
            renderReferenceControls();
            return;
        }

        // Mark which entries are "active" (matched in current text)
        const currentText = $('#chapter-editor').value || '';
        const activeUids = new Set();
        for (const [k, e] of Object.entries(entries)) {
            if (e.disable || !e.key?.length) continue;
            const matched = e.key.some(kw => {
                try { return new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi').test(currentText); }
                catch { return currentText.toLowerCase().includes(kw.toLowerCase()); }
            });
            if (matched) activeUids.add(k);
        }

        // Render a single entry
        function renderEntry(k, e) {
            const name = e.comment || e.key?.[0] || `条目${k}`;
            const mainKw = (e.key || []).join(', ');
            const subKw = (e.keysecondary || []).join(', ');
            const matchedNow = activeUids.has(k);
            const folder = getWorldBookFolder(e);
            const groupTag = folder ? `<span class="wb-group-tag">${escHtml(folder)}</span>` : '';

            // 小圆点状态，不用 emoji
            let dotColor, dotTitle;
            if (e.disable) {
                dotColor = 'var(--text-muted)'; dotTitle = '已禁用';
            } else if (e.constant) {
                dotColor = 'var(--success)'; dotTitle = '始终激活';
            } else if (matchedNow) {
                dotColor = 'var(--success)'; dotTitle = '触发中';
            } else {
                dotColor = 'var(--text-muted)'; dotTitle = '待触发';
            }

            const summary = (e.summary || (e.content || '').replace(/\\s+/g, ' ').trim().substring(0, 60)).trim();
            let subtitle = '';
            if (summary) {
                subtitle = `<div class="item-subtitle">${escHtml(summary.substring(0, 60))}${summary.length > 60 ? '…' : ''}</div>`;
            }

            return `<div class="list-item wb-entry ${matchedNow ? 'active-in-scene' : ''}" data-uid="${k}">
                <input type="checkbox" class="batch-check" data-id="${k}" aria-label="选择 ${escHtml(name)}">
                <span class="wb-dot" style="color:${dotColor}" title="${dotTitle}">●</span>
                <div class="item-body">
                    <div class="item-title">${escHtml(name)}${groupTag}</div>
                    ${subtitle}
                </div>
            </div>`;
        }

        // Group entries by folder. `_source` and ST `group` are compatibility fallbacks.
        const groups = {};
        const ungrouped = [];
        for (const k of keys) {
            const source = getWorldBookFolder(entries[k]);
            if (source) {
                if (!groups[source]) groups[source] = [];
                groups[source].push(k);
            } else {
                ungrouped.push(k);
            }
        }

        let html = '';
        const sourceNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-CN'));

        for (const source of sourceNames) {
            const groupKeys = groups[source];
            const activeInGroup = groupKeys.filter(k => activeUids.has(k)).length;
            html += `<div class="source-group">`;
            html += `<div class="source-group-header" data-source="${escHtml(source)}">`;
            html += `<span class="source-group-arrow">▶</span>`;
            html += `<span class="source-group-name">📁 ${escHtml(source)}</span>`;
            html += `<span class="source-group-count">${groupKeys.length} 条${activeInGroup > 0 ? ` · ${activeInGroup} 触发` : ''}</span>`;
            html += `</div>`;
            html += `<div class="source-group-body">`;
            for (const k of groupKeys) {
                html += renderEntry(k, entries[k]);
            }
            html += `</div></div>`;
        }

        if (ungrouped.length > 0) {
            html += `<div class="source-group">`;
            html += `<div class="source-group-header" data-source="__ungrouped__">`;
            html += `<span class="source-group-arrow">▶</span>`;
            html += `<span class="source-group-name">📁 未分组</span>`;
            html += `<span class="source-group-count">${ungrouped.length} 条</span>`;
            html += `</div>`;
            html += `<div class="source-group-body">`;
            for (const k of ungrouped) {
                html += renderEntry(k, entries[k]);
            }
            html += `</div></div>`;
        }

        list.innerHTML = html;

        // Group header click → toggle collapse
        list.querySelectorAll('.source-group-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
                const arrow = header.querySelector('.source-group-arrow');
                const body = header.nextElementSibling;
                if (body) {
                    body.classList.toggle('hidden');
                    if (arrow) arrow.textContent = body.classList.contains('hidden') ? '▶' : '▼';
                }
            });
        });

        // Entry click → show detail
        list.querySelectorAll('.wb-entry').forEach(el => {
            el.addEventListener('click', event => {
                if (event.target.closest('.batch-check')) return;
                if (list.closest('.sidebar-panel')?.classList.contains('batch-mode')) {
                    const checkbox = el.querySelector('.batch-check');
                    if (checkbox) checkbox.checked = !checkbox.checked;
                    return;
                }
                const uid = el.dataset.uid;
                const entry = state.worldBook.entries[uid];
                if (entry) showWorldBookDetail(uid, entry);
            });
        });
        // Auto-fill empty summaries from content
        let wbChanged = false;
        for (const [k, e] of Object.entries(entries)) {
            if (!e.summary && e.content) {
                e.summary = e.content.replace(/\s+/g, ' ').trim().substring(0, 150);
                wbChanged = true;
            }
        }
        if (wbChanged) autoSave();
        renderReferenceControls();
    }

    function showWorldBookDetail(uid, entry) {
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';

        const isActive = checkEntryActive(entry);
        let statusText, statusColor;
        if (entry.disable) {
            statusText = '已禁用'; statusColor = 'var(--text-muted)';
        } else if (entry.constant) {
            statusText = '始终激活'; statusColor = 'var(--success)';
        } else if (isActive) {
            statusText = '触发中'; statusColor = 'var(--success)';
        } else {
            statusText = '待触发'; statusColor = 'var(--text-muted)';
        }
        const posLabels = ['角色前', '角色后', '按深度', '@D标注'];

        const modal = document.createElement('div');
        modal.className = 'plot-modal char-detail-modal wb-edit-modal';
        const groups = getWorldBookGroups();
        const currentFolder = getWorldBookFolder(entry);
        const groupOptions = ['', ...groups].map(g => `<option value="${escHtml(g)}" ${currentFolder === g ? 'selected' : ''}>${escHtml(g) || '（无文件夹）'}</option>`).join('');
        modal.innerHTML = `
            <div class="plot-modal-header">
                <h3>编辑世界书条目</h3>
                <span style="font-size:11px;color:${statusColor}">${statusText}</span>
                <button class="plot-modal-close">×</button>
            </div>
            <div class="plot-modal-body char-detail-body">
                <div class="char-field">
                    <h4>名称</h4>
                    <input type="text" class="wb-edit-input" id="wb-edit-comment" value="${escHtml(entry.comment || '')}" placeholder="用于识别的名称...">
                </div>
                <div class="char-field">
                    <h4>分组</h4>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <select class="wb-edit-input" id="wb-edit-folder" style="flex:1;">${groupOptions}</select>
                        <button type="button" id="wb-group-manage-btn" class="ai-btn-secondary" style="width:auto;min-height:auto;font-size:10px;padding:2px 8px;white-space:nowrap;flex-shrink:0;">管理分组</button>
                    </div>
                </div>
                <div class="char-field">
                    <h4>触发关键词（逗号分隔）</h4>
                    <input type="text" class="wb-edit-input" id="wb-edit-key" value="${escHtml((entry.key || []).join(', '))}" placeholder="关键词1, 关键词2...">
                </div>
                <div class="char-field">
                    <h4>次级关键词（逗号分隔）</h4>
                    <input type="text" class="wb-edit-input" id="wb-edit-keysecondary" value="${escHtml((entry.keysecondary || []).join(', '))}" placeholder="次要触发词...">
                </div>
                <div class="char-field">
                    <h4>注入内容</h4>
                    <textarea class="wb-edit-textarea" id="wb-edit-content" placeholder="当关键词触发时，这段内容会被注入到 AI 的上下文中...">${escHtml(entry.content || '')}</textarea>
                </div>
                <div class="char-field">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                        <h4 style="margin:0;">摘要</h4>
                        <button type="button" class="ai-btn-secondary" id="wb-summarize-btn">AI 提取</button>
                    </div>
                    <textarea class="wb-edit-textarea character-edit-short" id="wb-edit-summary" placeholder="智能摘要模式下使用的简略描述。留空则该条目不会注入。" style="width:100%;">${escHtml(entry.summary || '')}</textarea>
                </div>
                <div class="wb-edit-row">
                    <div class="char-field" style="flex:1;">
                        <h4>排序</h4>
                        <input type="number" class="wb-edit-input" id="wb-edit-order" value="${entry.order ?? 100}" min="1" max="999">
                    </div>
                    <div class="char-field" style="flex:1;">
                        <h4>扫描深度</h4>
                        <input type="number" class="wb-edit-input" id="wb-edit-depth" value="${entry.depth ?? 4}" min="0" max="100">
                    </div>
                </div>
                <div class="wb-edit-row">
                    <div class="char-field" style="flex:1;">
                        <h4>注入位置</h4>
                        <select class="wb-edit-input" id="wb-edit-position">
                            ${posLabels.map((l, i) => `<option value="${i}" ${(entry.position ?? 0) === i ? 'selected' : ''}>${l}</option>`).join('')}
                        </select>
                    </div>
                    <div class="char-field" style="flex:1;">
                        <h4>激活概率 (%)</h4>
                        <input type="number" class="wb-edit-input" id="wb-edit-probability" value="${entry.probability ?? 100}" min="0" max="100">
                    </div>
                </div>
                <details class="wb-st-config">
                    <summary>ST 专用配置（兼容导入字段）</summary>
                    <p style="margin:6px 0 10px;color:var(--text-muted);font-size:12px;">这些字段主要用于保留酒馆世界书原始配置；日常分组请使用上方“文件夹”。</p>
                <div class="wb-edit-row">
                    <div class="char-field" style="flex:1;">
                        <h4>📁 分组名</h4>
                        <input type="text" class="wb-edit-input" id="wb-edit-source-group" value="${escHtml(entry.sourceGroup || entry.group || '')}" placeholder="酒馆世界书 group，可选" list="wb-group-list">
                        <datalist id="wb-group-list">
                            <option value="角色">
                            <option value="地点">
                            <option value="事件">
                            <option value="物品">
                            <option value="组织">
                            <option value="概念">
                            <option value="魔法">
                            <option value="历史">
                        </datalist>
                    </div>
                    <div class="char-field" style="flex:1;">
                        <h4>⚖️ 分组权重</h4>
                        <input type="number" class="wb-edit-input" id="wb-edit-groupWeight" value="${entry.groupWeight ?? 100}" min="1" max="999">
                    </div>
                </div>
                </details>
                <div class="wb-edit-checks">
                    <label class="wb-check-label"><input type="checkbox" id="wb-edit-constant" ${entry.constant ? 'checked' : ''}> 始终激活（忽略关键词匹配）</label>
                    <label class="wb-check-label"><input type="checkbox" id="wb-edit-disable" ${entry.disable ? 'checked' : ''}> 禁用此条目</label>
                    <label class="wb-check-label"><input type="checkbox" id="wb-edit-caseSensitive" ${entry.caseSensitive ? 'checked' : ''}> 大小写敏感</label>
                    <label class="wb-check-label"><input type="checkbox" id="wb-edit-matchWholeWords" ${entry.matchWholeWords ? 'checked' : ''}> 全词匹配</label>
                </div>
            </div>
            <div class="plot-modal-footer">
                <button class="char-btn-delete wb-delete-btn">删除条目</button>
                <button class="char-btn-extract-book wb-save-btn">保存</button>
                <button class="plot-btn-cancel wb-cancel-btn">取消</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        normalizeWorldBookEditorLayout(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close').addEventListener('click', close);
        overlay.querySelector('.wb-cancel-btn').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        // Delete button
        overlay.querySelector('.wb-delete-btn').addEventListener('click', () => {
            const entryName = entry.comment || entry.key?.[0] || `条目${uid}`;
            if (!confirm(`确定要删除「${entryName}」吗？此操作不可撤销。`)) return;
            delete state.worldBook.entries[uid];
            renderWorldBookList();
            autoSave();
            close();
            setStatus(`已删除: ${entryName}`, 'success');
        });

        // AI summarize button
        overlay.querySelector('#wb-summarize-btn')?.addEventListener('click', async () => {
            const btn = overlay.querySelector('#wb-summarize-btn');
            const content = overlay.querySelector('#wb-edit-content').value.trim();
            if (!content) { alert('请先填写注入内容。'); return; }
            btn.disabled = true; btn.textContent = '生成中...';
            try {
                const summary = await generateSummary(content, 'worldbook');
                const summaryEl = overlay.querySelector('#wb-edit-summary');
                if (summaryEl) summaryEl.value = summary;
            } catch (e) { alert('生成失败: ' + e.message); }
            finally { btn.disabled = false; btn.textContent = 'AI 提取'; }
        });

        // Save button
        // Group manager
        overlay.querySelector('#wb-group-manage-btn')?.addEventListener('click', () => {
            showGroupManager(() => {
                const sel = overlay.querySelector('#wb-edit-folder');
                if (!sel) return;
                const groups = getWorldBookGroups();
                sel.innerHTML = ['', ...groups].map(g => `<option value="${escHtml(g)}" ${getWorldBookFolder(entry) === g ? 'selected' : ''}>${escHtml(g) || '（无文件夹）'}</option>`).join('');
            });
        });

        overlay.querySelector('.wb-save-btn').addEventListener('click', () => {
            const updated = { ...entry };
            updated.comment = overlay.querySelector('#wb-edit-comment').value.trim();
            updated.key = overlay.querySelector('#wb-edit-key').value.split(',').map(s => s.trim()).filter(Boolean);
            updated.keysecondary = overlay.querySelector('#wb-edit-keysecondary').value.split(',').map(s => s.trim()).filter(Boolean);
            updated.content = overlay.querySelector('#wb-edit-content').value;
            updated.order = parseInt(overlay.querySelector('#wb-edit-order').value) || 100;
            updated.depth = parseInt(overlay.querySelector('#wb-edit-depth').value) || 4;
            updated.position = parseInt(overlay.querySelector('#wb-edit-position').value);
            updated.probability = parseInt(overlay.querySelector('#wb-edit-probability').value) || 100;
            const folderSelect = overlay.querySelector('#wb-edit-folder');
            setWorldBookFolder(updated, folderSelect?.value?.trim() || '');
            const sourceGroupInput = overlay.querySelector('#wb-edit-source-group');
            updated.sourceGroup = sourceGroupInput?.value?.trim() || '';
            updated.group = updated.sourceGroup;
            updated.groupWeight = parseInt(overlay.querySelector('#wb-edit-groupWeight')?.value) || 100;
            updated.constant = overlay.querySelector('#wb-edit-constant').checked;
            updated.disable = overlay.querySelector('#wb-edit-disable').checked;
            updated.caseSensitive = overlay.querySelector('#wb-edit-caseSensitive').checked;
            updated.matchWholeWords = overlay.querySelector('#wb-edit-matchWholeWords').checked;
            updated.summary = overlay.querySelector('#wb-edit-summary')?.value?.trim()
                || (updated.content || '').replace(/\s+/g, ' ').trim().substring(0, 150);

            state.worldBook.entries[uid] = updated;
            renderWorldBookList();
            autoSave();  // Persist to disk
            close();
            setStatus(`✅ 已保存: ${updated.comment || updated.key?.[0] || uid}`, 'success');
        });

        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function checkEntryActive(entry) {
        if (!entry?.key?.length) return false;
        const text = $('#chapter-editor').value || '';
        return entry.key.some(kw => {
            try { return new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi').test(text); }
            catch { return text.toLowerCase().includes(kw.toLowerCase()); }
        });
    }

    // ==================== Character Import ====================
    async function importCharacters(files) {
        if (!files?.length) return;

        await ensureNovelExists();

        let successCount = 0;
        let attemptedCount = 0;
        for (const file of files) {
            try {
                if (file.name.endsWith('.png')) {
                    attemptedCount++;
                    const form = new FormData();
                    form.append('file', file);
                    form.append('novelId', state.currentNovel.id);
                    const resp = await fetch('/api/import/character-png', { method: 'POST', body: form });
                    if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);
                    const result = await resp.json();
                    const character = result.character || result.data;
                    character._source = file.name.replace(/\.(png|json)$/i, '');
                    state.characters.push(character);
                    successCount++;
                } else if (file.name.endsWith('.json')) {
                    const text = await readFileAsText(file);
                    const data = JSON.parse(text);
                    const characters = normalizeImportedCharacterFile(data);
                    if (!characters.length) throw new Error('未识别到角色卡数据');
                    attemptedCount += characters.length;
                    for (const item of characters) {
                        const resp = await fetch('/api/import/character-json', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ novelId: state.currentNovel.id, data: item }),
                        });
                        if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);
                        const result = await resp.json();
                        const character = result.character || item;
                        character._source = file.name.replace(/\.json$/i, '');
                        state.characters.push(character);
                        successCount++;
                    }
                }
            } catch (err) {
                setStatus(`导入 ${file.name} 失败: ${err.message}`, 'error');
            }
        }

        renderCharacterList();
        autoSave();
        setStatus(`✅ 成功导入 ${successCount}/${attemptedCount || files.length} 个角色`, 'success');
    }

    function normalizeImportedCharacterFile(data) {
        if (Array.isArray(data)) return data.filter(Boolean);
        if (Array.isArray(data?.characters)) return data.characters.filter(Boolean);
        return data ? [data] : [];
    }

    function renderCharacterList() {
        const list = $('#character-list');
        if (!state.characters.length) {
            list.innerHTML = '<div class="list-placeholder">尚未导入角色<br>点击 "导入" 导入角色卡</div>';
            renderReferenceControls();
            return;
        }

        // Check which characters appear in current text
        const currentText = $('#chapter-editor').value || '';
        const activeNames = new Set();
        for (const ch of state.characters) {
            const name = ch.data?.name || ch.name || '';
            if (name && currentText.includes(name)) activeNames.add(name);
        }

        // Render a single character entry
        function renderChar(ch, i) {
            const name = ch.data?.name || ch.name || `角色${i + 1}`;
            const summary = (ch.data?.summary || (ch.data?.description || ch.description || '').replace(/\\s+/g, ' ').trim().substring(0, 60)).trim();
            const disabled = isCharacterDisabled(ch);
            const isActive = !disabled && activeNames.has(name);
            const charBook = ch.data?.character_book || ch.data?.data?.character_book;
            const innerBookCount = charBook?.entries
                ? Object.keys(charBook.entries).length : 0;
            return `<div class="list-item character-entry ${isActive ? 'active-in-scene' : ''} ${disabled ? 'disabled' : ''}" data-index="${i}">
                <input type="checkbox" class="batch-check" data-id="${i}" aria-label="选择 ${escHtml(name)}">
                <div class="item-title">
                    ${isActive ? '🟢' : '⚪'} ${escHtml(name)}
                    ${innerBookCount > 0 ? `<span class="char-book-badge" title="内嵌 ${innerBookCount} 条世界书">📚${innerBookCount}</span>` : ''}
                </div>
                ${summary ? `<div class="item-subtitle">${escHtml(summary.substring(0, 60))}${summary.length > 60 ? '…' : ''}</div>` : ''}
                ${disabled ? '<div class="item-status disabled">已禁用</div>' : ''}
                ${isActive ? '<div class="item-status enabled">当前场景中</div>' : ''}
            </div>`;
        }

        // Group by _source
        const groups = {};
        const ungrouped = [];
        for (let i = 0; i < state.characters.length; i++) {
            const source = state.characters[i]._source;
            if (source) {
                if (!groups[source]) groups[source] = [];
                groups[source].push(i);
            } else {
                ungrouped.push(i);
            }
        }

        let html = '';
        const sourceNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-CN'));

        for (const source of sourceNames) {
            const indices = groups[source];
            html += `<div class="source-group">`;
            html += `<div class="source-group-header" data-source="${escHtml(source)}">`;
            html += `<span class="source-group-arrow">▶</span>`;
            html += `<span class="source-group-name">📁 ${escHtml(source)}</span>`;
            html += `<span class="source-group-count">${indices.length} 个角色</span>`;
            html += `</div>`;
            html += `<div class="source-group-body">`;
            for (const i of indices) {
                html += renderChar(state.characters[i], i);
            }
            html += `</div></div>`;
        }

        if (ungrouped.length > 0) {
            html += `<div class="source-group">`;
            html += `<div class="source-group-header" data-source="__ungrouped__">`;
            html += `<span class="source-group-arrow">▶</span>`;
            html += `<span class="source-group-name">📁 未分组</span>`;
            html += `<span class="source-group-count">${ungrouped.length} 个角色</span>`;
            html += `</div>`;
            html += `<div class="source-group-body">`;
            for (const i of ungrouped) {
                html += renderChar(state.characters[i], i);
            }
            html += `</div></div>`;
        }

        list.innerHTML = html;

        // Group header click → toggle collapse
        list.querySelectorAll('.source-group-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
                const arrow = header.querySelector('.source-group-arrow');
                const body = header.nextElementSibling;
                if (body) {
                    body.classList.toggle('hidden');
                    if (arrow) arrow.textContent = body.classList.contains('hidden') ? '▶' : '▼';
                }
            });
        });

        // Click → open editor directly
        list.querySelectorAll('.character-entry').forEach(el => {
            el.addEventListener('click', event => {
                if (event.target.closest('.batch-check')) return;
                if (list.closest('.sidebar-panel')?.classList.contains('batch-mode')) {
                    const checkbox = el.querySelector('.batch-check');
                    if (checkbox) checkbox.checked = !checkbox.checked;
                    return;
                }
                const idx = parseInt(el.dataset.index);
                if (!isNaN(idx) && state.characters[idx]) {
                    openCharacterEditor(state.characters[idx], idx);
                }
            });
        });
        // Auto-fill empty character summaries
        let chChanged = false;
        for (const ch of state.characters) {
            const data = ch.data || {};
            if (!data.summary) {
                const raw = [data.description || ch.description || '', data.personality || '', data.scenario || ''].filter(Boolean).join('；');
                if (raw) { data.summary = raw.replace(/\s+/g, ' ').trim().substring(0, 150); chChanged = true; }
            }
        }
        if (chChanged) autoSave();
        renderReferenceControls();
    }

    function toggleBatchMode(type, button) {
        const panel = type === 'worldbook' ? $('#panel-worldbook') : $('#panel-characters');
        if (!panel) return;
        const active = !panel.classList.contains('batch-mode');
        panel.classList.toggle('batch-mode', active);
        button.classList.toggle('active', active);
        button.textContent = active ? '完成' : '批量';

        let actions = panel.querySelector('.batch-actions');
        if (active) {
            // Remove old bar if exists
            if (actions) actions.remove();
            actions = document.createElement('div');
            actions.className = 'batch-actions';
            actions.innerHTML = '<button data-action="select-all" class="batch-btn-secondary">全选</button>' +
                '<button data-action="invert" class="batch-btn-secondary">反选</button>' +
                '<span class="batch-sep">|</span>' +
                '<button data-action="enable">启用</button>' +
                '<button data-action="disable">停用</button>' +
                '<button data-action="delete" class="batch-btn-danger">删除</button>';
            const list = type === 'worldbook' ? $('#worldbook-list') : $('#character-list');
            list?.before(actions);
            actions.addEventListener('click', event => {
                const action = event.target.closest('button')?.dataset.action;
                if (!action) return;
                if (action === 'select-all') {
                    panel.querySelectorAll('.batch-check').forEach(cb => { cb.checked = true; });
                } else if (action === 'invert') {
                    panel.querySelectorAll('.batch-check').forEach(cb => { cb.checked = !cb.checked; });
                } else {
                    applyBatchAction(type, action);
                }
            });
        } else {
            if (actions) actions.remove();
        }
        panel.querySelectorAll('.batch-check').forEach(checkbox => { checkbox.checked = false; });
    }

    function applyBatchAction(type, action) {
        const panel = type === 'worldbook' ? $('#panel-worldbook') : $('#panel-characters');
        const selected = [...panel.querySelectorAll('.batch-check:checked')].map(checkbox => checkbox.dataset.id);
        if (!selected.length) return setStatus('请先选择条目', 'warn');
        if (action === 'delete' && !confirm(`删除选中的 ${selected.length} 项？`)) return;

        if (type === 'worldbook') {
            selected.forEach(uid => {
                const entry = state.worldBook.entries[uid];
                if (!entry) return;
                if (action === 'delete') delete state.worldBook.entries[uid];
                if (action === 'enable') entry.disable = false;
                if (action === 'disable') entry.disable = true;
            });
            renderWorldBookList();
        } else {
            const indexes = selected.map(Number).filter(index => !Number.isNaN(index));
            if (action === 'delete') {
                const indexSet = new Set(indexes);
                state.characters = state.characters.filter((_character, index) => !indexSet.has(index));
            } else {
                indexes.forEach(index => {
                    const character = state.characters[index];
                    if (character) setCharacterDisabled(character, action === 'disable');
                });
            }
            renderCharacterList();
        }
        autoSave();
        setStatus('批量操作已完成', 'success');
    }

    function renderReferenceControls() {
        document.querySelectorAll('[data-reference-kind]').forEach(control => {
            const kind = control.dataset.referenceKind;
            const mode = kind === 'worldbook'
                ? state.writingReference.worldbookMode
                : state.writingReference.characterMode;
            control.querySelectorAll('[data-reference-mode]').forEach(button => {
                button.classList.toggle('active', button.dataset.referenceMode === mode);
            });
        });

        const worldPicks = $('#worldbook-reference-picks');
        if (worldPicks) {
            worldPicks.replaceChildren();
            const groups = [...new Set(Object.values(state.worldBook?.entries || {})
                .map(entry => getWorldBookFolder(entry))
                .filter(Boolean))]
                .sort((a, b) => a.localeCompare(b, 'zh-CN'));
            worldPicks.style.display = state.writingReference.worldbookMode === 'selected' ? '' : 'none';
            if (!groups.length) {
                const empty = document.createElement('em');
                empty.textContent = '还没有分组';
                worldPicks.appendChild(empty);
            } else {
                groups.forEach(group => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = group;
                    button.classList.toggle('active', state.writingReference.selectedWorldbookGroups.includes(group));
                    button.addEventListener('click', () => {
                        const selected = new Set(state.writingReference.selectedWorldbookGroups);
                        if (selected.has(group)) selected.delete(group);
                        else selected.add(group);
                        state.writingReference.selectedWorldbookGroups = [...selected];
                        renderReferenceControls();
                        autoSave();
                    });
                    worldPicks.appendChild(button);
                });
            }
            // 管理分组入口
            const mgmtBtn = document.createElement('button');
            mgmtBtn.type = 'button';
            mgmtBtn.textContent = '管理分组';
            mgmtBtn.style.cssText = 'font-size:11px;margin-left:4px;';
            mgmtBtn.addEventListener('click', () => { showGroupManager(() => { renderReferenceControls(); }); });
            worldPicks.appendChild(mgmtBtn);
        }

        const characterPicks = $('#character-reference-picks');
        if (characterPicks) {
            characterPicks.replaceChildren();
            const names = state.characters
                .filter(character => !isCharacterDisabled(character))
                .map(character => character.data?.name || character.name || '')
                .filter(Boolean);
            characterPicks.style.display = state.writingReference.characterMode === 'selected' ? '' : 'none';
            if (!names.length) {
                const empty = document.createElement('em');
                empty.textContent = '还没有角色';
                characterPicks.appendChild(empty);
            } else {
                names.forEach(name => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = name;
                    button.classList.toggle('active', state.writingReference.selectedCharacters.includes(name));
                    button.addEventListener('click', () => {
                        const selected = new Set(state.writingReference.selectedCharacters);
                        if (selected.has(name)) selected.delete(name);
                        else selected.add(name);
                        state.writingReference.selectedCharacters = [...selected];
                        renderReferenceControls();
                        autoSave();
                    });
                    characterPicks.appendChild(button);
                });
            }
        }
    }

    function showCharacterDetail(ch, _idx) {
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';
        // Extract data (handling both ST v3 format and plain format)
        const data = ch.data || ch;
        const name = data.name || ch.name || '未命名';
        const desc = data.description || '';
        const personality = data.personality || '';
        const scenario = data.scenario || '';
        const firstMes = data.first_mes || '';
        const mesExample = data.mes_example || '';
        const creatorNotes = data.creator_notes || '';
        const systemPrompt = data.system_prompt || '';
        const postHistory = data.post_history_instructions || '';
        const tags = data.tags || [];
        // ST v3 card: character_book can be at data.character_book or data.data.character_book
        const charBook = data.character_book || data.data?.character_book || {};
        // entries can be an object {uid: entry} or an array
        const rawEntries = charBook?.entries || {};
        const bookEntries = Array.isArray(rawEntries)
            ? rawEntries
            : Object.values(rawEntries);
        const isActive = checkCharActive(name);

        const modal = document.createElement('div');
        modal.className = 'plot-modal char-detail-modal';
        modal.innerHTML = `
            <div class="plot-modal-header">
                <h3>${isActive ? '🟢' : '⚪'} ${escHtml(name)}</h3>
                <span class="plot-modal-count">${isActive ? '当前场景中' : '未出场'}</span>
                <button class="plot-modal-close">✕</button>
            </div>
            <div class="plot-modal-body char-detail-body">
                ${tags.length ? `<div class="char-tags">${tags.map(t => `<span class="char-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}

                ${desc ? `<div class="char-field"><h4>📝 描述</h4><p>${escHtml(desc)}</p></div>` : ''}
                ${personality ? `<div class="char-field"><h4>🎭 性格</h4><p>${escHtml(personality)}</p></div>` : ''}
                ${scenario ? `<div class="char-field"><h4>🌍 背景场景</h4><p>${escHtml(scenario)}</p></div>` : ''}
                ${firstMes ? `<div class="char-field"><h4>💬 开场白</h4><p>${escHtml(firstMes)}</p></div>` : ''}
                ${mesExample ? `<div class="char-field"><h4>📋 对话示例</h4><pre>${escHtml(mesExample.substring(0, 500))}</pre></div>` : ''}
                ${creatorNotes ? `<div class="char-field"><h4>📌 创作者备注</h4><p>${escHtml(creatorNotes)}</p></div>` : ''}
                ${systemPrompt ? `<div class="char-field"><h4>🔧 系统提示词</h4><pre>${escHtml(systemPrompt)}</pre></div>` : ''}
                ${postHistory ? `<div class="char-field"><h4>📜 历史后指令</h4><pre>${escHtml(postHistory)}</pre></div>` : ''}

                ${bookEntries.length > 0 ? `
                <div class="char-field">
                    <h4>📚 内嵌世界书 (${bookEntries.length}条)</h4>
                    <div class="char-embedded-book">
                        ${bookEntries.filter(e => !e.disable).map(e => `
                            <div class="embedded-book-entry">
                                <strong>${escHtml(e.comment || e.key?.[0] || `条目${e.uid}`)}</strong>
                                <span>🔑 ${escHtml((e.key || []).join(', '))}</span>
                                <p>${escHtml(e.content?.substring(0, 200) || '')}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>` : ''}
            </div>
            <div class="plot-modal-footer">
                <button class="char-btn-extract-book" title="将内嵌世界书提取到项目中">📤 提取内嵌世界书</button>
                <button class="char-btn-edit-char" title="编辑角色设定">✏️ 编辑</button>
                <button class="plot-btn-cancel char-detail-close">关闭</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close').addEventListener('click', close);
        overlay.querySelector('.char-detail-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        // Edit character button
        const editBtn = overlay.querySelector('.char-btn-edit-char');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                close();
                openCharacterEditor(ch, _idx);
            });
        }

        // Extract embedded world book button
        const extractBtn = overlay.querySelector('.char-btn-extract-book');
        if (extractBtn) {
            if (bookEntries.length > 0) {
                extractBtn.addEventListener('click', () => {
                    if (!state.worldBook) state.worldBook = { entries: {} };
                    if (!state.worldBook.sources) state.worldBook.sources = {};
                    const nextUid = Math.max(0, ...Object.keys(state.worldBook.entries).map(Number)) + 1;
                    const sourceLabel = ch._source || ('内嵌: ' + name);
                    let added = 0;
                    bookEntries.forEach((e, i) => {
                        const newEntry = { ...e, _source: sourceLabel, folder: e.folder || e._folder || sourceLabel, sourceGroup: e.sourceGroup || e.group || '', uid: nextUid + i };
                        state.worldBook.entries[nextUid + i] = newEntry;
                        added++;
                    });
                    state.worldBook.sources[sourceLabel] = {
                        name: sourceLabel,
                        entryCount: (state.worldBook.sources[sourceLabel]?.entryCount || 0) + added,
                        importedAt: Date.now(),
                    };
                    renderWorldBookList();
                    autoSave();
                    close();
                    setStatus(`✅ 已从角色卡提取 ${added} 条世界书条目`, 'success');
                });
            } else {
                extractBtn.style.display = 'none';
            }
        }

        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function checkCharActive(name) {
        if (!name) return false;
        const text = $('#chapter-editor').value || '';
        return text.includes(name);
    }

    // ==================== Preset Import ====================
    async function importPreset(files) {
        if (!files?.[0]) return;
        const file = files[0];

        try {
            const text = await readFileAsText(file);
            const data = JSON.parse(text);
            const importResponse = await fetch('/api/import/preset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    name: file.name.replace('.json', ''),
                    data,
                }),
            });
            if (!importResponse.ok) {
                const error = await importResponse.json().catch(() => ({}));
                throw new Error(error.error || `HTTP ${importResponse.status}`);
            }

            // Store full preset for reference
            state.importedPreset = data;
            state.presetName = file.name.replace('.json', '');

            // === 1. AI provider mapping ===
            if (data.chat_completion_source) {
                const providerMap = { openai: 'openai', claude: 'anthropic', openrouter: 'openrouter', makersuite: 'openai', ollama: 'ollama', deepseek: 'deepseek' };
                state.aiConfig.provider = providerMap[data.chat_completion_source] || state.aiConfig.provider;
            }

            // === 2. Model name ===
            if (data.openai_model) state.aiConfig.model = data.openai_model;
            if (data.claude_model && data.chat_completion_source === 'claude') state.aiConfig.model = data.claude_model;

            // === 3. Generation parameters ===
            if (data.temperature !== undefined) state.aiConfig.temperature = Number(data.temperature);
            if (data.top_p !== undefined) state.aiConfig.topP = Number(data.top_p);
            if (data.top_k !== undefined) state.aiConfig.topK = Number(data.top_k);
            if (data.min_p !== undefined) state.aiConfig.minP = Number(data.min_p);
            if (data.top_a !== undefined) state.aiConfig.topA = Number(data.top_a);
            if (data.repetition_penalty !== undefined) state.aiConfig.repetitionPenalty = Number(data.repetition_penalty);
            if (data.frequency_penalty !== undefined) state.aiConfig.frequencyPenalty = Number(data.frequency_penalty);
            if (data.presence_penalty !== undefined) state.aiConfig.presencePenalty = Number(data.presence_penalty);
            if (data.openai_max_context) state.aiConfig.maxContext = Number(data.openai_max_context);
            if (data.openai_max_tokens) state.aiConfig.maxTokens = Number(data.openai_max_tokens);
            if (data.stream_openai !== undefined) state.aiConfig.stream = data.stream_openai;
            if (data.seed !== undefined && data.seed >= 0) state.aiConfig.seed = data.seed;

            // === 4. Prompt templates (the key part!) ===
            if (Array.isArray(data.prompts)) {
                const isConfigTemplate = (p) => {
                    const n = (p.name || '').toLowerCase();
                    const c = (p.content || '').toLowerCase();
                    return n.includes('spreset') || n.includes('regex') || n.includes('macro')
                        || c.includes('"chatsquash"') || c.includes('"regexbinding"')
                        || c.includes('"toolbindings"') || c.includes('"macronest"')
                        || c.includes('window.spresettempdata') || c.includes('window.sillytavern');
                };
                const isCgjImportMarker = p => /^cgj-import-(worldSetting|characterState|plotHistory|recentPlot)$/.test(String(p.identifier || ''));
                state.promptTemplates = data.prompts
                    .filter(p => (p.content?.trim() || p.marker || isCgjImportMarker(p)) && !isConfigTemplate(p))
                    .map(p => ({
                        identifier: p.identifier || '',
                        name: p.name || p.identifier || '',
                        role: p.role || 'system',
                        content: p.content || '',
                        isSystemPrompt: !!p.system_prompt,
                        isMarker: !!p.marker || isCgjImportMarker(p),
                        markerId: p.markerId || (isCgjImportMarker(p) ? p.identifier : ''),
                        enabled: p.enabled !== false && p.disabled !== true,
                        disabled: p.disabled === true || p.enabled === false,
                    }));
            }

            // === 5. Prompt ordering / enabled state ===
            if (Array.isArray(data.prompt_order)) state.promptOrder = data.prompt_order;
            if (data.prompt_order) state.promptOrder = data.prompt_order;
            state.enabledTemplates = buildPresetEnabledTemplates(data, state.promptTemplates || []);

            // === 6. Special prompts ===
            if (!state.specialPrompts) state.specialPrompts = {};
            if (data.impersonation_prompt) state.specialPrompts.impersonation = data.impersonation_prompt;
            if (data.new_chat_prompt) state.specialPrompts.newChat = data.new_chat_prompt;
            if (data.continue_nudge_prompt) state.specialPrompts.continueNudge = data.continue_nudge_prompt;

            // === 7. Format strings ===
            if (!state.formatStrings) state.formatStrings = {};
            if (data.wi_format) state.formatStrings.worldInfo = data.wi_format;
            if (data.scenario_format) state.formatStrings.scenario = data.scenario_format;
            if (data.personality_format) state.formatStrings.personality = data.personality_format;

            // === 8. Other ===
            if (data.assistant_prefill) state.aiConfig.prefill = data.assistant_prefill;
            applyPresetReferenceSettings(data);

            // === 9. RegexBinding — extract from SPreset模板 content or top-level ===
            const extractRegexFrom = (src) => {
                if (!src?.regexes) return [];
                return src.regexes
                    .filter(r => !r.disabled && !r.promptOnly)
                    .map(r => ({ find: r.findRegex, replace: r.replaceString, name: r.scriptName || '' }));
            };
            // Try top-level first
            let regexRules = extractRegexFrom(data.RegexBinding);
            // Also scan prompt templates for SPreset配置 with embedded JSON
            if (!regexRules.length && Array.isArray(data.prompts)) {
                const spConfig = data.prompts.find(p => {
                    const n = (p.name || '').toLowerCase();
                    return n.includes('spreset') && (p.content || '').includes('RegexBinding');
                });
                if (spConfig) {
                    try {
                        const embedded = JSON.parse(spConfig.content);
                        regexRules = extractRegexFrom(embedded.RegexBinding);
                    } catch { /* not valid JSON */ }
                }
            }
            if (regexRules.length) {
                state.regexBindings = regexRules;
                updateRegexDisplay();
            }

            applyConfigToUI();
            saveConfig();
            $('#file-input-preset').value = '';

            // Remember as active preset
            const presetName = file.name.replace('.json', '');
            state.presetName = presetName;
            updatePresetNameDisplay(presetName);

            state.presets[presetName] = {
                name: presetName,
                provider: state.aiConfig.provider,
                model: state.aiConfig.model,
                temperature: state.aiConfig.temperature,
                maxTokens: state.aiConfig.maxTokens,
                topP: state.aiConfig.topP,
                topK: state.aiConfig.topK,
                memoryBudget: state.aiConfig.memoryBudget,
                maxContext: state.aiConfig.maxContext,
                frequencyPenalty: state.aiConfig.frequencyPenalty,
                presencePenalty: state.aiConfig.presencePenalty,
                stream: state.aiConfig.stream,
                prefill: state.aiConfig.prefill,
                referenceMode: state.aiConfig.referenceMode,
                compactReference: state.aiConfig.compactReference,
                referenceTools: state.aiConfig.referenceTools,
                enableReferenceTools: state.aiConfig.enableReferenceTools,
                savedAt: Date.now(),
                templates: state.promptTemplates || [],
                promptOrder: state.promptOrder || [],
                enabledTemplates: state.enabledTemplates || {},
            };
            updatePresetSelect();
            autoSave();

            // Summary
            const promptCount = state.promptTemplates?.length || 0;
            setStatus(`✅ 已导入并保存预设: ${presetName}`, 'success');

            // Show prompt templates in a dialog
            // Render template toggles in AI panel
            renderPromptTemplates();

            // Show prompt details dialog
            if (promptCount > 0) showPresetPrompts(file.name, state.promptTemplates);
        } catch (err) {
            setStatus(`预设导入失败: ${err.message}`, 'error');
            $('#file-input-preset').value = '';
        }
    }

    function buildPresetEnabledTemplates(presetData = {}, templates = []) {
        const enabled = {};
        const byIdentifier = new Map((templates || []).map(template => [template.identifier, template]));

        for (const template of templates || []) {
            enabled[template.identifier] = template.enabled !== false && template.disabled !== true;
        }

        const visit = (item) => {
            if (!item) return;
            if (Array.isArray(item)) {
                item.forEach(visit);
                return;
            }
            if (Array.isArray(item.order)) {
                item.order.forEach(visit);
                return;
            }
            const identifier = item.identifier || item.id || item.name;
            if (!identifier || !byIdentifier.has(String(identifier))) return;
            if (item.enabled === false || item.disabled === true) {
                enabled[String(identifier)] = false;
            } else if (item.enabled === true || item.disabled === false) {
                enabled[String(identifier)] = true;
            }
        };

        visit(presetData.prompt_order);
        return enabled;
    }

    function renderPromptTemplates() {
        const section = document.getElementById('prompt-templates-section');
        const list = document.getElementById('prompt-templates-list');
        const countEl = document.getElementById('prompt-template-count');
        const templates = state.promptTemplates;

        if (!section || !list) return;

        if (!templates?.length) {
            section.style.display = '';
            if (countEl) countEl.textContent = '(0)';
            list.innerHTML = '<div class="list-placeholder">暂无 Prompt 模板</div>';
            return;
        }

        section.style.display = '';
        if (countEl) countEl.textContent = `(${templates.length}个)`;

        // Init enabled state if not set
        if (!state.enabledTemplates) {
            state.enabledTemplates = {};
            templates.forEach(t => { state.enabledTemplates[t.identifier] = true; });
        }

        list.innerHTML = templates.map(t => {
            const enabled = state.enabledTemplates[t.identifier] !== false;
            const searchText = `${t.name || ''} ${t.content || ''} ${t.role || ''}`.toLowerCase();
            return `<div class="prompt-template-toggle-item ${enabled ? '' : 'disabled'}" data-search-text="${escHtml(searchText)}" data-id="${escHtml(t.identifier)}">
                <label class="prompt-toggle-label">
                    <input type="checkbox" class="prompt-toggle-check" data-id="${escHtml(t.identifier)}" ${enabled ? 'checked' : ''}>
                    <span class="prompt-toggle-name">${escHtml(t.name)}</span>
                    ${t.isMarker ? '<span class="prompt-toggle-badge marker">m</span>' : ''}
                </label>
                ${t.content ? `<div class="prompt-toggle-preview">${escHtml(t.content.substring(0, 80))}${t.content.length > 80 ? '…' : ''}</div>` : '<div class="prompt-toggle-preview" style="color:var(--text-muted);font-style:italic">占位标记</div>'}
                <button class="prompt-delete-btn" data-id="${escHtml(t.identifier)}" title="删除模板">×</button>
            </div>`;
        }).join('');

        // Bind toggle events
        list.querySelectorAll('.prompt-toggle-check').forEach(cb => {
            cb.addEventListener('change', () => {
                state.enabledTemplates[cb.dataset.id] = cb.checked;
                autoSave();
                const item = cb.closest('.prompt-template-toggle-item');
                if (item) item.classList.toggle('disabled', !cb.checked);
            });
        });

        // Delete button (visible on hover)
        list.querySelectorAll('.prompt-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const tmpl = state.promptTemplates.find(t => t.identifier === id);
                if (!tmpl) return;
                if (!confirm('确认删除模板 "' + tmpl.name + '"？')) return;
                state.promptTemplates = state.promptTemplates.filter(t => t.identifier !== id);
                delete state.enabledTemplates[id];
                renderPromptTemplates();
                autoSave();
                showToast('已删除: ' + tmpl.name, 'success');
            });
        });

        // Double-click opens editor
        list.querySelectorAll('.prompt-template-toggle-item').forEach(item => {
            item.addEventListener('dblclick', () => {
                const id = item.dataset.id;
                if (id) openPromptEditor(id);
            });
        });
        filterPromptTemplates();
    }

    // eslint-disable-next-line no-unused-vars
    function showPromptTemplateDetail(template) {
        if (template?.identifier) openPromptEditor(template.identifier);
    }

    function showPresetPrompts(filename, templates) {
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';
        const items = templates.map(t => `
            <div class="preset-prompt-item">
                <div class="preset-prompt-header">
                    <span class="preset-prompt-name">${escHtml(t.name)}</span>
                    <span class="preset-prompt-badge">${escHtml(t.role)}</span>
                    ${t.isSystemPrompt ? '<span class="preset-prompt-badge sys">system</span>' : ''}
                    ${t.isMarker ? '<span class="preset-prompt-badge marker">marker</span>' : ''}
                </div>
                ${t.content ? `<div class="preset-prompt-content">${escHtml(t.content.substring(0, 350))}${t.content.length > 350 ? '…' : ''}</div>` : '<div class="preset-prompt-content" style="color:var(--text-muted);font-style:italic">(占位标记，运行时自动替换)</div>'}
            </div>
        `).join('');

        const modal = document.createElement('div');
        modal.className = 'plot-modal';
        modal.innerHTML = `
            <div class="plot-modal-header">
                <h3>📋 预设 Prompt 模板: ${escHtml(filename)}</h3>
                <span class="plot-modal-count">${templates.length} 个模板</span>
                <button class="plot-modal-close">✕</button>
            </div>
            <div class="plot-modal-body" style="display:block;max-height:55vh;overflow-y:auto;padding:16px;">
                <p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;">
                    这些 Prompt 模板来自 SillyTavern 预设，定义了 AI 的写作行为。
                    在 <strong>AI 设置</strong> 中可以查看和修改。
                </p>
                ${items}
            </div>
            <div class="plot-modal-footer">
                <button class="plot-btn-cancel preset-info-close">关闭</button>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close').addEventListener('click', close);
        overlay.querySelector('.preset-info-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    // ==================== Outline ====================
    async function onAddOutlineNode() {
        const title = prompt('大纲节点名称:');
        if (!title) return;

        try {
            const resp = await fetch('/api/outline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ novelId: state.currentNovel.id, title, description: '', type: 'plot' }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
            const node = data;
            state.outline.push(node);
            renderOutlineTree();
            setStatus(`大纲节点已添加: ${title}`, 'success');
        } catch (err) {
            setStatus(`添加大纲失败: ${err.message}`, 'error');
        }
    }

    function renderOutlineTree() {
        const tree = $('#outline-tree');
        if (!state.outline.length) {
            tree.innerHTML = '<div class="tree-placeholder">尚未创建大纲<br>点击 "+ 新节点" 规划情节</div>';
            return;
        }

        tree.innerHTML = state.outline.map(n => `
            <div class="tree-item outline-node" data-id="${n.id}">
                <span class="outline-check">${n.completed ? '✅' : '☐'}</span>
                <span class="outline-title">${escHtml(n.title)}</span>
                ${n.description ? `<span class="outline-desc"> — ${escHtml(n.description)}</span>` : ''}
            </div>
        `).join('');

        tree.querySelectorAll('.outline-node').forEach(node => {
            node.addEventListener('click', () => toggleOutlineNode(node.dataset.id));
        });
    }

    async function toggleOutlineNode(id) {
        const node = state.outline.find(n => n.id === id);
        if (!node) return;
        const previous = node.completed;
        node.completed = !previous;
        renderOutlineTree();
        try {
            const response = await fetch(`/api/outline/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ novelId: state.currentNovel.id, completed: node.completed }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        } catch (error) {
            node.completed = previous;
            renderOutlineTree();
            setStatus(`更新大纲失败: ${error.message}`, 'error');
        }
    }

    function getIncompleteOutline() {
        return state.outline.filter(n => !n.completed);
    }

    function getReferencedWorldBook() {
        const mode = state.writingReference?.worldbookMode || 'all';
        if (mode === 'off') return { ...state.worldBook, entries: {} };
        if (mode !== 'selected') return state.worldBook;
        const groups = new Set(state.writingReference.selectedWorldbookGroups || []);
        return {
            ...state.worldBook,
            entries: Object.fromEntries(Object.entries(state.worldBook?.entries || {})
                .filter(([, entry]) => groups.has(getWorldBookFolder(entry)))),
        };
    }

    function getReferencedCharacters(text = '') {
        const mode = state.writingReference?.characterMode || 'auto';
        if (mode === 'off') return [];
        const selected = new Set(state.writingReference.selectedCharacters || []);
        return state.characters.filter(character => {
            if (isCharacterDisabled(character)) return false;
            const name = character.data?.name || character.name || '';
            if (!name) return false;
            if (mode === 'selected') return selected.has(name);
            return text.includes(name);
        });
    }

    function isCharacterDisabled(character = {}) {
        const data = character.data || character;
        return character.disable === true
            || character.disabled === true
            || character.enabled === false
            || data.disable === true
            || data.disabled === true
            || data.enabled === false
            || data.extensions?.cuigengji?.disabled === true
            || data.extensions?.novel_ai_editor?.disabled === true;
    }

    function setCharacterDisabled(character = {}, disabled = false) {
        character.disable = Boolean(disabled);
        character.disabled = Boolean(disabled);
        character.enabled = !disabled;
        if (character.data && typeof character.data === 'object') {
            character.data.disable = Boolean(disabled);
            character.data.disabled = Boolean(disabled);
            character.data.enabled = !disabled;
        }
    }

    // ==================== Config Handlers ====================
    function onProviderChange() {
        state.aiConfig.provider = $('#ai-provider').value;
        localStorage.setItem('novel-ai-provider-chosen', state.aiConfig.provider);
        state.hasSavedApiKey = false;
        state.isConnected = false;
        resetApiKeyField();
        updateProviderUI({ providerChanged: true });
        state.aiConfig.endpoint = $('#ai-endpoint').value.trim();
        state.aiConfig.model = $('#ai-model').value.trim();
        saveConfig();
        loadAiSecretStatus();
        updateStatusBar();
    }

    function updateProviderUI({ providerChanged = false } = {}) {
        const provider = state.aiConfig.provider;
        const isOllama = provider === 'ollama';
        $('#ai-api-key-field').style.display = isOllama ? 'none' : '';

        // Provider-specific fields
        const isVertex = provider === 'google-vertex';
        const vertexFields = $('#ai-vertex-fields');
        if (vertexFields) vertexFields.style.display = isVertex ? '' : 'none';

        const needsCompat = /^siliconflow|minimax|zai$/.test(provider);
        const compatFields = $('#ai-compatible-extra-fields');
        if (compatFields) compatFields.style.display = needsCompat ? '' : 'none';

        if (needsCompat) {
            const sf = $('#ai-siliconflow-endpoint-field');
            if (sf) sf.style.display = provider === 'siliconflow' ? '' : 'none';
            const mm = $('#ai-minimax-endpoint-field');
            if (mm) mm.style.display = provider === 'minimax' ? '' : 'none';
            const za = $('#ai-zai-endpoint-field');
            if (za) za.style.display = provider === 'zai' ? '' : 'none';
        }

        if (isVertex) {
            const authMode = $('#ai-vertex-auth-mode')?.value || state.aiConfig.vertexAuthMode || 'express';
            const saField = $('#ai-vertex-service-account-field');
            if (saField) saField.style.display = authMode === 'full' ? '' : 'none';
        }

        // Auto-fill default model for each provider
        const defaultModels = {
            anthropic: 'claude-sonnet-4-6',
            openai: 'gpt-4o',
            deepseek: 'deepseek-v4-flash',
            openrouter: 'anthropic/claude-sonnet-4-6',
            ollama: 'llama3',
        };
        const currentModel = $('#ai-model').value;
        if (providerChanged || !currentModel || Object.values(defaultModels).includes(currentModel)) {
            $('#ai-model').value = defaultModels[provider] || '';
        }

        // Auto-fill default endpoint for each provider
        const defaultEndpoints = {
            anthropic: 'https://api.anthropic.com',
            openai: 'https://api.openai.com/v1',
            google: 'https://generativelanguage.googleapis.com/v1beta',
            mistral: 'https://api.mistral.ai/v1',
            xai: 'https://api.x.ai/v1',
            groq: 'https://api.groq.com/openai/v1',
            deepseek: 'https://api.deepseek.com/v1',
            qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            doubao: 'https://ark.cn-beijing.volces.com/api/v3',
            spark: 'https://spark-api-open.xf-yun.com/v1',
            zai: 'https://api.z.ai/api/paas/v4',
            moonshot: 'https://api.moonshot.cn/v1',
            siliconflow: 'https://api.siliconflow.cn/v1',
            minimax: 'https://api.minimax.io/v1',
            openrouter: 'https://openrouter.ai/api/v1',
            ollama: 'http://localhost:11434',
        };
        const endpointInput = $('#ai-endpoint');
        if (endpointInput && (providerChanged || !endpointInput.value.trim())) {
            endpointInput.value = defaultEndpoints[provider] || '';
        }

    }

    function setApiKeyVisibility(revealed) {
        const input = $('#ai-api-key');
        const button = $('#btn-toggle-api-key');
        input.type = revealed ? 'text' : 'password';
        button.classList.toggle('revealed', revealed);
        button.setAttribute('aria-pressed', String(revealed));
        button.setAttribute('aria-label', revealed ? '隐藏 API Key' : '显示 API Key');
        button.title = revealed ? '隐藏 API Key' : '显示 API Key';
    }

    function resetApiKeyField() {
        $('#ai-api-key').value = '';
        $('#ai-api-key').placeholder = '粘贴后自动保存到本机';
        setApiKeyVisibility(false);
    }

    async function onToggleApiKey() {
        const input = $('#ai-api-key');
        if (input.type === 'text') {
            setApiKeyVisibility(false);
            return;
        }
        if (!input.value && state.hasSavedApiKey) {
            try {
                const response = await fetch('/api/ai-secrets/reveal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: state.aiConfig.provider,
                        profile: state.presetName || '__default__',
                    }),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
                input.value = data.apiKey || '';
            } catch (err) {
                setStatus(`API Key 读取失败: ${err.message}`, 'error');
                return;
            }
        }
        setApiKeyVisibility(true);
    }

    function onConfigChange() {
        const apiKey = $('#ai-api-key').value.trim();
        state.aiConfig.apiKey = apiKey;
        state.aiConfig.endpoint = $('#ai-endpoint').value;
        state.aiConfig.model = $('#ai-model').value;
        state.aiConfig.temperature = parseFloat($('#ai-temperature').value);
        state.aiConfig.maxTokensPct = parseInt($('#ai-max-tokens').value) || 5;
        state.aiConfig.maxTokens = Math.round(getModelContextLimit() * state.aiConfig.maxTokensPct / 100);
        state.aiConfig.topP = parseFloat($('#ai-top-p').value);
        saveConfig();
        if (apiKey) saveAiSecret(apiKey).catch(err => setStatus(`API Key 保存失败: ${err.message}`, 'error'));
    }

    async function saveAiSecret(apiKey) {
        const response = await fetch('/api/ai-secrets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: state.aiConfig.provider,
                apiKey,
                profile: state.presetName || '__default__',
            }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        state.hasSavedApiKey = true;
        $('#ai-api-key').placeholder = 'API Key 已安全保存到本机';
        updateStatusBar();
    }

    async function loadAiSecretStatus(preferDeepseek = false) {
        const profile = state.presetName || '__default__';

        // Try the current provider first, then fall back to last-connected provider
        const providersToTry = [];
        const currentProvider = state.aiConfig.provider;
        const lastConnected = localStorage.getItem('novel-ai-connected-provider');
        if (currentProvider) providersToTry.push(currentProvider);
        if (lastConnected && lastConnected !== currentProvider) providersToTry.push(lastConnected);
        if (preferDeepseek && !providersToTry.includes('deepseek')) providersToTry.push('deepseek');

        state.hasSavedApiKey = false;
        state.isConnected = false;

        for (const provider of providersToTry) {
            try {
                const response = await fetch(`/api/ai-secrets/status?provider=${encodeURIComponent(provider)}&profile=${encodeURIComponent(profile)}`);
                const data = await response.json();
                if (data.hasKey) {
                    // Found a saved key for this provider
                    state.hasSavedApiKey = true;
                    state.isConnected = localStorage.getItem('novel-ai-connected-provider') === provider;
                    // Restore this provider as the active one if different from current
                    if (provider !== state.aiConfig.provider) {
                        state.aiConfig.provider = provider;
                        const saved = JSON.parse(localStorage.getItem(LAST_SUCCESSFUL_AI_CONFIG_KEY) || '{}');
                        if (saved.provider === provider && saved.model) {
                            state.aiConfig.model = saved.model;
                            state.aiConfig.endpoint = saved.endpoint || '';
                        }
                        applyConfigToUI();
                    }
                    $('#ai-api-key').placeholder = 'API Key 已安全保存到本机';
                    localStorage.setItem('novel-ai-provider-chosen', provider);
                    break;  // Use the first provider that has a key
                }
            } catch (err) {
                console.warn('[loadAiSecretStatus] Failed to check provider', provider, err.message);
            }
        }

        updateStatusBar();
    }

    function updateRangeLabels() {
        const temp = $('#ai-temperature');
        const tokens = $('#ai-max-tokens');
        const topP = $('#ai-top-p');
        if (temp) {
            const label = temp.closest('.ai-section')?.querySelector('#temp-value');
            if (label) label.textContent = temp.value;
        }
        if (tokens) {
            const label = tokens.closest('.ai-section')?.querySelector('#max-tokens-value');
            const pct = parseInt(tokens.value) || 5;
            const ctx = getModelContextLimit();
            const abs = Math.round(ctx * pct / 100);
            if (label) label.textContent = pct + '%（约 ' + formatTokenLimit(abs) + ' tokens）';
        }
        if (topP) {
            const label = topP.closest('.ai-section')?.querySelector('#top-p-value');
            if (label) label.textContent = topP.value;
        }
    }

    function getModelContextLimit() {
        const configured = Number(state.aiConfig.maxContext || 0);
        if (configured > 0) return configured;
        const model = String(state.aiConfig.model || '').toLowerCase();
        if (model.includes('deepseek')) return 1000000;
        if (model.includes('gemini') || model.includes('qwen') || model.includes('minimax')) return 1000000;
        if (model.includes('claude')) return 200000;
        return 128000;
    }

    function formatTokenLimit(value) {
        if (value >= 1000000) {
            const millions = value / 1000000;
            return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
        }
        if (value >= 1000) return `${Math.round(value / 1000)}K`;
        return String(value);
    }

    function getReferenceInjectionMode() {
        const config = state.aiConfig || {};
        const mode = String(config.referenceMode || '').toLowerCase();
        if (mode === 'tool' || mode === 'tools' || mode === 'compact' || mode === 'reference_tools' || mode === 'novel_tools') {
            return 'tool';
        }
        if (config.compactReference === true || config.referenceTools === true || config.enableReferenceTools === true) {
            return 'tool';
        }
        return 'sillytavern';
    }

    function setReferenceInjectionMode(mode, options = {}) {
        const selectedMode = mode === 'tool' ? 'tool' : 'sillytavern';
        if (selectedMode === 'tool') {
            state.aiConfig.referenceMode = 'tool';
            state.aiConfig.compactReference = true;
            state.aiConfig.referenceTools = true;
            state.aiConfig.enableReferenceTools = true;
        } else {
            state.aiConfig.referenceMode = 'sillytavern';
            state.aiConfig.compactReference = false;
            state.aiConfig.referenceTools = false;
            state.aiConfig.enableReferenceTools = false;
        }
        updateReferenceInjectionModeUI();
        if (options.save !== false) {
            saveConfig();
            setStatus(
                selectedMode === 'tool'
                    ? '已切换为智能摘要：世界书/角色卡将优先摘要注入，按需调用工具'
                    : '已切换为完整注入：世界书/角色卡将按完整内容注入',
                'success',
            );
        }
    }

    function applyPresetReferenceSettings(preset = {}) {
        const hasReferenceMode = [
            'referenceMode',
            'compactReference',
            'referenceTools',
            'enableReferenceTools',
        ].some(key => preset[key] !== undefined);

        if (!hasReferenceMode) {
            setReferenceInjectionMode('sillytavern', { save: false });
            return;
        }

        if (preset.referenceMode !== undefined) state.aiConfig.referenceMode = preset.referenceMode;
        if (preset.compactReference !== undefined) state.aiConfig.compactReference = preset.compactReference;
        if (preset.referenceTools !== undefined) state.aiConfig.referenceTools = preset.referenceTools;
        if (preset.enableReferenceTools !== undefined) state.aiConfig.enableReferenceTools = preset.enableReferenceTools;
        updateReferenceInjectionModeUI();
    }

    function updateReferenceInjectionModeUI() {
        const mode = getReferenceInjectionMode();
        document.querySelectorAll('input[name="reference-injection-mode"]').forEach(input => {
            input.checked = input.value === mode;
            input.closest('.reference-mode-option')?.classList.toggle('active', input.checked);
        });
        const summary = $('#reference-mode-summary');
        if (summary) {
            summary.textContent = mode === 'tool'
                ? '智能摘要：摘要 + 工具查询'
                : '完整注入：全文注入';
        }
    }

    function updateContextInfo(ctx, memory, contextDebug) {
        // Update context circle
        const usagePct = contextDebug?.compression?.usagePct;
        if (typeof usagePct === 'number') {
            const pct = Math.min(1, Math.max(0, usagePct));
            const arc = document.getElementById('ctx-arc');
            const text = $('#ctx-text');
            if (arc) arc.setAttribute('stroke-dashoffset', 44 * (1 - pct));
            if (text) text.textContent = Math.round(pct * 100);
            // green→yellow→red
            const color = pct < 0.5 ? 'var(--success)' : pct < 0.8 ? 'var(--warning)' : 'var(--danger)';
            if (arc) arc.setAttribute('stroke', color);
        }

        // Update token usage
        if (ctx) {
            const usage = $('#context-usage');
            if (usage) usage.textContent = `${ctx.used || 0} / ${ctx.totalBudget || 0}`;
        }

        // Update memory stats
        if (memory?.stats) {
            const s = memory.stats;
            const worldBookCount = $('#active-wb-count');
            const characterCount = $('#active-char-count');
            const memoryTokens = $('#memory-tokens');
            if (worldBookCount) worldBookCount.textContent = s.byType?.world_entry || 0;
            if (characterCount) characterCount.textContent = s.byType?.character || 0;
            if (memoryTokens) memoryTokens.textContent = `${s.totalTokens || 0} / ${s.budget || 3000}`;
        }

        // Show active entries list
        if (memory?.activeEntries) {
            const list = $('#active-wb-entries');
            if (list && memory.activeEntries.length > 0) {
                list.innerHTML = memory.activeEntries.map(e =>
                    `<div class="active-entry-item">
                        <span class="entry-type-badge ${e.type}">${e.type}</span>
                        <span class="entry-label">${escHtml(e.label.substring(0, 40))}</span>
                    </div>`
                ).join('');
            } else if (list) {
                list.innerHTML = '<div style="font-size:10px;color:var(--text-muted);padding:4px;">当前无激活的记忆条目</div>';
            }
        }

        // Show extraction results
        if (memory?.extractions) {
            showMemoryExtractionResults(memory.extractions);
        }
    }

    function showMemoryExtractionResults(extractions) {
        const section = document.getElementById('extraction-section');
        const results = document.getElementById('extraction-results');
        if (!section || !results) return;

        const items = [];

        if (extractions.suggestions?.length > 0) {
            extractions.suggestions.forEach(s => {
                items.push({ icon: '💡', text: s.message, type: s.type });
            });
        }
        if (extractions.newCharacters?.length > 0) {
            extractions.newCharacters.forEach(c => {
                items.push({ icon: '👤', text: `新角色候选: ${c.name}`, type: 'character' });
            });
        }
        if (extractions.newWorldElements?.length > 0) {
            extractions.newWorldElements.forEach(e => {
                items.push({ icon: '🌍', text: `新世界观元素: ${e.element || e}`, type: 'world' });
            });
        }

        if (items.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        results.innerHTML = items.map(item => `
            <div class="extraction-item">
                <span>${item.icon}</span>
                <span style="font-size:11px;">${escHtml(item.text)}</span>
                <button class="extraction-add-btn" data-text="${escHtml(item.text)}">＋</button>
            </div>
        `).join('');

        // Auto-hide after 15 seconds
        clearTimeout(section._hideTimer);
        section._hideTimer = setTimeout(() => { section.style.display = 'none'; }, 15000);
    }

    // ==================== Editor ====================
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
        const chatInput = $('#chat-input');
        if (chatInput) chatInput.disabled = !workspaceReady;
        const sendButton = $('#btn-send');
        if (sendButton) sendButton.disabled = !workspaceReady;
    }

    function clearChapterEditor() {
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

    function updateWordCount() {
        const text = $('#chapter-editor').value;
        const chinese = (text.match(/[一-鿿]/g) || []).length;
        const other = (text.match(/[a-zA-Z0-9]+/g) || []).length;
        const total = chinese + other;
        $('#word-count').textContent = `字数: ${total}`;
        $('#status-words').textContent = `字数: ${total}`;
    }

    // ==================== Import Menu ====================
    function toggleImportMenu() {
        const menu = $('#import-menu');
        menu.classList.toggle('hidden');
        if (!menu.classList.contains('hidden')) {
            const btn = $('#btn-import');
            const rect = btn.getBoundingClientRect();
            // Position below button, prevent right-edge overflow
            const menuWidth = menu.offsetWidth || 320;
            const left = Math.min(rect.left, window.innerWidth - menuWidth - 12);
            menu.style.top = `${rect.bottom + 4}px`;
            menu.style.left = `${Math.max(8, left)}px`;
        }
    }

    function handleImportAction(action) {
        if (action === 'import-folder') {
            $('#file-input-folder')?.click();
            return;
        }
        switch (action) {
            case 'import-document':
            case 'import-split':
                $('#file-input-document').click();
                break;
            case 'import-worldbook': $('#file-input-worldbook').click(); break;
            case 'import-character': $('#file-input-character').click(); break;
            case 'import-preset': $('#file-input-preset').click(); break;
            case 'import-folder': setStatus('批量导入开发中...', 'info'); break;
        }
    }

    // ==================== Sidebar Tabs ====================
    function switchTab(tab) {
        const sidebar = tab.closest('.sidebar');
        const panelName = tab.dataset.panel;
        sidebar.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        sidebar.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
        const panel = sidebar.querySelector(`#panel-${panelName}`);
        if (panel) panel.classList.add('active');
        try { localStorage.setItem('cgj-right-sidebar-tab', panelName); } catch {}
    }

    function restoreSidebarTab() {
        let panelName = '';
        try { panelName = localStorage.getItem('cgj-right-sidebar-tab') || ''; } catch {}
        if (!panelName) return;
        const tab = document.querySelector(`#right-sidebar .sidebar-tab[data-panel="${CSS.escape(panelName)}"]`);
        if (tab) switchTab(tab);
    }

    // ==================== Toolbar Actions ====================
    async function onNewNovel() {
        if (state.isDirty && !confirm('未保存的更改将丢失，确认新建？')) return;
        await createWorkspaceFromWelcome();
    }

    // ==================== Keyboard ====================
    function onKeyboard(e) {
        if ((e.ctrlKey || e.metaKey)) {
            switch (e.key.toLowerCase()) {
                case 's': e.preventDefault(); onSave(); break;
                case 'n': e.preventDefault(); onNewNovel(); break;
            }
        }
    }

    // ==================== Status ====================
    function showToast(msg, type = 'info', duration = 6000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const el = document.createElement('div');
        el.className = 'toast-item toast-' + type;
        el.textContent = msg;
        container.appendChild(el);
        if (duration > 0) {
            setTimeout(() => { if (el.parentNode) el.remove(); }, duration + 600);
        }
    }

    function setStatus(msg, type = 'info') {
        const el = $('#status-message');
        if (!el) return;
        el.textContent = msg;
        el.className = `status-${type}`;
        if (type !== 'loading') {
            clearTimeout(el._timeout);
            el._timeout = setTimeout(() => {
                el.textContent = '就绪';
                el.className = '';
            }, 6000);
        }
    }

    function updateStatusBar() {
        $('#status-connection').textContent = state.isConnected ? '🟢 已连接' : '🔌 未连接';
        $('#status-model').textContent = state.isConnected ? state.aiConfig.model : '—';
        $('#status-save').textContent = state.isDirty ? '未保存' : '已保存';
        // Connection badge color
        const badge = $('#ai-connection-badge');
        if (badge) {
            badge.textContent = state.isConnected ? '已连接' : state.hasSavedApiKey ? '已配置' : '未连接';
            badge.classList.remove('badge-ok', 'badge-ready', 'badge-off');
            badge.classList.add(state.isConnected ? 'badge-ok' : state.hasSavedApiKey ? 'badge-ready' : 'badge-off');
        }
        // Connection summary
        const summary = $('#ai-connection-summary');
        if (summary) {
            summary.textContent = state.isConnected
                ? `${state.aiConfig.provider} · ${state.aiConfig.model}`
                : state.hasSavedApiKey ? '密钥已保存，点击连接模型' : '配置模型服务';
        }
        const keyStatus = $('#ai-api-key-status');
        if (keyStatus) {
            const isOllama = state.aiConfig.provider === 'ollama';
            keyStatus.textContent = isOllama
                ? '本地服务无需 API Key'
                : state.isConnected ? 'API Key 已验证可用'
                    : state.hasSavedApiKey ? 'API Key 已保存，尚未验证连接' : '未配置 API Key';
            keyStatus.className = `ai-key-status${state.isConnected ? ' verified' : state.hasSavedApiKey ? ' saved' : ''}`;
        }
        const providerLabel = $('#ai-provider option:checked')?.textContent?.trim()
            || state.aiConfig.provider
            || '未选择服务商';
        const quickStatus = $('#ai-quick-status');
        const quickModel = $('#ai-quick-model');
        const quickDetail = $('#ai-quick-detail');
        if (quickStatus) {
            quickStatus.textContent = state.isConnected ? '已连接' : state.hasSavedApiKey ? '已配置' : '未连接';
            quickStatus.className = state.isConnected ? 'is-connected' : state.hasSavedApiKey ? 'is-ready' : '';
        }
        if (quickModel) quickModel.textContent = providerLabel;
        if (quickDetail) {
            quickDetail.textContent = state.aiConfig.model
                ? state.aiConfig.model
                : '尚未选择可用模型';
        }
        const section = $('#ai-connection-section');
        if (section) {
            section.classList.toggle('connected', state.isConnected);
            section.open = true;
        }
        const onboardingComplete = Boolean(state.aiConfig.provider)
            && (state.hasSavedApiKey || state.aiConfig.provider === 'ollama')
            && state.aiUsed;
        if (onboardingComplete) {
            try { localStorage.setItem('cgj-ai-onboarding-complete', '1'); } catch {}
        }
        const onboarding = document.getElementById('ai-onboarding');
        const onboardingDone = onboardingComplete || localStorage.getItem('cgj-ai-onboarding-complete') === '1';
        if (onboarding) onboarding.style.display = onboardingDone ? 'none' : '';
        // Onboarding steps
        $('#onboard-step-1')?.classList.toggle('done', Boolean(state.aiConfig.provider));
        $('#onboard-step-2')?.classList.toggle('done', state.hasSavedApiKey || state.aiConfig.provider === 'ollama');
        $('#onboard-step-3')?.classList.toggle('done', state.aiUsed);
    }

    // ==================== Regex Editor ====================
    let _regexEditorCurrent = null;
    let _regexEditorCloseTimer = 0;

    function bindRegexEditor() {
        const overlay = document.getElementById('regex-editor-overlay');
        if (!overlay) return;
        const close = () => { overlay.classList.remove('active'); _regexEditorCloseTimer = setTimeout(() => { overlay.style.display = 'none'; }, 200); };
        document.getElementById('btn-regex-editor-close')?.addEventListener('click', close);
        document.getElementById('btn-regex-editor-done')?.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.getElementById('btn-regex-editor-add')?.addEventListener('click', addRegexRule);
        document.getElementById('btn-regex-editor-save')?.addEventListener('click', saveRegexRule);
        document.getElementById('btn-regex-editor-delete')?.addEventListener('click', deleteRegexRule);
        document.getElementById('btn-edit-regex')?.addEventListener('click', openRegexEditor);

        // Resizer
        const resizer = document.getElementById('regex-editor-resizer');
        const nav = document.getElementById('regex-editor-nav');
        if (resizer && nav) {
            let sx, sw;
            resizer.addEventListener('mousedown', e => { e.preventDefault(); sx = e.clientX; sw = nav.offsetWidth; resizer.classList.add('active'); });
            document.addEventListener('mousemove', e => { if (!resizer.classList.contains('active')) return; nav.style.width = Math.max(140, Math.min(400, sw + e.clientX - sx)) + 'px'; });
            document.addEventListener('mouseup', () => resizer.classList.remove('active'));
        }
    }

    function openRegexEditor() {
        const overlay = document.getElementById('regex-editor-overlay');
        if (!overlay) return;
        clearTimeout(_regexEditorCloseTimer);
        overlay.style.display = '';
        renderRegexNav();
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function renderRegexNav() {
        const list = document.getElementById('regex-editor-nav-list');
        if (!list) return;
        list.replaceChildren();
        (state.regexBindings || []).forEach((r, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pe-nav-item';
            btn.textContent = r.name || ('规则' + (i + 1));
            btn.title = (r.find || '').substring(0, 60);
            btn.addEventListener('click', () => selectRegexForEdit(i));
            if (i === _regexEditorCurrent) btn.classList.add('active');
            list.appendChild(btn);
        });
    }

    function selectRegexForEdit(idx) {
        _regexEditorCurrent = idx;
        const r = state.regexBindings[idx];
        if (!r) return;
        document.getElementById('regex-editor-empty').style.display = 'none';
        document.getElementById('regex-editor-form').style.display = '';
        document.getElementById('regex-edit-name').value = r.name || '';
        document.getElementById('regex-edit-find').value = r.find || '';
        const replaceEl = document.getElementById('regex-edit-replace');
        if (replaceEl) replaceEl.value = r.replace || '';
        renderRegexNav();
    }

    function saveRegexRule() {
        if (_regexEditorCurrent === null) return;
        const name = document.getElementById('regex-edit-name').value.trim() || '规则';
        const find = document.getElementById('regex-edit-find').value.trim();
        const replaceEl = document.getElementById('regex-edit-replace');
        const replace = replaceEl?.value || '';
        if (!find) { setStatus('请输入匹配正则', 'warn'); return; }
        state.regexBindings[_regexEditorCurrent] = { name, find, replace };
        renderRegexNav();
        updateRegexDisplay();
        autoSave();
        setStatus('正则已保存: ' + name, 'success');
    }

    function deleteRegexRule() {
        if (_regexEditorCurrent === null) return;
        state.regexBindings.splice(_regexEditorCurrent, 1);
        _regexEditorCurrent = null;
        document.getElementById('regex-editor-empty').style.display = '';
        document.getElementById('regex-editor-form').style.display = 'none';
        renderRegexNav();
        updateRegexDisplay();
        autoSave();
        setStatus('正则已删除', 'success');
    }

    function addRegexRule() {
        const idx = state.regexBindings.length;
        state.regexBindings.push({ name: '新规则', find: '', replace: '' });
        selectRegexForEdit(idx);
        document.getElementById('regex-edit-name').focus();
        autoSave();
    }

    function updateRegexDisplay() {
        const section = document.getElementById('regex-section');
        const countEl = document.getElementById('regex-rules-count');
        const listEl = document.getElementById('regex-rules-list');
        if (!section) return;
        const rules = state.regexBindings || [];
        if (!rules.length) { if (countEl) countEl.textContent = '0条'; return; }
        if (countEl) countEl.textContent = rules.length + '条';
        if (listEl) listEl.innerHTML = rules.map(r =>
            '<div style="padding:2px 0;display:flex;gap:8px;"><b>' + escHtml(r.name || '规则') + '</b> <span style="opacity:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(r.find.substring(0, 40)) + '</span></div>'
        ).join('');
    }

    function applyRegexBindings(text) {
        if (!text || !state.regexBindings?.length) return text;
        let result = text;
        for (const rule of state.regexBindings) {
            try {
                // Parse /pattern/flags format from ST. Pattern may contain /, so
                // split at last / to separate pattern body from flags.
                const str = rule.find;
                if (!str.startsWith('/')) continue;
                const lastSlash = str.lastIndexOf('/');
                if (lastSlash <= 0) continue;
                const pattern = str.substring(1, lastSlash);
                const flags = str.substring(lastSlash + 1);
                const re = new RegExp(pattern, flags || 'g');
                result = result.replace(re, rule.replace);
            } catch { /* skip invalid regex */ }
        }
        return result;
    }

    // ==================== Utils ====================
    function debounce(fn, delay) {
        let t;
        return function (...args) {
            clearTimeout(t);
            const wait = typeof delay === 'function' ? delay() : delay;
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    /** Read file as text using FileReader (more compatible than file.text()) */
    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsText(file);
        });
    }

    function formatRelativeTime(ts) {
        const now = new Date();
        const d = new Date(ts);
        const diff = now.getTime() - ts;
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const yesterday = today - 86400000;
        const dayBefore = yesterday - 86400000;
        const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 7200000) return '1小时前';
        if (dDay === today) {
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return '今天 ' + hh + ':' + mm;
        }
        if (dDay === yesterday) return '昨天';
        if (dDay === dayBefore) return '前天';
        if (d.getFullYear() === now.getFullYear()) {
            return (d.getMonth() + 1) + '月' + d.getDate() + '日';
        }
        return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    function escHtml(str) {
        if (!str) return '';
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }

    function escAttr(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function generateSummary(text, type = 'worldbook') {
        const config = state.aiConfig || {};
        const presetName = state.presetName || '__default__';
        const resp = await fetch('/api/ai/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, type, config, presetName }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'HTTP ' + resp.status);
        }
        const data = await resp.json();
        return data.summary || '';
    }

    // ==================== Preset Management ====================

    function saveCurrentAsPreset() {
        showPresetSaveModal();
    }

    let _presetSaveCloseTimer = 0;

    function showPresetSaveModal() {
        const overlay = document.getElementById('preset-save-overlay');
        const input = document.getElementById('preset-save-input');
        if (!overlay || !input) return;
        clearTimeout(_presetSaveCloseTimer);
        overlay.style.display = '';
        input.value = state.presetName || '';
        requestAnimationFrame(() => overlay.classList.add('active'));
        input.focus();
        input.select();
    }

    function bindPresetSaveModal() {
        const overlay = document.getElementById('preset-save-overlay');
        const input = document.getElementById('preset-save-input');
        const confirmBtn = document.getElementById('btn-preset-save-confirm');
        const cancelBtn = document.getElementById('btn-preset-save-cancel');
        if (!overlay) return;
        if (overlay.parentElement !== document.body) document.body.appendChild(overlay);

        const close = () => {
            overlay.classList.remove('active');
            _presetSaveCloseTimer = setTimeout(() => { overlay.style.display = 'none'; }, 200);
        };

        if (confirmBtn) confirmBtn.addEventListener('click', () => {
            const name = (input?.value || '').trim();
            if (!name) { close(); return; }
            close();
            doSavePreset(name);
        });

        if (cancelBtn) cancelBtn.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        input?.addEventListener('keydown', e => {
            if (e.key === 'Enter') confirmBtn?.click();
            if (e.key === 'Escape') cancelBtn?.click();
        });
    }

    function doSavePreset(name) {
        const preset = {
            name,
            provider: state.aiConfig.provider,
            model: state.aiConfig.model,
            temperature: state.aiConfig.temperature,
            maxTokens: state.aiConfig.maxTokens,
            maxTokensPct: state.aiConfig.maxTokensPct || 5,
            topP: state.aiConfig.topP,
            topK: state.aiConfig.topK,
            memoryBudget: state.aiConfig.memoryBudget,
            maxContext: state.aiConfig.maxContext,
            frequencyPenalty: state.aiConfig.frequencyPenalty,
            presencePenalty: state.aiConfig.presencePenalty,
            stream: state.aiConfig.stream,
            prefill: state.aiConfig.prefill,
            referenceMode: state.aiConfig.referenceMode,
            compactReference: state.aiConfig.compactReference,
            referenceTools: state.aiConfig.referenceTools,
            enableReferenceTools: state.aiConfig.enableReferenceTools,
            savedAt: Date.now(),
            templates: state.promptTemplates || [],
            promptOrder: state.promptOrder || [],
            enabledTemplates: state.enabledTemplates || {},
            regexBindings: state.regexBindings || [],
        };

        state.presets[name] = preset;
        state.presetName = name;
        updatePresetNameDisplay(name);
        updatePresetSelect();
        autoSave();

        setStatus(`✅ 配置方案已保存: ${name}`, 'success');
    }

    function updatePresetNameDisplay(name) {
        const el = document.getElementById('current-preset-name');
        if (el) el.textContent = name ? `当前预设: ${name}` : '';
    }

    function updatePresetSelect() {
        const select = document.getElementById('ai-preset');
        if (!select) return;
        select.innerHTML = '<option value="">— 选择预设 —</option>';
        Object.keys(state.presets || {}).sort((a, b) => a.localeCompare(b, 'zh-CN')).forEach(name => {
            select.innerHTML += `<option value="${escHtml(name)}" ${name === state.presetName ? 'selected' : ''}>${escHtml(name)}</option>`;
        });
    }

    // Expose state and render functions for chat-panel.js
    window.editorState = state;
    window.enterWorkspace = enterWorkspace;
    window.renderCharacterList = renderCharacterList;
    window.renderWorldBookList = renderWorldBookList;
    window.getChapterWindowAnchor = () => ensureChapterWindowAnchor();
    window.refreshChapterWindowAnchor = (reason) => refreshChapterWindowAnchor(reason);
    window.packWritingContext = (options = {}) =>
        (typeof ChatPanel !== 'undefined' ? ChatPanel.packCurrentContext?.(options) : undefined);

    // ==================== Persistence ====================

    function workspaceStorageKey(novelId = state.currentNovel?.id) {
        return novelId ? `novel-editor-state:${novelId}` : '';
    }

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
            aiConfig: { ...state.aiConfig, apiKey: '', maxContext: 0 },
            panelLayout: state.panelLayout || {},
            activeSessionId: state.activeSessionId,
        };
    }

    async function saveWorkspaceState({ silent = false } = {}) {
        if (!state.workspaceLoaded || !state.currentNovel?.id) return;
        const novelId = state.currentNovel.id;
        const workspace = serializeWorkspace();
        saveStateToLocal(workspace, { novelId, pendingSync: true });
        try {
            const data = await ApiClient.post(`/api/save/workspace/${encodeURIComponent(novelId)}`, workspace, {
                queueKey: `workspace:${novelId}`,
            });
            saveStateToLocal(workspace, { novelId, savedAt: data.savedAt, pendingSync: false });
            if (!silent) setStatus('工作区已保存', 'success');
        } catch (err) {
            if (!silent) setStatus(`工作区保存失败: ${err.message}`, 'error');
            throw err;
        }
    }

    function loadWorkspaceFallback(novelId) {
        try {
            const saved = localStorage.getItem(workspaceStorageKey(novelId));
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    }

    function saveStateToLocal(workspace = serializeWorkspace(), options = {}) {
        const novelId = options.novelId || state.currentNovel?.id;
        if (!state.workspaceLoaded || !novelId) return;
        try {
            localStorage.setItem(workspaceStorageKey(novelId), JSON.stringify({
                ...workspace,
                savedAt: options.savedAt || Date.now(),
                pendingSync: options.pendingSync === true,
            }));
        } catch (e) { /* quota exceeded? */ }
    }

    function sessionMessages(session) {
        if (Array.isArray(session?.messages)) return session.messages;
        if (!session?.messages || typeof session.messages !== 'object') return [];
        const preferred = session.messages[session.mode || 'write'];
        if (Array.isArray(preferred)) return preferred;
        return Object.values(session.messages).find(Array.isArray) || [];
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
        if (!state.activeSessionAnchor) {
            state.activeSessionAnchor = deriveChapterWindowAnchor('fallback');
        }
        return state.activeSessionAnchor;
    }

    function refreshChapterWindowAnchor(reason = 'context-pack') {
        state.activeSessionAnchor = deriveChapterWindowAnchor(reason);
        saveActiveSession().catch(() => {});
        return state.activeSessionAnchor;
    }

    function resolveChapterIndexByPointer(chapters, pointer = {}) {
        if (!Array.isArray(chapters) || !chapters.length || !pointer) return -1;
        if (pointer.id) {
            const byId = chapters.findIndex(chapter => String(chapter.id || '') === String(pointer.id));
            if (byId >= 0) return byId;
        }
        if (pointer.title) {
            const title = String(pointer.title || '').trim();
            const byTitle = chapters.findIndex(chapter => String(chapter.title || '').trim() === title);
            if (byTitle >= 0) return byTitle;
        }
        if (pointer.order !== undefined && pointer.order !== null && pointer.order !== '') {
            const order = Number(pointer.order);
            if (Number.isFinite(order)) {
                const byOrder = chapters.findIndex(chapter => Number(chapter.order) === order);
                if (byOrder >= 0) return byOrder;
            }
        }
        return -1;
    }

    async function maybePackChapterWindow(reason = 'five-chapter-window') {
        if (!state.workspaceLoaded || !state.activeSessionId || typeof ChatPanel === 'undefined') return;
        if (ChatPanel.isStreamingActive?.()) return;
        const chapters = getOrderedTextChapters();
        const currentIndex = resolveChapterIndexByPointer(chapters, state.currentChapter || {});
        const anchor = ensureChapterWindowAnchor();
        const anchorIndex = resolveChapterIndexByPointer(chapters, anchor);
        if (currentIndex < 0 || anchorIndex < 0) return;

        const stride = 5;
        if (currentIndex - anchorIndex < stride * 2) return;

        const result = await ChatPanel.packCurrentContext?.({
            reason,
            keepRecent: 8,
            silent: true,
            allowAnchorOnly: true,
        });
        if (result?.packed) {
            setStatus(result.anchorOnly ? '已更新五章上下文锚点' : '已完成五章上下文打包', 'success');
        }
    }

    async function loadSessions(preferredId, options = {}) {
        const novelId = options.novelId || state.currentNovel?.id;
        if (!novelId || typeof ChatPanel === 'undefined') return;
        const data = await ApiClient.get(
            `/api/sessions?novelId=${encodeURIComponent(novelId)}`,
            { signal: options.signal },
        );
        if (state.currentNovel?.id !== novelId) return;
        state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
        if (!state.sessions.length) {
            await createChatSession({ initial: true });
            return;
        }
        const target = state.sessions.find(session => session.id === preferredId) || state.sessions[0];
        await openChatSession(target.id, { novelId, signal: options.signal });
    }

    async function createChatSession({ initial = false } = {}) {
        if (!state.currentNovel?.id || typeof ChatPanel === 'undefined') return;
        const novelId = state.currentNovel.id;
        if (!initial) await saveActiveSession();
        const chapterWindowAnchor = deriveChapterWindowAnchor('new-session');
        try {
            const response = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    chapterWindowAnchor,
                    name: '新会话',
                }),
            });
            const session = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(session.error || `HTTP ${response.status}`);
            if (state.currentNovel?.id !== novelId) return;
            state.sessions = [session, ...state.sessions.filter(item => item.id !== session.id)];
            state.activeSessionId = session.id;
            state.activeSessionName = session.name;
            state.activeSessionAnchor = session.chapterWindowAnchor || chapterWindowAnchor;
            ChatPanel.clearChat();
            ChatPanel.renderSessionList(state.sessions, session.id);
            ChatPanel.setActiveSession(session.id);
            syncWorkspaceInteractivity();
            saveWorkspaceState({ silent: true }).catch(() => {});
        } catch (err) {
            setStatus(`新建会话失败: ${err.message}`, 'error');
        }
    }

    async function openChatSession(id, options = {}) {
        const novelId = options.novelId || state.currentNovel?.id;
        if (!id || !novelId || typeof ChatPanel === 'undefined') return;
        const session = await ApiClient.get(
            `/api/sessions/${encodeURIComponent(id)}?novelId=${encodeURIComponent(novelId)}`,
            { signal: options.signal },
        );
        if (state.currentNovel?.id !== novelId) return;
        state.activeSessionId = session.id;
        state.activeSessionAnchor = session.chapterWindowAnchor || deriveChapterWindowAnchor('legacy-session');
        state.activeSessionName = session.name || '新会话';
        ChatPanel.loadMessages(sessionMessages(session), session.totalRoundCount || 0);
        ChatPanel.renderSessionList(state.sessions, session.id);
        ChatPanel.setActiveSession(session.id);
        syncWorkspaceInteractivity();
    }

    async function switchChatSession(id) {
        if (!id || id === state.activeSessionId) return;
        if (typeof ChatPanel !== 'undefined' && ChatPanel.isStreamingActive?.()) return;
        try {
            await saveActiveSession();
            await openChatSession(id);
        } catch (err) {
            setStatus(`切换会话失败: ${err.message}`, 'error');
        }
    }

    async function deleteChatSession(id) {
        if (!id || !state.currentNovel?.id) return;
        try {
            await ApiClient.delete(`/api/sessions/${encodeURIComponent(id)}`, {
                novelId: state.currentNovel.id,
            });
            state.sessions = state.sessions.filter(session => session.id !== id);
            if (state.activeSessionId === id) {
                state.activeSessionId = null;
                if (state.sessions.length) await openChatSession(state.sessions[0].id);
                else await createChatSession({ initial: true });
            } else {
                ChatPanel.renderSessionList(state.sessions, state.activeSessionId);
            }
        } catch (err) {
            setStatus(`删除会话失败: ${err.message}`, 'error');
        }
    }

    async function saveActiveSession() {
        if (!state.workspaceLoaded || !state.activeSessionId || typeof ChatPanel === 'undefined') return;
        if (ChatPanel.isStreamingActive?.()) return;  // Skip save during active stream
        const novelId = state.currentNovel.id;
        const sessionId = state.activeSessionId;
        const messages = ChatPanel.getMessages();
        const response = await fetch(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                novelId: state.currentNovel.id,
                name: state.activeSessionName || '新会话',
                mode: ChatPanel.getActiveMode(),
                messages,
                chapterWindowAnchor: ensureChapterWindowAnchor(),
                totalRoundCount: ChatPanel.getTotalRoundCount?.() || 0,
            }),
        });
        const session = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(session.error || `HTTP ${response.status}`);
        if (state.currentNovel?.id !== novelId || state.activeSessionId !== sessionId) return;
        const meta = {
            id: session.id,
            name: session.name,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            mode: session.mode,
            messageCount: messages.length,
        };
        state.sessions = [meta, ...state.sessions.filter(item => item.id !== meta.id)]
            .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
        ChatPanel.renderSessionList(state.sessions, state.activeSessionId);
    }

    window.autoNameSession = (text) => {
        if (!state.activeSessionId || state.activeSessionName !== '新会话') return;
        state.activeSessionName = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 24) || '新会话';
        saveActiveSession().catch(() => {});
    };
    window.saveActiveChatSession = () => saveActiveSession().catch(() => {});

    function saveChatHistory() {
        try {
            if (typeof ChatPanel !== 'undefined' && ChatPanel.getMessages) {
                const msgs = ChatPanel.getMessages();
                const key = state.currentNovel?.id ? `novel-editor-chat:${state.currentNovel.id}` : '';
                if (key) localStorage.setItem(key, JSON.stringify(msgs));
            }
        } catch (e) { /* ignore */ }
    }

    function persistBeforeUnload() {
        if (!state.workspaceLoaded || !state.currentNovel?.id) return;
        if (state.isDirty && state.currentChapter?.id) {
            fetch(`/api/chapters/${encodeURIComponent(state.currentChapter.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    title: $('#chapter-title-input').value || state.currentChapter.title,
                    content: $('#chapter-editor').value,
                }),
                keepalive: true,
            }).catch(() => {});
        }
        const workspaceUrl = `/api/save/workspace/${encodeURIComponent(state.currentNovel.id)}`;
        fetch(workspaceUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serializeWorkspace()),
            keepalive: true,
        }).catch(() => {});
        if (state.activeSessionId && typeof ChatPanel !== 'undefined') {
            fetch(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    name: state.activeSessionName || '新会话',
                    mode: ChatPanel.getActiveMode(),
                    messages: ChatPanel.getMessages(),
                    chapterWindowAnchor: ensureChapterWindowAnchor(),
                }),
                keepalive: true,
            }).catch(() => {});
        }
    }

    // Debounced auto-save (fires 2s after last edit)
    const autoSave = debounce(() => {
        requestAnimationFrame(async () => {
            saveStateToLocal();
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
    window.saveStateToLocal = saveStateToLocal;
    window.onAISuccess = () => {
        state.aiUsed = true;
        localStorage.setItem('novel-ai-provider-chosen', state.aiConfig.provider);
        localStorage.setItem('novel-ai-connected-provider', state.aiConfig.provider);
        rememberLastSuccessfulAiConfig();
        updateStatusBar();
    };

    // ==================== Start ====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
