/**
 * Novel AI Editor — Main Application
 * 前端应用入口 — 整合所有模块
 */
(function () {
    'use strict';

    // ==================== State ====================
    const state = {
        currentNovel: { id: 'default', title: '未命名小说' },
        currentChapter: null,
        chapters: [],
        outline: [],
        worldBook: { entries: {} },
        characters: [],
        presets: [],
        aiConfig: {
            provider: 'anthropic',
            apiKey: '',
            endpoint: '',
            model: 'claude-sonnet-4-6',
            temperature: 0.7,
            maxTokens: 4096,
            topP: 0.9,
        },
        isDirty: false,
        isConnected: false,
        isGenerating: false,
    };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ==================== Initialization ====================
    function init() {
        loadConfig();
        applyConfigToUI();
        loadLastPreset();         // Load the last used preset
        loadSavedState();         // Restore world book, characters, etc.
        bindEvents();
        renderWorldBookList();
        renderCharacterList();
        renderPromptTemplates();
        loadChatHistory();
        updatePresetSelect();
        updateStatusBar();
        console.log('📖 Novel AI Editor v0.1.0 — Ready (状态已恢复)');
        setStatus('就绪 — 开始创作吧!', 'info');
    }

    function loadConfig() {
        try {
            const saved = localStorage.getItem('novel-ai-editor-config');
            if (saved) Object.assign(state.aiConfig, JSON.parse(saved));
        } catch (e) { /* ignore */ }
    }

    function saveConfig() {
        localStorage.setItem('novel-ai-editor-config', JSON.stringify(state.aiConfig));
    }

    function applyConfigToUI() {
        const c = state.aiConfig;
        $('#ai-provider').value = c.provider;
        $('#ai-api-key').value = c.apiKey;
        $('#ai-endpoint').value = c.endpoint;
        $('#ai-model').value = c.model;
        $('#ai-temperature').value = c.temperature;
        $('#ai-max-tokens').value = c.maxTokens;
        $('#ai-top-p').value = c.topP;
        updateRangeLabels();
        updateProviderUI();
    }

    // ==================== Event Bindings ====================
    function bindEvents() {
        // Toolbar
        $('#btn-new-novel').addEventListener('click', onNewNovel);
        $('#btn-save').addEventListener('click', onSave);
        $('#btn-import').addEventListener('click', toggleImportMenu);
        $('#btn-settings').addEventListener('click', () => setStatus('设置面板开发中...', 'info'));

        // AI buttons
        $('#btn-continue').addEventListener('click', onContinue);
        $('#btn-plot-suggestions').addEventListener('click', onPlotSuggestions);
        $('#btn-inspire').addEventListener('click', onInspire);
        $('#btn-test-connection').addEventListener('click', onTestConnection);
        $('#btn-import-preset').addEventListener('click', () => $('#file-input-preset').click());
        $('#btn-save-preset').addEventListener('click', () => saveCurrentAsPreset());

        // Preset select → apply selected preset
        $('#ai-preset').addEventListener('change', () => {
            const name = $('#ai-preset').value;
            if (!name) return;
            const savedPresets = JSON.parse(localStorage.getItem('novel-editor-saved-presets') || '{}');
            const preset = savedPresets[name];
            if (!preset) return;

            if (preset.provider) state.aiConfig.provider = preset.provider;
            if (preset.model) state.aiConfig.model = preset.model;
            if (preset.temperature !== undefined) state.aiConfig.temperature = preset.temperature;
            if (preset.maxTokens) state.aiConfig.maxTokens = preset.maxTokens;
            if (preset.topP !== undefined) state.aiConfig.topP = preset.topP;
            if (preset.topK !== undefined) state.aiConfig.topK = preset.topK;
            if (preset.prefill) state.aiConfig.prefill = preset.prefill;
            if (preset.templates) state.promptTemplates = preset.templates;
            if (preset.enabledTemplates) state.enabledTemplates = preset.enabledTemplates;

            state.presetName = name;
            localStorage.setItem('novel-editor-active-preset', name);
            applyConfigToUI();
            saveConfig();
            updatePresetNameDisplay(name);
            renderPromptTemplates();
            setStatus(`✅ 已加载预设: ${name}`, 'success');
        });
        $('#btn-ai-generate').addEventListener('click', onContinue);
        $('#btn-ai-plot').addEventListener('click', onPlotSuggestions);

        // AI config
        $('#ai-provider').addEventListener('change', onProviderChange);
        $('#ai-api-key').addEventListener('input', debounce(onConfigChange, 500));
        $('#ai-endpoint').addEventListener('input', debounce(onConfigChange, 500));
        $('#ai-model').addEventListener('input', debounce(onConfigChange, 500));
        $('#ai-temperature').addEventListener('input', () => { onConfigChange(); updateRangeLabels(); });
        $('#ai-max-tokens').addEventListener('input', () => { onConfigChange(); updateRangeLabels(); });
        $('#ai-top-p').addEventListener('input', () => { onConfigChange(); updateRangeLabels(); });

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

        // Editor
        $('#chapter-editor').addEventListener('input', onEditorInput);
        $('#chapter-title-input').addEventListener('input', onTitleChange);
        $('#chapter-select').addEventListener('change', onChapterSelect);

        // Chapter ops
        $('#btn-add-chapter').addEventListener('click', onAddChapter);
        $('#btn-add-volume').addEventListener('click', onAddVolume);

        // World book
        $('#btn-import-wb').addEventListener('click', () => $('#file-input-worldbook').click());
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
        $('#btn-add-character').addEventListener('click', () => setStatus('角色编辑器开发中...', 'info'));

        // Outline
        $('#btn-add-outline-node').addEventListener('click', onAddOutlineNode);

        // Keyboard
        document.addEventListener('keydown', onKeyboard);

        // Custom events
        document.addEventListener('inspire:refresh', onInspire);

        // Chat panel
        if (typeof ChatPanel !== 'undefined') {
            ChatPanel.init();
        }

        // Save on page unload
        window.addEventListener('beforeunload', () => {
            saveStateToLocal();
            saveChatHistory();
        });

        // Periodic auto-save (every 30 seconds)
        setInterval(() => {
            saveStateToLocal();
            saveChatHistory();
        }, 30000);

        // Resizable panels
        if (typeof ResizablePanels !== 'undefined') {
            ResizablePanels.init();
        }

        // Chapter tree events
        if (typeof ChapterTree !== 'undefined') {
            ChapterTree.on('select', onChapterTreeSelect);
            ChapterTree.on('rename', onChapterTreeRename);
        }
    }

    // ==================== AI Actions ====================
    async function onContinue() {
        const text = $('#chapter-editor').value;
        if (!text.trim()) { setStatus('请先编写正文再续写', 'warn'); return; }
        if (!state.aiConfig.apiKey && state.aiConfig.provider !== 'ollama') {
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
                    worldBook: state.worldBook,
                    characters: state.characters,
                    outline: getIncompleteOutline(),
                    styleGuide: state.currentNovel?.styleGuide || '',
                }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
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
        if (!state.aiConfig.apiKey && state.aiConfig.provider !== 'ollama') {
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
                    worldBook: state.worldBook,
                    characters: state.characters,
                    outline: getIncompleteOutline(),
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
                    worldBook: state.worldBook,
                    characters: state.characters,
                }),
            });

            const data = await response.json();
            PlotCandidates.showInspiration(data);
            setStatus('灵感已生成', 'success');
        } catch (err) {
            setStatus(`灵感生成失败: ${err.message}`, 'error');
        } finally {
            state.isGenerating = false;
        }
    }

    async function onTestConnection() {
        setStatus('正在测试连接...', 'loading');
        try {
            const response = await fetch('/api/ai/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: state.aiConfig }),
            });
            const data = await response.json();
            state.isConnected = data.success;
            updateStatusBar();
            setStatus(data.success ? '✅ 连接成功!' : `❌ ${data.error}`, data.success ? 'success' : 'error');
        } catch (err) {
            state.isConnected = false;
            updateStatusBar();
            setStatus(`连接失败: ${err.message}`, 'error');
        }
    }

    // ==================== Chapter Management ====================
    async function onAddChapter() {
        const title = `第${state.chapters.filter(c => c.type !== 'volume').length + 1}章`;
        try {
            const resp = await fetch('/api/chapters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ novelId: state.currentNovel.id, title, content: '' }),
            });
            const chapter = await resp.json();
            state.chapters.push(chapter);
            state.currentChapter = chapter;
            refreshChapterTree();
            loadChapter(chapter);
            setStatus(`已创建: ${title}`, 'success');
        } catch (err) {
            setStatus(`创建章节失败: ${err.message}`, 'error');
        }
    }

    function onAddVolume() {
        const vol = {
            id: `vol_${Date.now()}`,
            title: `第${state.chapters.filter(c => c.type === 'volume').length + 1}卷`,
            type: 'volume',
        };
        state.chapters.push(vol);
        refreshChapterTree();
        setStatus(`已创建: ${vol.title}`, 'success');
    }

    function onChapterSelect(e) {
        const id = e.target.value;
        if (!id) return;
        const ch = state.chapters.find(c => c.id === id);
        if (ch) loadChapter(ch);
    }

    function loadChapter(chapter) {
        state.currentChapter = chapter;
        $('#chapter-editor').value = chapter.content || '';
        $('#chapter-title-input').value = chapter.title || '';
        $('#current-chapter-title').textContent = `— ${chapter.title || '无标题'}`;
        updateWordCount();
        refreshChapterTree();
        setStatus(`已加载: ${chapter.title}`, 'info');
    }

    async function onSave() {
        if (!state.currentChapter) {
            // Create a new chapter if none exists
            await onAddChapter();
            return;
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
            const updated = await resp.json();

            // Update local state
            const idx = state.chapters.findIndex(c => c.id === ch.id);
            if (idx >= 0) state.chapters[idx] = updated;
            state.currentChapter = updated;
            state.isDirty = false;
            $('#status-save').textContent = '已保存';
            refreshChapterTree();
            setStatus('已保存', 'success');
        } catch (err) {
            setStatus(`保存失败: ${err.message}`, 'error');
        }
    }

    function refreshChapterTree() {
        if (typeof ChapterTree !== 'undefined') {
            ChapterTree.render(state.chapters, state.currentChapter?.id);
        }
    }

    function onChapterTreeSelect(id) {
        const ch = state.chapters.find(c => c.id === id);
        if (ch) loadChapter(ch);
    }

    function onChapterTreeRename(id) {
        const ch = state.chapters.find(c => c.id === id);
        if (!ch) return;
        const newTitle = prompt('重命名章节:', ch.title);
        if (newTitle && newTitle !== ch.title) {
            ch.title = newTitle;
            if (state.currentChapter?.id === id) {
                $('#chapter-title-input').value = newTitle;
                $('#current-chapter-title').textContent = `— ${newTitle}`;
            }
            refreshChapterTree();
        }
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
                <div class="item-title">${stateIcon} ${escHtml(name)}</div>
                ${kwHtml}
                <div class="item-status ${stateClass}">${stateLabel}</div>
            </div>`;
        }).join('');

        // Click → show detail
        list.querySelectorAll('.wb-entry').forEach(el => {
            el.addEventListener('click', () => {
                const uid = el.dataset.uid;
                const entry = state.worldBook.entries[uid];
                if (entry) showWorldBookDetail(uid, entry);
            });
        });
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
                        <input type="text" class="wb-edit-input" id="wb-edit-group" value="${escHtml(entry.group || '')}" placeholder="留空则不分组">
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
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.index);
                if (!isNaN(idx) && state.characters[idx]) {
                    showCharacterDetail(state.characters[idx], idx);
                }
            });
        });
    }

    function showCharacterDetail(ch, idx) {
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
            localStorage.setItem('novel-editor-active-preset', file.name);
            updatePresetNameDisplay(file.name);

            // Summary
            const promptCount = state.promptTemplates?.length || 0;
            setStatus(`✅ 导入预设: T=${state.aiConfig.temperature} | Tokens=${state.aiConfig.maxTokens} | Prompt模板=${promptCount}个`, 'success');

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
            section.style.display = 'none';
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
            return `<div class="prompt-template-toggle-item ${enabled ? '' : 'disabled'}">
                <label class="prompt-toggle-label">
                    <input type="checkbox" class="prompt-toggle-check" data-id="${escHtml(t.identifier)}" ${enabled ? 'checked' : ''}>
                    <span class="prompt-toggle-name">${escHtml(t.name)}</span>
                    ${t.isMarker ? '<span class="prompt-toggle-badge marker">m</span>' : ''}
                </label>
                ${t.content ? `<div class="prompt-toggle-preview">${escHtml(t.content.substring(0, 80))}${t.content.length > 80 ? '…' : ''}</div>` : '<div class="prompt-toggle-preview" style="color:var(--text-muted);font-style:italic">占位标记</div>'}
            </div>`;
        }).join('');

        // Bind toggle events
        list.querySelectorAll('.prompt-toggle-check').forEach(cb => {
            cb.addEventListener('change', () => {
                state.enabledTemplates[cb.dataset.id] = cb.checked;
                saveConfig();
                const item = cb.closest('.prompt-template-toggle-item');
                if (item) item.classList.toggle('disabled', !cb.checked);
            });
            // Stop dblclick on checkbox from triggering preview
            cb.addEventListener('dblclick', (e) => e.stopPropagation());
        });

        // Double-click to view full content
        list.querySelectorAll('.prompt-template-toggle-item').forEach(item => {
            item.addEventListener('dblclick', (e) => {
                const cb = item.querySelector('.prompt-toggle-check');
                if (!cb) return;
                const id = cb.dataset.id;
                const template = state.promptTemplates.find(t => t.identifier === id);
                if (template) showPromptTemplateDetail(template);
            });
        });
    }

    function showPromptTemplateDetail(template) {
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'plot-modal';
        const content = template.content || '(占位标记 — 运行时由系统自动替换)';
        const roleBadge = template.role ? `<span class="preset-prompt-badge">${escHtml(template.role)}</span>` : '';
        const sysBadge = template.isSystemPrompt ? '<span class="preset-prompt-badge sys">system prompt</span>' : '';
        const markerBadge = template.isMarker ? '<span class="preset-prompt-badge marker">marker</span>' : '';

        modal.innerHTML = `
            <div class="plot-modal-header">
                <h3>📋 ${escHtml(template.name)}</h3>
                <div style="display:flex;gap:6px;">${roleBadge}${sysBadge}${markerBadge}</div>
                <button class="plot-modal-close">✕</button>
            </div>
            <div class="plot-modal-body" style="display:block;max-height:60vh;overflow-y:auto;padding:20px;">
                <div class="preset-prompt-identifier">标识符: <code>${escHtml(template.identifier)}</code></div>
                <div style="margin-top:12px;font-size:14px;line-height:1.8;white-space:pre-wrap;font-family:var(--font-sans);color:var(--text-primary);background:var(--bg-primary);padding:16px;border-radius:8px;border:1px solid var(--border-color);">${escHtml(content)}</div>
            </div>
            <div class="plot-modal-footer">
                <button class="plot-btn-cancel detail-close">关闭</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.plot-modal-close').addEventListener('click', close);
        overlay.querySelector('.detail-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        requestAnimationFrame(() => overlay.classList.add('active'));
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

        tree.innerHTML = state.outline.map((n, i) => `
            <div class="tree-item outline-node" data-id="${n.id}">
                <span class="outline-check">${n.completed ? '✅' : '⬜'}</span>
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

    // ==================== Config Handlers ====================
    function onProviderChange() {
        state.aiConfig.provider = $('#ai-provider').value;
        saveConfig();
        updateProviderUI();
        state.isConnected = false;
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
            deepseek: 'deepseek-chat',
            openrouter: 'anthropic/claude-sonnet-4-6',
            ollama: 'llama3',
        };
        const currentModel = $('#ai-model').value;
        if (!currentModel || Object.values(defaultModels).includes(currentModel)) {
            $('#ai-model').value = defaultModels[provider] || '';
        }
    }

    function onConfigChange() {
        state.aiConfig.apiKey = $('#ai-api-key').value;
        state.aiConfig.endpoint = $('#ai-endpoint').value;
        state.aiConfig.model = $('#ai-model').value;
        state.aiConfig.temperature = parseFloat($('#ai-temperature').value);
        state.aiConfig.maxTokens = parseInt($('#ai-max-tokens').value);
        state.aiConfig.topP = parseFloat($('#ai-top-p').value);
        saveConfig();
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

    function updateContextInfo(ctx, memory) {
        // Update token usage
        if (ctx) {
            $('#context-usage').textContent = `${ctx.used || 0} / ${ctx.totalBudget || 0}`;
        }

        // Update memory stats
        if (memory?.stats) {
            const s = memory.stats;
            $('#active-wb-count').textContent = s.byType?.world_entry || 0;
            $('#active-char-count').textContent = s.byType?.character || 0;
            $('#memory-tokens').textContent = `${s.totalTokens || 0} / ${s.budget || 3000}`;
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
    }

    function onTitleChange() {
        state.isDirty = true;
        $('#current-chapter-title').textContent = `— ${$('#chapter-title-input').value || '无标题'}`;
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
        switch (action) {
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
    function onNewNovel() {
        if (state.isDirty && !confirm('未保存的更改将丢失，确认新建？')) return;
        state.chapters = [];
        state.outline = [];
        state.currentChapter = null;
        state.isDirty = false;
        $('#chapter-editor').value = '';
        $('#chapter-title-input').value = '';
        $('#current-novel-title').textContent = '未命名小说';
        $('#current-chapter-title').textContent = '— 无章节';
        refreshChapterTree();
        renderOutlineTree();
        updateWordCount();
        setStatus('已新建小说', 'success');
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
    }

    // ==================== Utils ====================
    function debounce(fn, delay) {
        let t;
        return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), delay); };
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

    function escHtml(str) {
        if (!str) return '';
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }

    // ==================== Preset Management ====================

    function saveCurrentAsPreset() {
        const name = prompt('预设名称:', state.presetName || '我的预设');
        if (!name) return;

        const preset = {
            name,
            provider: state.aiConfig.provider,
            model: state.aiConfig.model,
            temperature: state.aiConfig.temperature,
            maxTokens: state.aiConfig.maxTokens,
            topP: state.aiConfig.topP,
            topK: state.aiConfig.topK,
            frequencyPenalty: state.aiConfig.frequencyPenalty,
            presencePenalty: state.aiConfig.presencePenalty,
            stream: state.aiConfig.stream,
            prefill: state.aiConfig.prefill,
            savedAt: Date.now(),
            templates: state.promptTemplates || [],
            enabledTemplates: state.enabledTemplates || {},
        };

        // Save to localStorage
        const savedPresets = JSON.parse(localStorage.getItem('novel-editor-saved-presets') || '{}');
        savedPresets[name] = preset;
        localStorage.setItem('novel-editor-saved-presets', JSON.stringify(savedPresets));

        // Also save to disk
        fetch('/api/save/preset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data: preset }),
        }).catch(() => {});

        state.presetName = name;
        localStorage.setItem('novel-editor-active-preset', name);
        updatePresetNameDisplay(name);
        updatePresetSelect();

        setStatus(`✅ 预设已保存: ${name}`, 'success');
    }

    function updatePresetNameDisplay(name) {
        const el = document.getElementById('current-preset-name');
        if (el) el.textContent = name ? `当前预设: ${name}` : '';
    }

    function updatePresetSelect() {
        const select = document.getElementById('ai-preset');
        if (!select) return;
        const savedPresets = JSON.parse(localStorage.getItem('novel-editor-saved-presets') || '{}');
        select.innerHTML = '<option value="">— 选择预设 —</option>';
        Object.entries(savedPresets).forEach(([name]) => {
            select.innerHTML += `<option value="${escHtml(name)}" ${name === state.presetName ? 'selected' : ''}>${escHtml(name)}</option>`;
        });
    }

    function loadLastPreset() {
        const activeName = localStorage.getItem('novel-editor-active-preset');
        if (!activeName) return;
        const savedPresets = JSON.parse(localStorage.getItem('novel-editor-saved-presets') || '{}');
        const preset = savedPresets[activeName];
        if (!preset) return;

        // Apply preset config
        if (preset.provider) state.aiConfig.provider = preset.provider;
        if (preset.model) state.aiConfig.model = preset.model;
        if (preset.temperature !== undefined) state.aiConfig.temperature = preset.temperature;
        if (preset.maxTokens) state.aiConfig.maxTokens = preset.maxTokens;
        if (preset.topP !== undefined) state.aiConfig.topP = preset.topP;
        if (preset.topK !== undefined) state.aiConfig.topK = preset.topK;
        if (preset.frequencyPenalty !== undefined) state.aiConfig.frequencyPenalty = preset.frequencyPenalty;
        if (preset.presencePenalty !== undefined) state.aiConfig.presencePenalty = preset.presencePenalty;
        if (preset.prefill) state.aiConfig.prefill = preset.prefill;
        if (preset.templates) state.promptTemplates = preset.templates;
        if (preset.enabledTemplates) state.enabledTemplates = preset.enabledTemplates;

        state.presetName = activeName;
        applyConfigToUI();
        updatePresetNameDisplay(activeName);
        updatePresetSelect();
        renderPromptTemplates();
    }

    // Expose state and render functions for chat-panel.js
    window.editorState = state;
    window.renderCharacterList = renderCharacterList;
    window.renderWorldBookList = renderWorldBookList;

    // ==================== Persistence ====================

    // Auto-save world book to disk after edits
    async function saveWorldBookToDisk() {
        if (!state.worldBook?.entries || !Object.keys(state.worldBook.entries).length) return;
        try {
            await fetch('/api/save/worldbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: state.currentNovel?.id || 'worldbook', data: state.worldBook }),
            });
        } catch (e) { /* silent fail */ }
    }

    // Auto-save characters to disk
    async function saveCharactersToDisk() {
        for (const ch of state.characters) {
            try {
                await fetch('/api/save/character', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: ch }),
                });
            } catch (e) { /* silent fail */ }
        }
    }

    // Load saved state from localStorage
    function loadSavedState() {
        try {
            const saved = localStorage.getItem('novel-editor-state');
            if (!saved) return;
            const parsed = JSON.parse(saved);
            if (parsed.worldBook) state.worldBook = parsed.worldBook;
            if (parsed.characters) state.characters = parsed.characters;
            if (parsed.chapters) state.chapters = parsed.chapters;
            if (parsed.outline) state.outline = parsed.outline;
            if (parsed.promptTemplates) state.promptTemplates = parsed.promptTemplates;
            if (parsed.enabledTemplates) state.enabledTemplates = parsed.enabledTemplates;
            if (parsed.specialPrompts) state.specialPrompts = parsed.specialPrompts;
            if (parsed.formatStrings) state.formatStrings = parsed.formatStrings;
        } catch (e) { /* ignore */ }
    }

    // Save state to localStorage
    function saveStateToLocal() {
        try {
            const toSave = {
                worldBook: state.worldBook,
                characters: state.characters,
                chapters: state.chapters,
                outline: state.outline,
                promptTemplates: state.promptTemplates,
                enabledTemplates: state.enabledTemplates,
                specialPrompts: state.specialPrompts,
                formatStrings: state.formatStrings,
                savedAt: Date.now(),
            };
            localStorage.setItem('novel-editor-state', JSON.stringify(toSave));
        } catch (e) { /* quota exceeded? */ }
    }

    // Chat history persistence
    function saveChatHistory() {
        try {
            if (typeof ChatPanel !== 'undefined' && ChatPanel.getMessages) {
                const msgs = ChatPanel.getMessages();
                localStorage.setItem('novel-editor-chat', JSON.stringify(msgs));
            }
        } catch (e) { /* ignore */ }
    }

    function loadChatHistory() {
        try {
            const saved = localStorage.getItem('novel-editor-chat');
            if (saved && typeof ChatPanel !== 'undefined' && ChatPanel.loadMessages) {
                ChatPanel.loadMessages(JSON.parse(saved));
            }
        } catch (e) { /* ignore */ }
    }

    // Debounced auto-save (fires 2s after last edit)
    const autoSave = debounce(() => {
        saveStateToLocal();
        saveWorldBookToDisk();
        saveCharactersToDisk();
        $('#status-save').textContent = '已自动保存';
        setTimeout(() => { if ($('#status-save')) $('#status-save').textContent = '已保存'; }, 2000);
    }, 2000);

    // Hook auto-save into world book edits (called from showWorldBookDetail save)
    const originalRenderWorldBookList = renderWorldBookList;
    // Override to add auto-save after render
    // (We'll hook it differently — just call autoSave after edits)

    // Expose autoSave for manual triggers
    window.autoSaveEditor = autoSave;
    window.saveWorldBookToDisk = saveWorldBookToDisk;
    window.saveStateToLocal = saveStateToLocal;

    // ==================== Start ====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
