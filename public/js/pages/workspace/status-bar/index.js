/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function updateWordCount() {
    const text = $('#chapter-editor').value;
    const chinese = (text.match(/[一-鿿]/g) || []).length;
    const other = (text.match(/[a-zA-Z0-9]+/g) || []).length;
    const total = chinese + other;
    $('#word-count').textContent = `字数: ${total}`;
    $('#status-words').textContent = `字数: ${total}`;
}

// ==================== Import Menu ====================

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
    const credentialsConfigured = hasConfiguredAiCredentials();
    $('#status-connection').textContent = state.isConnected ? '🟢 已连接' : '🔌 未连接';
    $('#status-model').textContent = state.isConnected ? state.aiConfig.model : '—';
    $('#status-save').textContent = state.isDirty || state.workspaceDirty ? '未保存' : '已保存';
    // Connection badge color
    const badge = $('#ai-connection-badge');
    if (badge) {
        badge.textContent = state.isConnected ? '已连接' : credentialsConfigured ? '已配置' : '未连接';
        badge.classList.remove('badge-ok', 'badge-ready', 'badge-off');
        badge.classList.add(state.isConnected ? 'badge-ok' : credentialsConfigured ? 'badge-ready' : 'badge-off');
    }
    // Connection summary
    const summary = $('#ai-connection-summary');
    if (summary) {
        summary.textContent = state.isConnected
            ? `${state.aiConfig.provider} · ${state.aiConfig.model}`
            : credentialsConfigured ? '密钥已保存，点击连接模型' : '配置模型服务';
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
    const vertexStatus = $('#ai-vertex-service-account-status');
    if (vertexStatus) {
        vertexStatus.textContent = state.hasSavedVertexServiceAccount
            ? 'Service Account JSON 已安全保存'
            : '未配置 Service Account JSON';
        vertexStatus.className = `ai-key-status${state.hasSavedVertexServiceAccount ? ' saved' : ''}`;
    }
    const providerLabel = $('#ai-provider option:checked')?.textContent?.trim()
        || state.aiConfig.provider
        || '未选择服务商';
    const quickStatus = $('#ai-quick-status');
    const quickModel = $('#ai-quick-model');
    const quickDetail = $('#ai-quick-detail');
    if (quickStatus) {
        quickStatus.textContent = state.isConnected ? '已连接' : credentialsConfigured ? '已配置' : '未连接';
        quickStatus.className = state.isConnected ? 'is-connected' : credentialsConfigured ? 'is-ready' : '';
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
        && hasConfiguredAiCredentials()
        && state.aiUsed;
    if (onboardingComplete) {
        setPreference('aiOnboardingComplete', true);
    }
    const onboarding = document.getElementById('ai-onboarding');
    const onboardingDone = onboardingComplete || Preferences.get('aiOnboardingComplete', false) === true;
    if (onboarding) onboarding.style.display = onboardingDone ? 'none' : '';
    // Onboarding steps
    $('#onboard-step-1')?.classList.toggle('done', Boolean(state.aiConfig.provider));
    $('#onboard-step-2')?.classList.toggle('done', hasConfiguredAiCredentials());
    $('#onboard-step-3')?.classList.toggle('done', state.aiUsed);
}

// ==================== Regex Editor ====================
let _regexEditorCurrent = null;
let _regexEditorCloseTimer = 0;
