/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function getWorldBookGroups() {
    return getWorldBookFolders();
}

function ensureWorldBookFolders() {
    if (!state.worldBook) state.worldBook = { entries: {}, sources: {}, folders: [] };
    if (!state.worldBook.entries) state.worldBook.entries = {};
    if (!state.worldBook.sources) state.worldBook.sources = {};
    if (!Array.isArray(state.worldBook.folders)) state.worldBook.folders = [];
    const folders = new Set(state.worldBook.folders.map(folder => String(folder || '').trim()).filter(Boolean));
    state.worldBook.folders = [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return folders;
}

function getWorldBookFolder(entry = {}) {
    return String(entry.folder || entry._folder || entry._source || entry.group || '').trim();
}

function setWorldBookFolder(entry = {}, folder = '') {
    const value = String(folder || '').trim();
    entry.folder = value;
    entry._folder = value;
    if (entry._source || value) entry._source = value;
    return entry;
}

function getWorldBookFolders() {
    const folderSet = ensureWorldBookFolders();
    const entries = state.worldBook?.entries || {};
    for (const entry of Object.values(entries)) {
        const folder = getWorldBookFolder(entry);
        if (folder) folderSet.add(folder);
    }
    state.worldBook.folders = [...folderSet].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return state.worldBook.folders;
}

function showGroupManager(onChanged) {
    const groups = getWorldBookGroups();
    const overlay = document.createElement('div');
    overlay.className = 'plot-modal-overlay';
    const rows = groups.map(g => `
        <div class="group-mgr-row" data-group="${escHtml(g)}">
            <span class="group-mgr-name">${escHtml(g)}</span>
            <div class="group-mgr-actions">
                <button class="ai-btn-secondary group-rename-btn">重命名</button>
                <button class="ai-btn-secondary group-delete-btn">删除</button>
            </div>
        </div>`).join('');
    overlay.innerHTML = `<div class="plot-modal group-manager-modal">
        <div class="plot-modal-header">
            <h3>管理分组</h3>
            <button class="plot-modal-close">×</button>
        </div>
        <div class="plot-modal-body group-manager-body">
            <div class="group-manager-add">
                <input type="text" id="group-new-input" class="ai-input" placeholder="新分组名称">
                <button id="group-add-btn" class="ai-btn-primary">新建分组</button>
            </div>
            <div class="group-manager-list">
                ${rows || '<p class="group-manager-empty">暂无分组</p>'}
            </div>
        </div>
        <div class="plot-modal-footer"><button class="ai-btn-secondary group-close-btn">关闭</button></div></div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); onChanged?.(); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
    overlay.querySelector('.group-close-btn')?.addEventListener('click', close);

    // New group
    overlay.querySelector('#group-add-btn')?.addEventListener('click', () => {
        const inp = overlay.querySelector('#group-new-input');
        const name = inp?.value?.trim();
        if (!name) return;
        const folders = ensureWorldBookFolders();
        if (!folders.has(name)) {
            // Create a dummy entry to register the group, then remove it — no, just reopen with the group added
            folders.add(name);
            state.worldBook.folders = [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
            autoSave();
        }
        close();
        showGroupManager(onChanged);
    });
    // Rename
    overlay.querySelectorAll('.group-rename-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.group-mgr-row');
            const oldName = row?.dataset.group;
            if (!oldName) return;
            const newName = prompt('重命名分组：', oldName)?.trim();
            if (!newName || newName === oldName) return;
            const entries = state.worldBook?.entries || {};
            for (const e of Object.values(entries)) {
                if (getWorldBookFolder(e) === oldName) setWorldBookFolder(e, newName);
            }
            const folders = ensureWorldBookFolders();
            folders.delete(oldName);
            folders.add(newName);
            state.worldBook.folders = [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
            renderWorldBookList();
            renderReferenceControls();
            autoSave();
            close();
            showGroupManager(onChanged);
        });
    });

    // Delete
    overlay.querySelectorAll('.group-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.group-mgr-row');
            const name = row?.dataset.group;
            if (!name) return;
            if (!safeConfirm('删除分组 "' + name + '" 不会删除其中的条目，它们会变成无分组。确认？')) return;
            const entries = state.worldBook?.entries || {};
            for (const e of Object.values(entries)) {
                if (getWorldBookFolder(e) === name) setWorldBookFolder(e, '');
            }
            const folders = ensureWorldBookFolders();
            folders.delete(name);
            state.worldBook.folders = [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
            renderWorldBookList();
            renderReferenceControls();
            autoSave();
            close();
            showGroupManager(onChanged);
        });
    });

    requestAnimationFrame(() => overlay.classList.add('active'));
}

function renderWorldBookList() {
    const list = $('#worldbook-list');
    const entries = state.worldBook?.entries || {};
    const keys = Object.keys(entries);

    if (keys.length === 0) {
        list.innerHTML = '<div class="list-placeholder">尚未导入世界书<br>点击 "导入" 导入世界书</div>';
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

    // Render a single entry
    function renderEntry(k, e) {
        const name = e.comment || e.key?.[0] || `条目${k}`;
        const mainKw = (e.key || []).join(', ');
        const subKw = (e.keysecondary || []).join(', ');
        const matchedNow = activeUids.has(k);
        const folder = getWorldBookFolder(e);
        const groupTag = folder ? `<span class="wb-group-tag">${escHtml(folder)}</span>` : '';

        // 小圆点状态，不用 emoji
        let dotColor, dotTitle;
        if (e.disable) {
            dotColor = 'var(--text-muted)'; dotTitle = '已禁用';
        } else if (e.constant) {
            dotColor = 'var(--success)'; dotTitle = '始终激活';
        } else if (matchedNow) {
            dotColor = 'var(--success)'; dotTitle = '触发中';
        } else {
            dotColor = 'var(--text-muted)'; dotTitle = '待触发';
        }

        const summary = (e.summary || (e.content || '').replace(/\\s+/g, ' ').trim().substring(0, 60)).trim();
        let subtitle = '';
        if (summary) {
            subtitle = `<div class="item-subtitle">${escHtml(summary.substring(0, 60))}${summary.length > 60 ? '…' : ''}</div>`;
        }

        return `<div class="list-item wb-entry ${matchedNow ? 'active-in-scene' : ''}" data-uid="${k}">
            <input type="checkbox" class="batch-check" data-id="${k}" aria-label="选择 ${escHtml(name)}">
            <span class="wb-dot" style="color:${dotColor}" title="${dotTitle}">●</span>
            <div class="item-body">
                <div class="item-title">${escHtml(name)}${groupTag}</div>
                ${subtitle}
            </div>
        </div>`;
    }

    // Group entries by folder. `_source` and ST `group` are compatibility fallbacks.
    const groups = {};
    const ungrouped = [];
    for (const k of keys) {
        const source = getWorldBookFolder(entries[k]);
        if (source) {
            if (!groups[source]) groups[source] = [];
            groups[source].push(k);
        } else {
            ungrouped.push(k);
        }
    }

    let html = '';
    const sourceNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-CN'));

    for (const source of sourceNames) {
        const groupKeys = groups[source];
        const activeInGroup = groupKeys.filter(k => activeUids.has(k)).length;
        html += `<div class="source-group">`;
        html += `<div class="source-group-header" data-source="${escHtml(source)}">`;
        html += `<span class="source-group-arrow">▶</span>`;
        html += `<span class="source-group-name">📁 ${escHtml(source)}</span>`;
        html += `<span class="source-group-count">${groupKeys.length} 条${activeInGroup > 0 ? ` · ${activeInGroup} 触发` : ''}</span>`;
        html += `</div>`;
        html += `<div class="source-group-body">`;
        for (const k of groupKeys) {
            html += renderEntry(k, entries[k]);
        }
        html += `</div></div>`;
    }

    if (ungrouped.length > 0) {
        html += `<div class="source-group">`;
        html += `<div class="source-group-header" data-source="__ungrouped__">`;
        html += `<span class="source-group-arrow">▶</span>`;
        html += `<span class="source-group-name">📁 未分组</span>`;
        html += `<span class="source-group-count">${ungrouped.length} 条</span>`;
        html += `</div>`;
        html += `<div class="source-group-body">`;
        for (const k of ungrouped) {
            html += renderEntry(k, entries[k]);
        }
        html += `</div></div>`;
    }

    list.innerHTML = html;

    // Group header click → toggle collapse
    list.querySelectorAll('.source-group-header').forEach(header => {
        header.addEventListener('click', () => {
            header.classList.toggle('collapsed');
            const arrow = header.querySelector('.source-group-arrow');
            const body = header.nextElementSibling;
            if (body) {
                body.classList.toggle('hidden');
                if (arrow) arrow.textContent = body.classList.contains('hidden') ? '▶' : '▼';
            }
        });
    });

    // Entry click → show detail
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
    // Auto-fill empty summaries from content
    let wbChanged = false;
    for (const [k, e] of Object.entries(entries)) {
        if (!e.summary && e.content) {
            e.summary = e.content.replace(/\s+/g, ' ').trim().substring(0, 150);
            wbChanged = true;
        }
    }
    if (wbChanged) autoSave();
    renderReferenceControls();
}

function showWorldBookDetail(uid, entry) {
    const overlay = document.createElement('div');
    overlay.className = 'plot-modal-overlay';

    const isActive = checkEntryActive(entry);
    let statusText, statusColor;
    if (entry.disable) {
        statusText = '已禁用'; statusColor = 'var(--text-muted)';
    } else if (entry.constant) {
        statusText = '始终激活'; statusColor = 'var(--success)';
    } else if (isActive) {
        statusText = '触发中'; statusColor = 'var(--success)';
    } else {
        statusText = '待触发'; statusColor = 'var(--text-muted)';
    }
    const posLabels = ['角色前', '角色后', '按深度', '@D标注'];

    const modal = document.createElement('div');
    modal.className = 'plot-modal char-detail-modal wb-edit-modal';
    const groups = getWorldBookGroups();
    const currentFolder = getWorldBookFolder(entry);
    const groupOptions = ['', ...groups].map(g => `<option value="${escHtml(g)}" ${currentFolder === g ? 'selected' : ''}>${escHtml(g) || '（无文件夹）'}</option>`).join('');
    modal.innerHTML = `
        <div class="plot-modal-header">
            <h3>编辑世界书条目</h3>
            <span style="font-size:11px;color:${statusColor}">${statusText}</span>
            <button class="plot-modal-close">×</button>
        </div>
        <div class="plot-modal-body char-detail-body">
            <div class="char-field">
                <h4>名称</h4>
                <input type="text" class="wb-edit-input" id="wb-edit-comment" value="${escHtml(entry.comment || '')}" placeholder="用于识别的名称...">
            </div>
            <div class="char-field">
                <h4>分组</h4>
                <div style="display:flex;gap:6px;align-items:center;">
                    <select class="wb-edit-input" id="wb-edit-folder" style="flex:1;">${groupOptions}</select>
                    <button type="button" id="wb-group-manage-btn" class="ai-btn-secondary" style="width:auto;min-height:auto;font-size:10px;padding:2px 8px;white-space:nowrap;flex-shrink:0;">管理分组</button>
                </div>
            </div>
            <div class="char-field">
                <h4>触发关键词（逗号分隔）</h4>
                <input type="text" class="wb-edit-input" id="wb-edit-key" value="${escHtml((entry.key || []).join(', '))}" placeholder="关键词1, 关键词2...">
            </div>
            <div class="char-field">
                <h4>次级关键词（逗号分隔）</h4>
                <input type="text" class="wb-edit-input" id="wb-edit-keysecondary" value="${escHtml((entry.keysecondary || []).join(', '))}" placeholder="次要触发词...">
            </div>
            <div class="char-field">
                <h4>注入内容</h4>
                <textarea class="wb-edit-textarea" id="wb-edit-content" placeholder="当关键词触发时，这段内容会被注入到 AI 的上下文中...">${escHtml(entry.content || '')}</textarea>
            </div>
            <div class="char-field">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <h4 style="margin:0;">摘要</h4>
                    <button type="button" class="ai-btn-secondary" id="wb-summarize-btn">AI 提取</button>
                </div>
                <textarea class="wb-edit-textarea character-edit-short" id="wb-edit-summary" placeholder="智能摘要模式下使用的简略描述。留空则该条目不会注入。" style="width:100%;">${escHtml(entry.summary || '')}</textarea>
            </div>
            <div class="wb-edit-row">
                <div class="char-field" style="flex:1;">
                    <h4>排序</h4>
                    <input type="number" class="wb-edit-input" id="wb-edit-order" value="${entry.order ?? 100}" min="1" max="999">
                </div>
                <div class="char-field" style="flex:1;">
                    <h4>扫描深度</h4>
                    <input type="number" class="wb-edit-input" id="wb-edit-depth" value="${entry.depth ?? 4}" min="0" max="100">
                </div>
            </div>
            <div class="wb-edit-row">
                <div class="char-field" style="flex:1;">
                    <h4>注入位置</h4>
                    <select class="wb-edit-input" id="wb-edit-position">
                        ${posLabels.map((l, i) => `<option value="${i}" ${(entry.position ?? 0) === i ? 'selected' : ''}>${l}</option>`).join('')}
                    </select>
                </div>
                <div class="char-field" style="flex:1;">
                    <h4>激活概率 (%)</h4>
                    <input type="number" class="wb-edit-input" id="wb-edit-probability" value="${entry.probability ?? 100}" min="0" max="100">
                </div>
            </div>
            <details class="wb-st-config">
                <summary>ST 专用配置（兼容导入字段）</summary>
                <p style="margin:6px 0 10px;color:var(--text-muted);font-size:12px;">这些字段主要用于保留酒馆世界书原始配置；日常分组请使用上方“文件夹”。</p>
            <div class="wb-edit-row">
                <div class="char-field" style="flex:1;">
                    <h4>📁 分组名</h4>
                    <input type="text" class="wb-edit-input" id="wb-edit-source-group" value="${escHtml(entry.sourceGroup || entry.group || '')}" placeholder="酒馆世界书 group，可选" list="wb-group-list">
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
            </details>
            <div class="wb-edit-checks">
                <label class="wb-check-label"><input type="checkbox" id="wb-edit-constant" ${entry.constant ? 'checked' : ''}> 始终激活（忽略关键词匹配）</label>
                <label class="wb-check-label"><input type="checkbox" id="wb-edit-disable" ${entry.disable ? 'checked' : ''}> 禁用此条目</label>
                <label class="wb-check-label"><input type="checkbox" id="wb-edit-caseSensitive" ${entry.caseSensitive ? 'checked' : ''}> 大小写敏感</label>
                <label class="wb-check-label"><input type="checkbox" id="wb-edit-matchWholeWords" ${entry.matchWholeWords ? 'checked' : ''}> 全词匹配</label>
            </div>
        </div>
        <div class="plot-modal-footer">
            <button class="char-btn-delete wb-delete-btn">删除条目</button>
            <button class="char-btn-extract-book wb-save-btn">保存</button>
            <button class="plot-btn-cancel wb-cancel-btn">取消</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    normalizeWorldBookEditorLayout(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.plot-modal-close').addEventListener('click', close);
    overlay.querySelector('.wb-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Delete button
    overlay.querySelector('.wb-delete-btn').addEventListener('click', () => {
        const entryName = entry.comment || entry.key?.[0] || `条目${uid}`;
        document.activeElement?.blur();
        if (!safeConfirm(`确定要删除「${entryName}」吗？此操作不可撤销。`)) return;
        delete state.worldBook.entries[uid];
        renderWorldBookList();
        autoSave();
        close();
        setStatus(`已删除: ${entryName}`, 'success');
        refocusChat();
    });

    // AI summarize button
    overlay.querySelector('#wb-summarize-btn')?.addEventListener('click', async () => {
        const btn = overlay.querySelector('#wb-summarize-btn');
        const content = overlay.querySelector('#wb-edit-content').value.trim();
        if (!content) { alert('请先填写注入内容。'); return; }
        btn.disabled = true; btn.textContent = '生成中...';
        try {
            const summary = await generateSummary(content, 'worldbook');
            const summaryEl = overlay.querySelector('#wb-edit-summary');
            if (summaryEl) summaryEl.value = summary;
        } catch (e) { alert('生成失败: ' + e.message); }
        finally { btn.disabled = false; btn.textContent = 'AI 提取'; }
    });

    // Save button
    // Group manager
    overlay.querySelector('#wb-group-manage-btn')?.addEventListener('click', () => {
        showGroupManager(() => {
            const sel = overlay.querySelector('#wb-edit-folder');
            if (!sel) return;
            const groups = getWorldBookGroups();
            sel.innerHTML = ['', ...groups].map(g => `<option value="${escHtml(g)}" ${getWorldBookFolder(entry) === g ? 'selected' : ''}>${escHtml(g) || '（无文件夹）'}</option>`).join('');
        });
    });

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
        const folderSelect = overlay.querySelector('#wb-edit-folder');
        setWorldBookFolder(updated, folderSelect?.value?.trim() || '');
        const sourceGroupInput = overlay.querySelector('#wb-edit-source-group');
        updated.sourceGroup = sourceGroupInput?.value?.trim() || '';
        updated.group = updated.sourceGroup;
        updated.groupWeight = parseInt(overlay.querySelector('#wb-edit-groupWeight')?.value) || 100;
        updated.constant = overlay.querySelector('#wb-edit-constant').checked;
        updated.disable = overlay.querySelector('#wb-edit-disable').checked;
        updated.caseSensitive = overlay.querySelector('#wb-edit-caseSensitive').checked;
        updated.matchWholeWords = overlay.querySelector('#wb-edit-matchWholeWords').checked;
        updated.summary = overlay.querySelector('#wb-edit-summary')?.value?.trim()
            || (updated.content || '').replace(/\s+/g, ' ').trim().substring(0, 150);

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
