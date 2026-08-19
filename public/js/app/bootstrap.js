/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
async function init() {
    await Preferences.load().catch(error => {
        console.warn('[Preferences] Failed to load:', error.message);
    });
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
    bindAgentWorkbench();
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

// ==================== Start ====================
const start = () => {
    void init().catch(error => {
        console.error('[Startup] Renderer initialization failed:', error);
        setStatus(`启动失败: ${error.message}`, 'error');
    });
};
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}
