/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
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

function loadAppSettings() {
    const saved = Preferences.get('appSettings', {});
    if (saved && typeof saved === 'object') Object.assign(state.appSettings, saved);
}

function saveAppSettings() {
    setPreference('appSettings', state.appSettings);
}

function loadLastSuccessfulAiConfig() {
    try {
        const saved = Preferences.get('lastSuccessfulAiConfig', {});
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
        presetName: state.presetName || '__default__',
        connectedAt: Date.now(),
    };
    setPreference('lastSuccessfulAiConfig', snapshot);
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
    if (!hasConfiguredAiCredentials()) return;

    autoConnectInFlight = true;
    if (!silent) setStatus('正在自动连接上次成功的模型...', 'loading');
    try {
        const data = await Repositories.providers.testConnection(
            safeAiConfig(),
            state.presetName || '__default__',
        );
        state.isConnected = !!data.success;
        if (data.success) {
            state.hasSavedApiKey = true;
            setPreference('selectedProvider', provider);
            setPreference('connectedProvider', provider);
            rememberLastSuccessfulAiConfig();
            if (!silent) setStatus('已自动连接上次成功的模型', 'success');
        } else {
            if (Preferences.get('connectedProvider', '') === provider) {
                removePreference('connectedProvider');
            }
            if (!silent) setStatus(`自动连接失败: ${data.error || '未知错误'}`, 'warn');
        }
    } catch (err) {
        state.isConnected = false;
        if (Preferences.get('connectedProvider', '') === provider) {
            removePreference('connectedProvider');
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
    removePreference('recentProjectAccess');
    setStatus('已清除最近工作区排序', 'success');
}

function saveConfig() {
    if (!state.workspaceLoaded) return;
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
    updateRangeLabels();
    // 恢复提供商标识字段
    if (c.vertexAuthMode && $('#ai-vertex-auth-mode')) $('#ai-vertex-auth-mode').value = c.vertexAuthMode;
    if (c.vertexRegion && $('#ai-vertex-region')) $('#ai-vertex-region').value = c.vertexRegion;
    if (c.vertexProjectId && $('#ai-vertex-project-id')) $('#ai-vertex-project-id').value = c.vertexProjectId;
    if ($('#ai-vertex-service-account-json')) {
        $('#ai-vertex-service-account-json').value = '';
        $('#ai-vertex-service-account-json').placeholder = state.hasSavedVertexServiceAccount
            ? 'Service Account JSON 已安全保存到本机'
            : '粘贴 service_account JSON，保存后只保存在本机';
    }
    if (c.siliconflowEndpoint && $('#ai-siliconflow-endpoint')) $('#ai-siliconflow-endpoint').value = c.siliconflowEndpoint;
    if (c.minimaxEndpoint && $('#ai-minimax-endpoint')) $('#ai-minimax-endpoint').value = c.minimaxEndpoint;
    if (c.zaiEndpoint && $('#ai-zai-endpoint')) $('#ai-zai-endpoint').value = c.zaiEndpoint;
    updateProviderUI();
}

// ==================== Event Bindings ====================
