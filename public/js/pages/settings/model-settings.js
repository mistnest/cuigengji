/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
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
            const data = await Repositories.providers.detectProxy();
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
            const data = await Repositories.providers.testConnection(
                safeAiConfig(),
                state.presetName || '__default__',
            );
            if (data.success) {
                status.textContent = `✅ 连接成功 (${data.model || 'OK'})`;
            } else {
                status.textContent = `❌ 连接失败: ${data.error || 'Unknown error'}`;
            }
        } catch (err) {
            status.textContent = `❌ 测试失败: ${err.message}`;
        }
    });
}

async function fetchModels() {
    try {
        setStatus('\u6b63\u5728\u83b7\u53d6\u6a21\u578b\u5217\u8868...', 'loading');
        const data = await Repositories.providers.listModels(
            safeAiConfig(),
            state.presetName || '__default__',
        );
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

async function onTestConnection() {
    const apiKey = $('#ai-api-key').value.trim();
    state.aiConfig.provider = $('#ai-provider').value;
    state.aiConfig.apiKey = '';
    state.aiConfig.endpoint = $('#ai-endpoint').value.trim();
    state.aiConfig.model = $('#ai-model').value.trim();
    saveConfig();
    setStatus('正在测试连接...', 'loading');
    try {
        if (apiKey) {
            await saveAiSecret(apiKey);
            $('#ai-api-key').value = '';
        }
        const data = await Repositories.providers.testConnection(
            safeAiConfig(),
            state.presetName || '__default__',
        );
        state.isConnected = data.success;
        if (data.success) {
            setPreference('selectedProvider', state.aiConfig.provider);
            setPreference('connectedProvider', state.aiConfig.provider);
            rememberLastSuccessfulAiConfig();
        } else if (Preferences.get('connectedProvider', '') === state.aiConfig.provider) {
            removePreference('connectedProvider');
        }
        updateStatusBar();
        setStatus(data.success ? '\u8fde\u63a5\u6210\u529f' : `\u8fde\u63a5\u5931\u8d25: ${data.error}`, data.success ? 'success' : 'error');
        return;
    } catch (err) {
        state.isConnected = false;
        if (Preferences.get('connectedProvider', '') === state.aiConfig.provider) {
            removePreference('connectedProvider');
        }
        updateStatusBar();
        setStatus(`连接失败: ${err.message}`, 'error');
    }
}

// ==================== Chapter Management ====================

function onProviderChange() {
    state.aiConfig.provider = $('#ai-provider').value;
    setPreference('selectedProvider', state.aiConfig.provider);
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
        setStatus('出于安全考虑，已保存的 API Key 不支持回显；可直接粘贴新密钥覆盖。', 'warn');
        return;
    }
    setApiKeyVisibility(true);
}

function onConfigChange() {
    const apiKey = $('#ai-api-key').value.trim();
    state.aiConfig.apiKey = '';
    state.aiConfig.endpoint = $('#ai-endpoint').value;
    state.aiConfig.model = $('#ai-model').value;
    state.aiConfig.temperature = parseFloat($('#ai-temperature').value);
    state.aiConfig.maxTokensPct = parseInt($('#ai-max-tokens').value) || 5;
    state.aiConfig.maxTokens = Math.round(getModelContextLimit() * state.aiConfig.maxTokensPct / 100);
    state.aiConfig.topP = parseFloat($('#ai-top-p').value);
    saveConfig();
    if (apiKey) saveAiSecret(apiKey)
        .then(() => { $('#ai-api-key').value = ''; })
        .catch(err => setStatus(`API Key 保存失败: ${err.message}`, 'error'));
}

async function saveAiSecret(apiKey) {
    await saveSecretForProvider(state.aiConfig.provider, apiKey);
    state.hasSavedApiKey = true;
    $('#ai-api-key').placeholder = 'API Key 已安全保存到本机';
    updateStatusBar();
}

async function loadAiSecretStatus(preferDeepseek = false) {
    const profile = state.presetName || '__default__';

    // Try the current provider first, then fall back to last-connected provider
    const providersToTry = [];
    const currentProvider = state.aiConfig.provider;
    const lastConnected = Preferences.get('connectedProvider', '');
    if (currentProvider) providersToTry.push(currentProvider);
    if (lastConnected && lastConnected !== currentProvider) providersToTry.push(lastConnected);
    if (preferDeepseek && !providersToTry.includes('deepseek')) providersToTry.push('deepseek');

    state.hasSavedApiKey = false;
    state.isConnected = false;

    for (const provider of providersToTry) {
        try {
            const data = await Repositories.settings.secretStatus(provider, profile);
            if (data.hasKey) {
                // Found a saved key for this provider
                state.hasSavedApiKey = true;
                state.isConnected = Preferences.get('connectedProvider', '') === provider;
                // Restore this provider as the active one if different from current
                if (provider !== state.aiConfig.provider) {
                    state.aiConfig.provider = provider;
                    const saved = Preferences.get('lastSuccessfulAiConfig', {});
                    if (saved.provider === provider && saved.model) {
                        state.aiConfig.model = saved.model;
                        state.aiConfig.endpoint = saved.endpoint || '';
                    }
                    applyConfigToUI();
                }
                $('#ai-api-key').placeholder = 'API Key 已安全保存到本机';
                setPreference('selectedProvider', provider);
                break;  // Use the first provider that has a key
            }
        } catch (err) {
            console.warn('[loadAiSecretStatus] Failed to check provider', provider, err.message);
        }
    }

    if (state.aiConfig.provider === 'google-vertex') {
        const vertexStatus = await Repositories.settings.secretStatus(
            'google-vertex-service-account',
            profile,
        ).catch(() => ({ hasKey: false }));
        state.hasSavedVertexServiceAccount = Boolean(vertexStatus.hasKey);
    } else {
        state.hasSavedVertexServiceAccount = false;
    }

    updateStatusBar();
}

function saveSecretForProvider(provider, secret) {
    return Repositories.settings.saveSecret(
        provider,
        state.presetName || '__default__',
        secret,
    );
}

function safeAiConfig() {
    const config = { ...state.aiConfig };
    delete config.apiKey;
    delete config.vertexServiceAccountJson;
    return config;
}

function hasConfiguredAiCredentials() {
    if (state.aiConfig.provider === 'ollama') return true;
    if (state.hasSavedApiKey) return true;
    return state.aiConfig.provider === 'google-vertex'
        && String(state.aiConfig.vertexAuthMode || 'express') === 'full'
        && state.hasSavedVertexServiceAccount;
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
