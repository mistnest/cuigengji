/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function ensureBuiltinPreset() {
    // 仅在没有任何预设和提示模板时注入内置预设（首次创建工作区）
    if (Object.keys(state.presets).length > 0 || state.promptTemplates.length > 0) return;
    if (!window.__CUIGENGJI_BUILTIN_PRESET__) return;

    const data = window.__CUIGENGJI_BUILTIN_PRESET__;
    state.importedPreset = data;

    // 预设只保留有实际内容的写作规则。外部格式的 marker 是结构元数据，
    // 不进入催更姬唯一的上下文编排。
    const isConfigTemplate = (p) => {
        const n = (p.name || '').toLowerCase();
        const c = (p.content || '').toLowerCase();
        return n.includes('spreset') || n.includes('regex') || n.includes('macro')
            || c.includes('"chatsquash"') || c.includes('"regexbinding"')
            || c.includes('"toolbindings"') || c.includes('"macronest"')
            || c.includes('window.spresettempdata') || c.includes('window.sillytavern');
    };
    if (Array.isArray(data.prompts)) {
        state.promptTemplates = data.prompts
            .filter(p => p.content?.trim() && !p.marker && !p.isMarker && !isConfigTemplate(p))
            .map(p => ({
                identifier: p.identifier || '',
                name: p.name || p.identifier || '',
                role: p.role || 'system',
                content: p.content || '',
                isSystemPrompt: !!p.isSystemPrompt,
                isMarker: false,
                markerId: '',
                enabled: p.enabled !== false && p.disabled !== true,
            }));
    }

    if (Array.isArray(data.prompt_order)) {
        state.promptOrder = data.prompt_order
            .filter(o => state.promptTemplates.some(t => t.identifier === o.identifier))
            .map(o => ({ identifier: o.identifier, enabled: o.enabled !== false }));
    }

    // Preserve the preset's explicit enabled/disabled state.  The builtin
    // file contains intentionally disabled experimental modes; dropping that
    // bit here would make them enter every Agent prompt after the first save.
    state.enabledTemplates = buildPresetEnabledTemplates(data, state.promptTemplates || []);

    state.presetName = data.name || '催更姬_v1.0';
    console.log('📦 已加载内置预设:', state.presetName);
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
    if (!safeConfirm(`删除选中的 ${ids.size} 个模板？`)) return;
    state.promptTemplates = state.promptTemplates.filter(template => !ids.has(template.identifier));
    ids.forEach(id => {
        delete state.enabledTemplates[id];
        delete state.selectedPromptTemplates[id];
    });
    renderPromptTemplates();
    autoSave();
}

// ==================== Global Tooltip ====================

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
            if (!safeConfirm('确认删除模板 "' + tmpl.name + '"？')) return;
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
            </div>
            <div class="preset-prompt-content">${escHtml(t.content.substring(0, 350))}${t.content.length > 350 ? '…' : ''}</div>
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
                这些预设规则定义 AI 的写作文风、格式与验收要求；项目资料使用统一上下文提供。
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

// Expose state and render functions used by focused feature modules.
window.editorState = state;
window.enterWorkspace = enterWorkspace;
window.renderCharacterList = renderCharacterList;
window.renderWorldBookList = renderWorldBookList;
window.getChapterWindowAnchor = () => ensureChapterWindowAnchor();
window.refreshChapterWindowAnchor = (reason) => refreshChapterWindowAnchor(reason);

// ==================== Persistence ====================
