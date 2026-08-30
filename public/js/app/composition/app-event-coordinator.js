/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
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
    $('#btn-import-preset').addEventListener('click', () => importPreset());
    $('#btn-save-preset').addEventListener('click', () => saveCurrentAsPreset());
    $('#btn-export-preset')?.addEventListener('click', exportPreset);
    $('#btn-fetch-models')?.addEventListener('click', fetchModels);
    $('#btn-add-prompt-template')?.addEventListener('click', addPromptTemplate);
    $('#btn-edit-prompt-templates')?.addEventListener('click', () => openPromptEditor());
    $('#btn-import-preset-inline')?.addEventListener('click', () => importPreset());
    $('#prompt-template-search')?.addEventListener('input', filterPromptTemplates);

    // Load preset button — apply selected preset
    const btnLoadPreset = $('#btn-load-preset');
    if (btnLoadPreset) btnLoadPreset.addEventListener('click', () => {
        const name = $('#ai-preset').value;
        if (!name) { setStatus('请先选择一个配置方案', 'warn'); return; }
        const preset = canonicalizePresetForState(state.presets[name]);
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
        if (preset.templates) state.promptTemplates = preset.templates;
        if (preset.promptOrder) state.promptOrder = preset.promptOrder;
        if (preset.enabledTemplates) state.enabledTemplates = preset.enabledTemplates;
        if (preset.regexBindings) state.regexBindings = preset.regexBindings;
        updateRegexDisplay();

        state.presetName = name;
        setPreference('selectedProvider', state.aiConfig.provider);
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
    const vertexSecretInput = $('#ai-vertex-service-account-json');
    vertexSecretInput?.addEventListener('input', debounce(async () => {
        const secret = vertexSecretInput.value.trim();
        state.aiConfig.vertexServiceAccountJson = '';
        if (!secret) return;
        try {
            await saveSecretForProvider('google-vertex-service-account', secret);
            state.hasSavedVertexServiceAccount = true;
            vertexSecretInput.value = '';
            vertexSecretInput.placeholder = 'Service Account JSON 已安全保存到本机';
            const status = $('#ai-vertex-service-account-status');
            if (status) status.textContent = 'Service Account JSON 已安全保存';
            saveConfig();
        } catch (err) {
            setStatus(`Service Account JSON 保存失败: ${err.message}`, 'error');
        }
    }, 500));
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

    // Editor
    $('#chapter-editor').addEventListener('input', onEditorInput);
    $('#chapter-title-input').addEventListener('input', onTitleChange);
    $('#chapter-select').addEventListener('change', onChapterSelect);

    // Chapter ops
    $('#btn-add-chapter').addEventListener('click', onAddChapter);
    $('#btn-add-volume').addEventListener('click', onAddVolume);

    // World book
    $('#btn-import-wb').addEventListener('click', () => importWorldBook());
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
    $('#btn-import-character').addEventListener('click', () => importCharacters());
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

    // Save on page unload
    window.addEventListener('beforeunload', () => {
        persistBeforeUnload();
    });

    // Periodic auto-save (every 30 seconds)
    setInterval(() => {
        saveWorkspaceState({ silent: true }).catch(() => {});
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
