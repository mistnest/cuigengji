/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
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
            if (!safeConfirm(`删除选中的 ${ids.length} 个模板？`)) return;
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
    const details = overlay.querySelector('.wb-external-config');
    if (!details || details.dataset.normalized === 'true') return;
    details.dataset.normalized = 'true';
    let body = details.querySelector('.external-config-body');
    if (!body) {
        body = document.createElement('div');
        body.className = 'external-config-body';
        while (details.children.length > 1) body.appendChild(details.children[1]);
        details.appendChild(body);
    }

}

function normalizeCharacterEditorLayout(_overlay) {
    // 角色卡所有字段按当前产品顺序排列，不收进外部格式兼容区。
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
    if (nameInput) nameInput.value = tmpl.name || '';
    if (roleSelect) roleSelect.value = tmpl.role || 'user';
    if (contentTextarea) contentTextarea.value = tmpl.content || '';
    if (isSystem) isSystem.checked = !!tmpl.isSystemPrompt;
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
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) { setStatus('请输入模板名称', 'warn'); nameInput.focus(); return; }
    state.promptTemplates[idx].name = name;
    state.promptTemplates[idx].role = roleSelect?.value || 'user';
    state.promptTemplates[idx].content = contentTextarea?.value || '';
    state.promptTemplates[idx].isSystemPrompt = isSystem?.checked || false;
    state.promptTemplates[idx].isMarker = false;
    state.promptTemplates[idx].markerId = '';
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
    if (!safeConfirm('确认删除模板 "' + tmpl.name + '"？')) return;
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
