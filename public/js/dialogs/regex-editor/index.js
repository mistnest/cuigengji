/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
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
