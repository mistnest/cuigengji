/**
 * Novel AI Editor — Main Application
 * 前端应用入口 — 整合所有模块
 */
(function () {
    'use strict';

    // ==================== State ====================
    const defaultAiConfig = {
        provider: 'anthropic',
        apiKey: '',
        endpoint: '',
        model: 'claude-sonnet-4-6',
        temperature: 0.7,
        maxTokens: 4096,
        topP: 0.9,
        memoryBudget: 15,
        maxContext: 0,
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
        writingReference: {
            worldbookMode: 'all',
            selectedWorldbookGroups: [],
            characterMode: 'auto',
            selectedCharacters: [],
        },
        sessions: [],
        activeSessionId: null,
        activeSessionName: '',
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
        workspaceLoaded: false,
    };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ==================== Initialization ====================
    function init() {
        initWelcomePage();
        initSettingsDialog();
        bindPromptEditor();
        bindGlobalTooltip();
        loadAppSettings();
        applyAppSettings();
        applyConfigToUI();
        loadAiSecretStatus(true);
        bindEvents();
        renderWorldBookList();
        renderCharacterList();
        renderPromptTemplates();
        updatePresetSelect();
        updateStatusBar();
        console.log('📖 Novel AI Editor v0.1.0 — Ready (状态已恢复)');
        setStatus('就绪 — 开始创作吧!', 'info');
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

    function showWelcomeCreateModal() {
        const overlay = document.getElementById('welcome-modal-overlay');
        const input = document.getElementById('welcome-modal-input');
        if (!overlay || !input) return;
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
            setTimeout(() => { overlay.style.display = 'none'; }, 200);
        };

        if (confirmBtn) confirmBtn.addEventListener('click', async () => {
            const title = (input?.value || '').trim();
            if (!title) { close(); return; }
            close();
            await doCreateWorkspace(title);
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
            await enterWorkspace(data.id, data.config?.title || title);
        } catch (err) {
            alert(`创建失败: ${err.message}`);
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
                icon.textContent = '\ud83d\udcd6';

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
                    await fetch(`/api/novels/${encodeURIComponent(novel.id)}`, { method: 'DELETE' });
                    delete accessed[novel.id];
                    novels.splice(novels.indexOf(novel), 1);
                    renderCards(expanded);
                });

                card.append(icon, info, delBtn);
                card.addEventListener('click', (e) => {
                    if (batchMode) {
                        const cb = card.querySelector('.welcome-batch-check');
                        if (cb && e.target !== delBtn) { cb.checked = !cb.checked; }
                        return;
                    }
                    if (e.target.closest('.welcome-delete-btn')) return;
                    enterWorkspace(novel.id, novel.title || novel.id);
                });
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
                        for (const id of ids) {
                            await fetch(`/api/novels/${encodeURIComponent(id)}`, { method: 'DELETE' });
                            delete accessed[id];
                        }
                        novels = novels.filter(n => !ids.includes(n.id));
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
            const [chapterResponse, outlineResponse, workspaceResponse] = await Promise.all([
                fetch(`/api/chapters?novelId=${encodeURIComponent(id)}`),
                fetch(`/api/outline?novelId=${encodeURIComponent(id)}`),
                fetch(`/api/save/workspace/${encodeURIComponent(id)}`),
            ]);

            if (!chapterResponse.ok) throw new Error(`章节加载失败: HTTP ${chapterResponse.status}`);
            if (!outlineResponse.ok) throw new Error(`大纲加载失败: HTTP ${outlineResponse.status}`);

            const chapterData = await chapterResponse.json();
            const outlineData = await outlineResponse.json();
            const diskWorkspace = workspaceResponse.ok ? await workspaceResponse.json() : {};
            const localWorkspace = loadWorkspaceFallback(id) || {};
            const workspaceData = Number(localWorkspace.savedAt || 0) > Number(diskWorkspace.savedAt || 0)
                ? localWorkspace
                : diskWorkspace;
            state.chapters = Array.isArray(chapterData.chapters) ? chapterData.chapters : [];
            state.outline = Array.isArray(outlineData.nodes) ? outlineData.nodes : [];
            applyWorkspaceState(workspaceData);
            state.workspaceLoaded = true;
            localStorage.setItem('novel-editor-last-workspace', id);
            await loadAiSecretStatus();

            state.currentChapter = null;
            refreshChapterTree();
            renderOutlineTree();
            renderWorldBookList();
            renderCharacterList();
            renderPromptTemplates();
            try {
                await loadSessions(workspaceData.activeSessionId);
            } catch (sessionError) {
                ChatPanel?.clearChat();
                setStatus(`会话加载失败: ${sessionError.message}`, 'error');
            }

            const firstChapter = state.chapters.find(item => item.type !== 'volume');
            if (firstChapter) {
                const response = await fetch(`/api/chapters/${encodeURIComponent(firstChapter.id)}?novelId=${encodeURIComponent(id)}`);
                loadChapter(response.ok ? await response.json() : firstChapter);
            } else {
                clearChapterEditor();
            }
        } catch (err) {
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
        state.aiConfig = { ...defaultAiConfig };
        state.isConnected = false;
        state.hasSavedApiKey = false;
        updatePresetNameDisplay('');
        updatePresetSelect();
        applyConfigToUI();
        if (typeof ChatPanel !== 'undefined') ChatPanel.clearChat();
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
        if (workspace.writingReference && typeof workspace.writingReference === 'object') {
            state.writingReference = {
                ...state.writingReference,
                ...workspace.writingReference,
            };
        }
        if (workspace.aiConfig && typeof workspace.aiConfig === 'object') {
            Object.assign(state.aiConfig, workspace.aiConfig, { apiKey: '' });
        }
        updatePresetNameDisplay(state.presetName);
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
        if (!Object.keys(state.worldBook?.entries || {}).length) return setStatus('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u4e16\u754c\u4e66', 'warn');
        downloadJson(state.worldBook, `${state.currentNovel?.title || 'worldbook'}-worldbook.json`);
    }

    function exportCharacters() {
        if (!state.characters.length) return setStatus('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u89d2\u8272', 'warn');
        downloadJson(state.characters, `${state.currentNovel?.title || 'characters'}-characters.json`);
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

    function initSettingsDialog() {
        const serviceSlot = $('#settings-ai-service-slot');
        const generationSlot = $('#settings-generation-slot');
        const connection = $('#ai-connection-section');
        const generation = $('#ai-generation-settings');

        if (serviceSlot && connection) serviceSlot.appendChild(connection);
        if (generationSlot && generation) generationSlot.appendChild(generation);

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

    function loadAppSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem('novel-editor-app-settings') || '{}');
            Object.assign(state.appSettings, saved);
        } catch (e) { /* ignore invalid local settings */ }
    }

    function saveAppSettings() {
        localStorage.setItem('novel-editor-app-settings', JSON.stringify(state.appSettings));
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
        localStorage.removeItem('panel-left-width');
        localStorage.removeItem('panel-right-width');
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
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'plot-modal char-detail-modal character-edit-modal';
        modal.innerHTML = `
            <div class="plot-modal-header">
                <div>
                    <h3>新建角色</h3>
                    <p class="settings-subtitle">先建立基础角色卡，之后可继续导入或补充详细设定。</p>
                </div>
                <button type="button" class="plot-modal-close" aria-label="关闭">×</button>
            </div>
            <div class="plot-modal-body char-detail-body">
                <div class="char-field">
                    <h4>角色名称 <span class="required-mark">*</span></h4>
                    <input type="text" class="wb-edit-input" id="character-edit-name" placeholder="例如：林冬" maxlength="80">
                    <div class="field-error" id="character-name-error"></div>
                </div>
                <div class="char-field">
                    <h4>角色简介</h4>
                    <textarea class="wb-edit-textarea character-edit-short" id="character-edit-description" placeholder="身份、外貌、经历或核心特征"></textarea>
                </div>
                <div class="character-edit-grid">
                    <div class="char-field">
                        <h4>性格</h4>
                        <textarea class="wb-edit-textarea character-edit-short" id="character-edit-personality" placeholder="性格特点、行为习惯"></textarea>
                    </div>
                    <div class="char-field">
                        <h4>背景场景</h4>
                        <textarea class="wb-edit-textarea character-edit-short" id="character-edit-scenario" placeholder="角色所处环境和当前处境"></textarea>
                    </div>
                </div>
                <div class="char-field">
                    <h4>开场白</h4>
                    <textarea class="wb-edit-textarea character-edit-short" id="character-edit-first-message" placeholder="可选：角色第一次出场时的台词或动作"></textarea>
                </div>
                <div class="char-field">
                    <h4>标签</h4>
                    <input type="text" class="wb-edit-input" id="character-edit-tags" placeholder="主角, 调查员, 雾港（逗号分隔）">
                </div>
                <div class="char-field">
                    <h4>分组</h4>
                    <input type="text" class="wb-edit-input" id="character-edit-group" placeholder="角色分组（可选）" list="char-group-list">
                    <datalist id="char-group-list">
                        <option value="主角">
                        <option value="配角">
                        <option value="反派">
                        <option value="NPC">
                    </datalist>
                </div>
            </div>
            <div class="plot-modal-footer">
                <button type="button" class="plot-btn-cancel character-edit-cancel">取消</button>
                <button type="button" class="char-btn-extract-book character-edit-save">创建角色</button>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const nameInput = overlay.querySelector('#character-edit-name');
        const error = overlay.querySelector('#character-name-error');
        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close').addEventListener('click', close);
        overlay.querySelector('.character-edit-cancel').addEventListener('click', close);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') close();
        });
        overlay.querySelector('.character-edit-save').addEventListener('click', () => {
            const name = nameInput.value.trim();
            if (!name) {
                error.textContent = '请输入角色名称';
                nameInput.focus();
                return;
            }
            const tags = overlay.querySelector('#character-edit-tags').value
                .split(/[,，]/)
                .map(tag => tag.trim())
                .filter(Boolean);
            state.characters.push({
                spec: 'chara_card_v3',
                spec_version: '3.0',
                data: {
                    name,
                    description: overlay.querySelector('#character-edit-description').value.trim(),
                    personality: overlay.querySelector('#character-edit-personality').value.trim(),
                    scenario: overlay.querySelector('#character-edit-scenario').value.trim(),
                    first_mes: overlay.querySelector('#character-edit-first-message').value.trim(),
                    mes_example: '',
                    creator_notes: '',
                    system_prompt: '',
                    post_history_instructions: '',
                    tags,
                    character_book: { entries: [] },
                },
            });
            renderCharacterList();
            autoSave();
            close();
            setStatus(`已创建角色: ${name}`, 'success');
        });

        requestAnimationFrame(() => {
            overlay.classList.add('active');
            nameInput.focus();
        });
    }

    async function showLastPrompt() {
        try {
            const response = await fetch('/api/debug/last-prompt');
            const data = await response.json();
            const overlay = document.createElement('div');
            overlay.className = 'plot-modal-overlay active';
            const modal = document.createElement('div');
            modal.className = 'plot-modal';
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'plot-modal-close';
            close.textContent = '\u00d7';
            close.addEventListener('click', () => overlay.remove());
            const pre = document.createElement('pre');
            pre.style.cssText = 'white-space:pre-wrap;max-height:70vh;overflow:auto;padding:16px;';
            pre.textContent = data.empty ? '\u8fd8\u6ca1\u6709\u53d1\u9001\u8fc7 AI \u8bf7\u6c42' : JSON.stringify(data, null, 2);
            modal.append(close, pre);
            overlay.appendChild(modal);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
            document.body.appendChild(overlay);
        } catch (err) {
            setStatus(`\u8c03\u8bd5\u4fe1\u606f\u52a0\u8f7d\u5931\u8d25: ${err.message}`, 'error');
        }
    }

    async function onInfill() {
        const editor = $('#chapter-editor');
        if (!editor) return;
        const instruction = prompt('\u8bf7\u63cf\u8ff0\u4e2d\u95f4\u9700\u8981\u8865\u5199\u7684\u5185\u5bb9');
        if (!instruction?.trim()) return;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        try {
            setStatus('AI \u6b63\u5728\u8865\u5199...', 'loading');
            const response = await fetch('/api/chat/infill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    beforeText: editor.value.slice(0, start),
                    afterText: editor.value.slice(end),
                    instruction: instruction.trim(),
                    config: state.aiConfig,
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
            updateMemoryBudgetInfo();
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
            updateMemoryBudgetInfo();
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
        setStatus('已保存: ' + name, 'success');
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

    function collectWorldBookGroups() {
        const groups = new Set();
        if (state.worldBook?.entries) {
            Object.values(state.worldBook.entries).forEach(entry => {
                if (entry.group?.trim()) groups.add(entry.group.trim());
            });
        }
        return [...groups].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }

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
        $('#ai-api-key').value = '';
        $('#ai-endpoint').value = c.endpoint;
        $('#ai-model').value = c.model;
        updateModelContextInfo(c.model);
        $('#ai-temperature').value = c.temperature;
        $('#ai-max-tokens').value = c.maxTokens;
        $('#ai-top-p').value = c.topP;
        const memoryBudget = Number(c.memoryBudget || 15);
        document.querySelectorAll('input[name="memory-budget"]').forEach(input => {
            input.checked = Number(input.value) === memoryBudget;
            input.closest('.budget-option')?.classList.toggle('active', input.checked);
        });
        updateRangeLabels();
        updateProviderUI();
        updateMemoryBudgetInfo();
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

        // AI buttons
        $('#btn-continue').addEventListener('click', onContinue);
        $('#btn-plot-suggestions').addEventListener('click', onPlotSuggestions);
        $('#btn-inspire').addEventListener('click', onInspire);
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
            if (preset.topP !== undefined) state.aiConfig.topP = preset.topP;
            if (preset.topK !== undefined) state.aiConfig.topK = preset.topK;
            if (preset.memoryBudget !== undefined) state.aiConfig.memoryBudget = preset.memoryBudget;
            if (preset.maxContext !== undefined) state.aiConfig.maxContext = preset.maxContext;
            if (preset.prefill) state.aiConfig.prefill = preset.prefill;
            if (preset.templates) state.promptTemplates = preset.templates;
            if (preset.promptOrder) state.promptOrder = preset.promptOrder;
            if (preset.enabledTemplates) state.enabledTemplates = preset.enabledTemplates;

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
        $('#ai-endpoint').addEventListener('input', debounce(onConfigChange, 500));
        $('#ai-model').addEventListener('change', onModelSelectChange);
        $('#ai-temperature').addEventListener('input', () => { onConfigChange(); updateRangeLabels(); });
        $('#ai-max-tokens').addEventListener('input', () => { onConfigChange(); updateRangeLabels(); });
        $('#ai-top-p').addEventListener('input', () => { onConfigChange(); updateRangeLabels(); });
        document.querySelectorAll('input[name="memory-budget"]').forEach(input => {
            input.addEventListener('change', () => {
                if (!input.checked) return;
                state.aiConfig.memoryBudget = Number(input.value);
                document.querySelectorAll('.budget-option').forEach(option => {
                    option.classList.toggle('active', option.contains(input));
                });
                saveConfig();
                updateMemoryBudgetInfo();
            });
        });

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

        // Chapter tree events
        if (typeof ChapterTree !== 'undefined') {
            ChapterTree.on('select', onChapterTreeSelect);
            ChapterTree.on('rename', onChapterTreeRename);
            ChapterTree.on('delete', onChapterTreeDelete);
            ChapterTree.on('reorder', onChapterTreeReorder);
        }
    }

    // ==================== AI Actions ====================
    async function onContinue() {
        const text = $('#chapter-editor').value;
        if (!text.trim()) { setStatus('请先编写正文再续写', 'warn'); return; }
        if (!state.aiConfig.apiKey && !state.hasSavedApiKey && state.aiConfig.provider !== 'ollama') {
            setStatus('请先配置 API Key', 'error'); return;
        }
        if (state.isGenerating) return;

        state.isGenerating = true;
        setStatus('AI 正在续写...', 'loading');
        $('#btn-continue').disabled = true;
        $('#btn-continue').textContent = '⏳ 生成中...';

        try {
            const response = await fetch('/api/ai/continue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    config: state.aiConfig,
                    worldBook: getReferencedWorldBook(),
                    characters: getReferencedCharacters(text),
                    outline: getIncompleteOutline(),
                    styleGuide: state.currentNovel?.styleGuide || '',
                    novelId: state.currentNovel?.id,
                    memoryBudget: state.aiConfig.memoryBudget || 15,
                    presetName: state.presetName || '__default__',
                }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.content?.trim()) throw new Error('模型没有返回正文，请提高单次输出长度后重试');
            const editor = $('#chapter-editor');
            // Append generated content
            editor.value = text + '\n\n' + data.content;
            editor.scrollTop = editor.scrollHeight;
            state.isDirty = true;
            updateWordCount();
            updateContextInfo(data.context, data.memory);
            setStatus('续写完成!', 'success');
        } catch (err) {
            setStatus(`续写失败: ${err.message}`, 'error');
        } finally {
            state.isGenerating = false;
            $('#btn-continue').disabled = false;
            $('#btn-continue').textContent = '✨ 续写下一段';
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
        $('#btn-plot-suggestions').disabled = true;

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
            $('#btn-plot-suggestions').disabled = false;
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
        }
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
        if (state.isDirty && !await onSave({ silent: true })) return;
        await createChapter();
    }

    async function onAddVolume() {
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

    function loadChapter(chapter) {
        state.currentChapter = chapter;
        setChapterEditorEnabled(true);
        $('#chapter-editor').value = chapter.content || '';
        $('#chapter-title-input').value = chapter.title || '';
        $('#current-chapter-title').textContent = `- ${chapter.title || '无标题'}`;
        state.isDirty = false;
        updateWordCount();
        updateStatusBar();
        refreshChapterTree();
        setStatus(`已加载: ${chapter.title}`, 'info');
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
            const resp = await fetch(`/api/chapters/${ch.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ novelId: state.currentNovel.id, title, content }),
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
            if (!silent) setStatus('已保存', 'success');
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
        const chapter = state.chapters.find(item => item.id === id);
        if (!chapter || chapter.type === 'volume') return false;
        loadChapter(chapter);
        return true;
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

    // ==================== World Book Import ====================
    async function importWorldBook(files) {
        if (!files?.[0]) return;
        const file = files[0];

        try {
            const text = await readFileAsText(file);
            const data = JSON.parse(text);

            const resp = await fetch('/api/import/worldbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: file.name.replace('.json', ''), data }),
            });

            if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);

            const result = await resp.json();
            state.worldBook = result;
            renderWorldBookList();
            autoSave();
            setStatus(`✅ 世界书导入成功: ${result.entryCount} 个条目`, 'success');
        } catch (err) {
            setStatus(`世界书导入失败: ${err.message}`, 'error');
        }
    }

    function renderWorldBookList() {
        const list = $('#worldbook-list');
        const entries = state.worldBook?.entries || {};
        const keys = Object.keys(entries);

        if (keys.length === 0) {
            list.innerHTML = '<div class="list-placeholder">尚未导入世界书<br>点击 "📥" 导入 ST 世界书</div>';
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

        list.innerHTML = keys.map(k => {
            const e = entries[k];
            const name = e.comment || e.key?.[0] || `条目${k}`;
            const mainKw = (e.key || []).join(', ');
            const subKw = (e.keysecondary || []).join(', ');
            const matchedNow = activeUids.has(k);

            // 3 states: constant (always on), selective (keyword match), disabled
            let stateIcon, stateClass, stateLabel;
            if (e.disable) {
                stateIcon = '⏸'; stateClass = 'disabled'; stateLabel = '已禁用';
            } else if (e.constant) {
                stateIcon = '🟢'; stateClass = 'constant'; stateLabel = '始终激活';
            } else if (matchedNow) {
                stateIcon = '🔵'; stateClass = 'triggered'; stateLabel = '触发中';
            } else {
                stateIcon = '🟡'; stateClass = 'waiting'; stateLabel = '待触发';
            }

            let kwHtml = '';
            if (mainKw) {
                kwHtml += `<div class="item-kw"><span class="kw-label">主关键词</span> ${escHtml(mainKw)}</div>`;
            }
            if (subKw) {
                kwHtml += `<div class="item-kw"><span class="kw-label">次级词</span> ${escHtml(subKw)}</div>`;
            }
            if (!mainKw && !subKw && !e.constant) {
                kwHtml = '<div class="item-kw" style="color:var(--text-muted);font-style:italic;">未设置关键词</div>';
            }

            return `<div class="list-item wb-entry ${matchedNow ? 'active-in-scene' : ''}" data-uid="${k}">
                <input type="checkbox" class="batch-check" data-id="${k}" aria-label="选择 ${escHtml(name)}">
                <div class="item-title">${stateIcon} ${escHtml(name)}</div>
                ${kwHtml}
                <div class="item-status ${stateClass}">${stateLabel}</div>
            </div>`;
        }).join('');

        // Click → show detail
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
        renderReferenceControls();
    }

    function showWorldBookDetail(uid, entry) {
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';

        const isActive = checkEntryActive(entry);
        let statusIcon, statusClass, statusText;
        if (entry.disable) {
            statusIcon = '⏸'; statusClass = 'disabled'; statusText = '已禁用';
        } else if (entry.constant) {
            statusIcon = '🟢'; statusClass = 'constant'; statusText = '始终激活';
        } else if (isActive) {
            statusIcon = '🔵'; statusClass = 'triggered'; statusText = '触发中';
        } else {
            statusIcon = '🟡'; statusClass = 'waiting'; statusText = '待触发';
        }
        const posLabels = ['角色前', '角色后', '按深度', '@D标注'];

        const modal = document.createElement('div');
        modal.className = 'plot-modal char-detail-modal wb-edit-modal';
        modal.innerHTML = `
            <div class="plot-modal-header">
                <h3>${statusIcon} 编辑世界书条目</h3>
                <span class="item-status ${statusClass}">${statusText}</span>
                <button class="plot-modal-close">✕</button>
            </div>
            <div class="plot-modal-body char-detail-body">
                <div class="char-field">
                    <h4>📛 显示名称 / 备注</h4>
                    <input type="text" class="wb-edit-input" id="wb-edit-comment" value="${escHtml(entry.comment || '')}" placeholder="用于识别的名称...">
                </div>
                <div class="char-field">
                    <h4>🔑 触发关键词（逗号分隔）</h4>
                    <input type="text" class="wb-edit-input" id="wb-edit-key" value="${escHtml((entry.key || []).join(', '))}" placeholder="关键词1, 关键词2...">
                </div>
                <div class="char-field">
                    <h4>🔍 次级关键词（逗号分隔）</h4>
                    <input type="text" class="wb-edit-input" id="wb-edit-keysecondary" value="${escHtml((entry.keysecondary || []).join(', '))}" placeholder="次要触发词...">
                </div>
                <div class="char-field">
                    <h4>📝 注入内容</h4>
                    <textarea class="wb-edit-textarea" id="wb-edit-content" placeholder="当关键词触发时，这段内容会被注入到 AI 的上下文中...">${escHtml(entry.content || '')}</textarea>
                </div>
                <div class="wb-edit-row">
                    <div class="char-field" style="flex:1;">
                        <h4>📊 排序权重</h4>
                        <input type="number" class="wb-edit-input" id="wb-edit-order" value="${entry.order ?? 100}" min="1" max="999">
                    </div>
                    <div class="char-field" style="flex:1;">
                        <h4>📏 扫描深度</h4>
                        <input type="number" class="wb-edit-input" id="wb-edit-depth" value="${entry.depth ?? 4}" min="0" max="100" placeholder="扫描最近N条消息">
                    </div>
                </div>
                <div class="wb-edit-row">
                    <div class="char-field" style="flex:1;">
                        <h4>📍 注入位置</h4>
                        <select class="wb-edit-input" id="wb-edit-position">
                            ${posLabels.map((l, i) => `<option value="${i}" ${(entry.position ?? 0) === i ? 'selected' : ''}>${l}</option>`).join('')}
                        </select>
                    </div>
                    <div class="char-field" style="flex:1;">
                        <h4>🎲 激活概率 (%)</h4>
                        <input type="number" class="wb-edit-input" id="wb-edit-probability" value="${entry.probability ?? 100}" min="0" max="100">
                    </div>
                </div>
                <div class="wb-edit-row">
                    <div class="char-field" style="flex:1;">
                        <h4>📁 分组名</h4>
                        <input type="text" class="wb-edit-input" id="wb-edit-group" value="${escHtml(entry.group || '')}" placeholder="选择或输入分组名" list="wb-group-list">
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
                <div class="wb-edit-checks">
                    <label class="wb-check-label"><input type="checkbox" id="wb-edit-constant" ${entry.constant ? 'checked' : ''}> 始终激活（忽略关键词匹配）</label>
                    <label class="wb-check-label"><input type="checkbox" id="wb-edit-disable" ${entry.disable ? 'checked' : ''}> 禁用此条目</label>
                    <label class="wb-check-label"><input type="checkbox" id="wb-edit-caseSensitive" ${entry.caseSensitive ? 'checked' : ''}> 大小写敏感</label>
                    <label class="wb-check-label"><input type="checkbox" id="wb-edit-matchWholeWords" ${entry.matchWholeWords ? 'checked' : ''}> 全词匹配</label>
                </div>
            </div>
            <div class="plot-modal-footer">
                <button class="char-btn-extract-book wb-save-btn">💾 保存</button>
                <button class="plot-btn-cancel wb-cancel-btn">取消</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close').addEventListener('click', close);
        overlay.querySelector('.wb-cancel-btn').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        // Save button
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
            updated.group = overlay.querySelector('#wb-edit-group').value.trim();
            updated.groupWeight = parseInt(overlay.querySelector('#wb-edit-groupWeight').value) || 100;
            updated.constant = overlay.querySelector('#wb-edit-constant').checked;
            updated.disable = overlay.querySelector('#wb-edit-disable').checked;
            updated.caseSensitive = overlay.querySelector('#wb-edit-caseSensitive').checked;
            updated.matchWholeWords = overlay.querySelector('#wb-edit-matchWholeWords').checked;

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

        for (const file of files) {
            try {
                if (file.name.endsWith('.png')) {
                    const form = new FormData();
                    form.append('file', file);
                    const resp = await fetch('/api/import/character-png', { method: 'POST', body: form });
                    if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);
                    const data = await resp.json();
                    state.characters.push(data);
                } else if (file.name.endsWith('.json')) {
                    const text = await readFileAsText(file);
                    const data = JSON.parse(text);
                    const resp = await fetch('/api/import/character-json', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data }),
                    });
                    if (!resp.ok) throw new Error((await resp.json()).error || resp.statusText);
                    state.characters.push(data);
                }
            } catch (err) {
                setStatus(`导入 ${file.name} 失败: ${err.message}`, 'error');
            }
        }

        renderCharacterList();
        autoSave();
        setStatus(`✅ 成功导入角色 (共${state.characters.length}个)`, 'success');
    }

    function renderCharacterList() {
        const list = $('#character-list');
        if (!state.characters.length) {
            list.innerHTML = '<div class="list-placeholder">尚未导入角色<br>点击 "📥" 导入 ST 角色卡</div>';
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

        list.innerHTML = state.characters.map((ch, i) => {
            const name = ch.data?.name || ch.name || `角色${i + 1}`;
            const desc = ch.data?.description || ch.description || '';
            const isActive = activeNames.has(name);
            const charBook = ch.data?.character_book || ch.data?.data?.character_book;
            const innerBookCount = charBook?.entries
                ? Object.keys(charBook.entries).length : 0;
            return `<div class="list-item character-entry ${isActive ? 'active-in-scene' : ''}" data-index="${i}">
                <input type="checkbox" class="batch-check" data-id="${i}" aria-label="选择 ${escHtml(name)}">
                <div class="item-title">
                    ${isActive ? '🟢' : '⚪'} ${escHtml(name)}
                    ${innerBookCount > 0 ? `<span class="char-book-badge" title="内嵌 ${innerBookCount} 条世界书">📚${innerBookCount}</span>` : ''}
                </div>
                <div class="item-subtitle">${escHtml(desc.substring(0, 60))}${desc.length > 60 ? '...' : ''}</div>
                ${isActive ? '<div class="item-status enabled">当前场景中</div>' : ''}
            </div>`;
        }).join('');

        // Click → show detail card
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
                    showCharacterDetail(state.characters[idx], idx);
                }
            });
        });
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
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'batch-actions';
            actions.innerHTML = type === 'worldbook'
                ? '<button data-action="enable">启用</button><button data-action="disable">停用</button><button data-action="delete">删除</button>'
                : '<button data-action="delete">删除</button>';
            const list = type === 'worldbook' ? $('#worldbook-list') : $('#character-list');
            list?.before(actions);
            actions.addEventListener('click', event => {
                const action = event.target.closest('button')?.dataset.action;
                if (action) applyBatchAction(type, action);
            });
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
        } else if (action === 'delete') {
            const indexes = new Set(selected.map(Number));
            state.characters = state.characters.filter((_character, index) => !indexes.has(index));
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
                .map(entry => entry.group?.trim())
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
        }

        const characterPicks = $('#character-reference-picks');
        if (characterPicks) {
            characterPicks.replaceChildren();
            const names = state.characters
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
                <button class="plot-btn-cancel char-detail-close">关闭</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close').addEventListener('click', close);
        overlay.querySelector('.char-detail-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        // Extract embedded world book button
        const extractBtn = overlay.querySelector('.char-btn-extract-book');
        if (extractBtn) {
            if (bookEntries.length > 0) {
                extractBtn.addEventListener('click', () => {
                    if (!state.worldBook) state.worldBook = { entries: {} };
                    const nextUid = Math.max(0, ...Object.keys(state.worldBook.entries).map(Number)) + 1;
                    let added = 0;
                    bookEntries.forEach((e, i) => {
                        const newEntry = { ...e, uid: nextUid + i };
                        state.worldBook.entries[nextUid + i] = newEntry;
                        added++;
                    });
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
                state.promptTemplates = data.prompts
                    .filter(p => (p.content?.trim() || p.marker))
                    .map(p => ({
                        identifier: p.identifier || '',
                        name: p.name || p.identifier || '',
                        role: p.role || 'system',
                        content: p.content || '',
                        isSystemPrompt: !!p.system_prompt,
                        isMarker: !!p.marker,
                    }));
            }

            // === 5. Prompt ordering ===
            if (Array.isArray(data.prompt_order)) state.promptOrder = data.prompt_order;
            if (data.prompt_order) state.promptOrder = data.prompt_order;

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
                setStatus('已删除: ' + tmpl.name, 'success');
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
            const node = await resp.json();
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
        node.completed = !node.completed;
        try {
            await fetch(`/api/outline/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ novelId: state.currentNovel.id, completed: node.completed }),
            });
        } catch (e) { /* ignore */ }
        renderOutlineTree();
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
                .filter(([, entry]) => entry.group && groups.has(entry.group))),
        };
    }

    function getReferencedCharacters(text = '') {
        const mode = state.writingReference?.characterMode || 'auto';
        if (mode === 'off') return [];
        const selected = new Set(state.writingReference.selectedCharacters || []);
        return state.characters.filter(character => {
            const name = character.data?.name || character.name || '';
            if (!name) return false;
            if (mode === 'selected') return selected.has(name);
            return text.includes(name);
        });
    }

    // ==================== Config Handlers ====================
    function onProviderChange() {
        state.aiConfig.provider = $('#ai-provider').value;
        localStorage.setItem('novel-ai-provider-chosen', state.aiConfig.provider);
        state.hasSavedApiKey = false;
        state.isConnected = false;
        saveConfig();
        updateProviderUI();
        loadAiSecretStatus();
        updateStatusBar();
    }

    function updateProviderUI() {
        const provider = state.aiConfig.provider;
        const isOllama = provider === 'ollama';
        $('#ai-api-key').style.display = isOllama ? 'none' : '';

        // Auto-fill default model for each provider
        const defaultModels = {
            anthropic: 'claude-sonnet-4-6',
            openai: 'gpt-4o',
            deepseek: 'deepseek-v4-flash',
            openrouter: 'anthropic/claude-sonnet-4-6',
            ollama: 'llama3',
        };
        const currentModel = $('#ai-model').value;
        if (!currentModel || Object.values(defaultModels).includes(currentModel)) {
            $('#ai-model').value = defaultModels[provider] || '';
        }

        // Auto-fill default endpoint for each provider
        const defaultEndpoints = {
            anthropic: 'https://api.anthropic.com',
            openai: 'https://api.openai.com/v1',
            deepseek: 'https://api.deepseek.com',
            openrouter: 'https://openrouter.ai/api/v1',
            ollama: 'http://localhost:11434',
        };
        const endpointInput = $('#ai-endpoint');
        if (endpointInput && !endpointInput.value.trim()) {
            endpointInput.value = defaultEndpoints[provider] || '';
        }

        updateMemoryBudgetInfo();
    }

    function onConfigChange() {
        const apiKey = $('#ai-api-key').value.trim();
        state.aiConfig.apiKey = apiKey;
        state.aiConfig.endpoint = $('#ai-endpoint').value;
        state.aiConfig.model = $('#ai-model').value;
        state.aiConfig.temperature = parseFloat($('#ai-temperature').value);
        state.aiConfig.maxTokens = parseInt($('#ai-max-tokens').value);
        state.aiConfig.topP = parseFloat($('#ai-top-p').value);
        saveConfig();
        updateMemoryBudgetInfo();
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
        try {
            const profile = state.presetName || '__default__';
            state.hasSavedApiKey = false;
            if (preferDeepseek && !localStorage.getItem('novel-ai-provider-chosen')) {
                const deepseekResponse = await fetch(`/api/ai-secrets/status?provider=deepseek&profile=${encodeURIComponent(profile)}`);
                const deepseek = await deepseekResponse.json();
                if (deepseek.hasKey) {
                    state.aiConfig.provider = 'deepseek';
                    state.aiConfig.model = 'deepseek-v4-flash';
                    state.aiConfig.endpoint = '';
                    state.hasSavedApiKey = true;
                    state.isConnected = localStorage.getItem('novel-ai-connected-provider') === 'deepseek';
                    $('#ai-provider').value = 'deepseek';
                    $('#ai-model').value = 'deepseek-v4-flash';
                    $('#ai-endpoint').value = '';
                    $('#ai-api-key').placeholder = 'DeepSeek API Key 已安全保存到本机';
                    localStorage.setItem('novel-ai-provider-chosen', 'deepseek');
                    saveConfig();
                    updateProviderUI();
                    updateStatusBar();
                    return;
                }
            }

            const provider = state.aiConfig.provider;
            const response = await fetch(`/api/ai-secrets/status?provider=${encodeURIComponent(provider)}&profile=${encodeURIComponent(profile)}`);
            const data = await response.json();
            state.hasSavedApiKey = Boolean(data.hasKey);
            state.isConnected = data.hasKey
                && localStorage.getItem('novel-ai-connected-provider') === provider;
            if (data.hasKey) {
                $('#ai-api-key').placeholder = 'API Key 已安全保存到本机';
            }
            updateStatusBar();
        } catch {}
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
            if (label) label.textContent = tokens.value;
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

    function updateMemoryBudgetInfo() {
        const total = getModelContextLimit();
        const pct = Number(state.aiConfig.memoryBudget || 15);
        const estimate = Math.round(total * pct / 100);
        const estimateEl = $('#memory-tokens-estimate');
        const totalEl = $('#context-total');
        if (estimateEl) estimateEl.textContent = estimate.toLocaleString('zh-CN');
        if (totalEl) totalEl.textContent = formatTokenLimit(total);
    }

    function updateContextInfo(ctx, memory) {
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
            showExtractionResults(memory.extractions);
        }
    }

    function showExtractionResults(extractions) {
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
            menu.style.top = `${rect.bottom + 4}px`;
            menu.style.left = `${rect.left}px`;
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
                ? `${state.aiConfig.model} · 记忆预算 ${state.aiConfig.memoryBudget || 15}%`
                : '尚未选择可用模型';
        }
        const section = $('#ai-connection-section');
        if (section) {
            section.classList.toggle('connected', state.isConnected);
            section.open = true;
        }
        // Onboarding — hide when connected
        const onboarding = document.getElementById('ai-onboarding');
        if (onboarding) onboarding.style.display = state.isConnected ? 'none' : '';
        // Onboarding steps
        $('#onboard-step-1')?.classList.toggle('done', Boolean(state.aiConfig.provider));
        $('#onboard-step-2')?.classList.toggle('done', state.hasSavedApiKey || state.aiConfig.provider === 'ollama');
        $('#onboard-step-3')?.classList.toggle('done', state.isConnected);
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

    // ==================== Preset Management ====================

    function saveCurrentAsPreset() {
        showPresetSaveModal();
    }

    function showPresetSaveModal() {
        const overlay = document.getElementById('preset-save-overlay');
        const input = document.getElementById('preset-save-input');
        if (!overlay || !input) return;
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
            setTimeout(() => { overlay.style.display = 'none'; }, 200);
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
            topP: state.aiConfig.topP,
            topK: state.aiConfig.topK,
            memoryBudget: state.aiConfig.memoryBudget,
            maxContext: state.aiConfig.maxContext,
            frequencyPenalty: state.aiConfig.frequencyPenalty,
            presencePenalty: state.aiConfig.presencePenalty,
            stream: state.aiConfig.stream,
            prefill: state.aiConfig.prefill,
            savedAt: Date.now(),
            templates: state.promptTemplates || [],
            promptOrder: state.promptOrder || [],
            enabledTemplates: state.enabledTemplates || {},
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
    window.renderCharacterList = renderCharacterList;
    window.renderWorldBookList = renderWorldBookList;

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
            writingReference: state.writingReference || {},
            aiConfig: { ...state.aiConfig, apiKey: '', maxContext: 0 },
            activeSessionId: state.activeSessionId,
        };
    }

    async function saveWorkspaceState({ silent = false } = {}) {
        if (!state.workspaceLoaded || !state.currentNovel?.id) return;
        const workspace = serializeWorkspace();
        saveStateToLocal(workspace);
        try {
            const response = await fetch(`/api/save/workspace/${encodeURIComponent(state.currentNovel.id)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(workspace),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
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

    function saveStateToLocal(workspace = serializeWorkspace()) {
        if (!state.workspaceLoaded || !state.currentNovel?.id) return;
        try {
            localStorage.setItem(workspaceStorageKey(), JSON.stringify({
                ...workspace,
                savedAt: Date.now(),
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

    async function loadSessions(preferredId) {
        if (!state.currentNovel?.id || typeof ChatPanel === 'undefined') return;
        const response = await fetch(`/api/sessions?novelId=${encodeURIComponent(state.currentNovel.id)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
        if (!state.sessions.length) {
            await createChatSession({ initial: true });
            return;
        }
        const target = state.sessions.find(session => session.id === preferredId) || state.sessions[0];
        await openChatSession(target.id);
    }

    async function createChatSession({ initial = false } = {}) {
        if (!state.currentNovel?.id || typeof ChatPanel === 'undefined') return;
        if (!initial) await saveActiveSession();
        try {
            const response = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    novelId: state.currentNovel.id,
                    name: '新会话',
                }),
            });
            const session = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(session.error || `HTTP ${response.status}`);
            state.sessions = [session, ...state.sessions.filter(item => item.id !== session.id)];
            state.activeSessionId = session.id;
            state.activeSessionName = session.name;
            ChatPanel.clearChat();
            ChatPanel.renderSessionList(state.sessions, session.id);
            ChatPanel.setActiveSession(session.id);
            saveWorkspaceState({ silent: true }).catch(() => {});
        } catch (err) {
            setStatus(`新建会话失败: ${err.message}`, 'error');
        }
    }

    async function openChatSession(id) {
        if (!id || !state.currentNovel?.id || typeof ChatPanel === 'undefined') return;
        const response = await fetch(`/api/sessions/${encodeURIComponent(id)}?novelId=${encodeURIComponent(state.currentNovel.id)}`);
        const session = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(session.error || `HTTP ${response.status}`);
        state.activeSessionId = session.id;
        state.activeSessionName = session.name || '新会话';
        ChatPanel.loadMessages(sessionMessages(session));
        ChatPanel.renderSessionList(state.sessions, session.id);
        ChatPanel.setActiveSession(session.id);
    }

    async function switchChatSession(id) {
        if (!id || id === state.activeSessionId) return;
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
            const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ novelId: state.currentNovel.id }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
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
        const messages = ChatPanel.getMessages();
        const response = await fetch(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                novelId: state.currentNovel.id,
                name: state.activeSessionName || '新会话',
                mode: ChatPanel.getActiveMode(),
                messages,
            }),
        });
        const session = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(session.error || `HTTP ${response.status}`);
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
                }),
                keepalive: true,
            }).catch(() => {});
        }
    }

    // Debounced auto-save (fires 2s after last edit)
    const autoSave = debounce(async () => {
        saveStateToLocal();
        if (state.isDirty && !await onSave({ silent: true })) return;
        await saveWorkspaceState({ silent: true }).catch(() => {});
        $('#status-save').textContent = '已自动保存';
        setTimeout(() => { if ($('#status-save')) $('#status-save').textContent = '已保存'; }, 2000);
    }, () => state.appSettings.autoSaveDelay);

    // Expose autoSave for manual triggers
    window.autoSaveEditor = autoSave;
    window.saveWorkspaceState = saveWorkspaceState;
    window.saveStateToLocal = saveStateToLocal;

    // ==================== Start ====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
