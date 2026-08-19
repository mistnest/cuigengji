/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function renderCharacterList() {
    const list = $('#character-list');
    if (!state.characters.length) {
        list.innerHTML = '<div class="list-placeholder">尚未导入角色<br>点击 "导入" 导入角色卡</div>';
        renderReferenceControls();
        return;
    }

    // Check which characters appear in current text
    const currentText = $('#chapter-editor').value || '';
    const activeNames = new Set();
    for (const ch of state.characters) {
        const name = ch.data?.name || ch.name || '';
        if (name && currentText.includes(name)) activeNames.add(name);
    }

    // Render a single character entry
    function renderChar(ch, i) {
        const name = ch.data?.name || ch.name || `角色${i + 1}`;
        const summary = (ch.data?.summary || (ch.data?.description || ch.description || '').replace(/\\s+/g, ' ').trim().substring(0, 60)).trim();
        const disabled = isCharacterDisabled(ch);
        const isActive = !disabled && activeNames.has(name);
        const charBook = ch.data?.character_book || ch.data?.data?.character_book;
        const innerBookCount = charBook?.entries
            ? Object.keys(charBook.entries).length : 0;
        return `<div class="list-item character-entry ${isActive ? 'active-in-scene' : ''} ${disabled ? 'disabled' : ''}" data-index="${i}">
            <input type="checkbox" class="batch-check" data-id="${i}" aria-label="选择 ${escHtml(name)}">
            <div class="item-title">
                ${isActive ? '🟢' : '⚪'} ${escHtml(name)}
                ${innerBookCount > 0 ? `<span class="char-book-badge" title="内嵌 ${innerBookCount} 条世界书">📚${innerBookCount}</span>` : ''}
            </div>
            ${summary ? `<div class="item-subtitle">${escHtml(summary.substring(0, 60))}${summary.length > 60 ? '…' : ''}</div>` : ''}
            ${disabled ? '<div class="item-status disabled">已禁用</div>' : ''}
            ${isActive ? '<div class="item-status enabled">当前场景中</div>' : ''}
        </div>`;
    }

    // Group by _source
    const groups = {};
    const ungrouped = [];
    for (let i = 0; i < state.characters.length; i++) {
        const source = state.characters[i]._source;
        if (source) {
            if (!groups[source]) groups[source] = [];
            groups[source].push(i);
        } else {
            ungrouped.push(i);
        }
    }

    let html = '';
    const sourceNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-CN'));

    for (const source of sourceNames) {
        const indices = groups[source];
        html += `<div class="source-group">`;
        html += `<div class="source-group-header" data-source="${escHtml(source)}">`;
        html += `<span class="source-group-arrow">▶</span>`;
        html += `<span class="source-group-name">📁 ${escHtml(source)}</span>`;
        html += `<span class="source-group-count">${indices.length} 个角色</span>`;
        html += `</div>`;
        html += `<div class="source-group-body">`;
        for (const i of indices) {
            html += renderChar(state.characters[i], i);
        }
        html += `</div></div>`;
    }

    if (ungrouped.length > 0) {
        html += `<div class="source-group">`;
        html += `<div class="source-group-header" data-source="__ungrouped__">`;
        html += `<span class="source-group-arrow">▶</span>`;
        html += `<span class="source-group-name">📁 未分组</span>`;
        html += `<span class="source-group-count">${ungrouped.length} 个角色</span>`;
        html += `</div>`;
        html += `<div class="source-group-body">`;
        for (const i of ungrouped) {
            html += renderChar(state.characters[i], i);
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

    // Click → open editor directly
    list.querySelectorAll('.character-entry').forEach(el => {
        el.addEventListener('click', event => {
            if (event.target.closest('.batch-check')) return;
            if (list.closest('.sidebar-panel')?.classList.contains('batch-mode')) {
                const checkbox = el.querySelector('.batch-check');
                if (checkbox) checkbox.checked = !checkbox.checked;
                return;
            }
            const idx = parseInt(el.dataset.index);
            if (!isNaN(idx) && state.characters[idx]) {
                openCharacterEditor(state.characters[idx], idx);
            }
        });
    });
    // Auto-fill empty character summaries
    let chChanged = false;
    for (const ch of state.characters) {
        const data = ch.data || {};
        if (!data.summary) {
            const raw = [data.description || ch.description || '', data.personality || '', data.scenario || ''].filter(Boolean).join('；');
            if (raw) { data.summary = raw.replace(/\s+/g, ' ').trim().substring(0, 150); chChanged = true; }
        }
    }
    if (chChanged) autoSave();
    renderReferenceControls();
}

function toggleBatchMode(type, button) {
    const panel = type === 'worldbook' ? $('#panel-worldbook') : $('#panel-characters');
    if (!panel) return;
    const active = !panel.classList.contains('batch-mode');
    panel.classList.toggle('batch-mode', active);
    button.classList.toggle('active', active);
    button.textContent = active ? '完成' : '批量';

    let actions = panel.querySelector('.batch-actions');
    if (active) {
        // Remove old bar if exists
        if (actions) actions.remove();
        actions = document.createElement('div');
        actions.className = 'batch-actions';
        actions.innerHTML = '<button data-action="select-all" class="batch-btn-secondary">全选</button>' +
            '<button data-action="invert" class="batch-btn-secondary">反选</button>' +
            '<span class="batch-sep">|</span>' +
            '<button data-action="enable">启用</button>' +
            '<button data-action="disable">停用</button>' +
            '<button data-action="delete" class="batch-btn-danger">删除</button>';
        const list = type === 'worldbook' ? $('#worldbook-list') : $('#character-list');
        list?.before(actions);
        actions.addEventListener('click', event => {
            const action = event.target.closest('button')?.dataset.action;
            if (!action) return;
            if (action === 'select-all') {
                panel.querySelectorAll('.batch-check').forEach(cb => { cb.checked = true; });
            } else if (action === 'invert') {
                panel.querySelectorAll('.batch-check').forEach(cb => { cb.checked = !cb.checked; });
            } else {
                applyBatchAction(type, action);
            }
        });
    } else {
        if (actions) actions.remove();
    }
    panel.querySelectorAll('.batch-check').forEach(checkbox => { checkbox.checked = false; });
}

function applyBatchAction(type, action) {
    const panel = type === 'worldbook' ? $('#panel-worldbook') : $('#panel-characters');
    const selected = [...panel.querySelectorAll('.batch-check:checked')].map(checkbox => checkbox.dataset.id);
    if (!selected.length) return setStatus('请先选择条目', 'warn');
    if (action === 'delete' && !safeConfirm(`删除选中的 ${selected.length} 项？`)) return;

    if (type === 'worldbook') {
        selected.forEach(uid => {
            const entry = state.worldBook.entries[uid];
            if (!entry) return;
            if (action === 'delete') delete state.worldBook.entries[uid];
            if (action === 'enable') entry.disable = false;
            if (action === 'disable') entry.disable = true;
        });
        renderWorldBookList();
    } else {
        const indexes = selected.map(Number).filter(index => !Number.isNaN(index));
        if (action === 'delete') {
            const indexSet = new Set(indexes);
            state.characters = state.characters.filter((_character, index) => !indexSet.has(index));
        } else {
            indexes.forEach(index => {
                const character = state.characters[index];
                if (character) setCharacterDisabled(character, action === 'disable');
            });
        }
        renderCharacterList();
    }
    autoSave();
    setStatus('批量操作已完成', 'success');
}

function renderReferenceControls() {
    document.querySelectorAll('[data-reference-kind]').forEach(control => {
        const kind = control.dataset.referenceKind;
        const mode = kind === 'worldbook'
            ? state.writingReference.worldbookMode
            : state.writingReference.characterMode;
        control.querySelectorAll('[data-reference-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.referenceMode === mode);
        });
    });

    const worldPicks = $('#worldbook-reference-picks');
    if (worldPicks) {
        worldPicks.replaceChildren();
        const groups = [...new Set(Object.values(state.worldBook?.entries || {})
            .map(entry => getWorldBookFolder(entry))
            .filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'zh-CN'));
        worldPicks.style.display = state.writingReference.worldbookMode === 'selected' ? '' : 'none';
        if (!groups.length) {
            const empty = document.createElement('em');
            empty.textContent = '还没有分组';
            worldPicks.appendChild(empty);
        } else {
            groups.forEach(group => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = group;
                button.classList.toggle('active', state.writingReference.selectedWorldbookGroups.includes(group));
                button.addEventListener('click', () => {
                    const selected = new Set(state.writingReference.selectedWorldbookGroups);
                    if (selected.has(group)) selected.delete(group);
                    else selected.add(group);
                    state.writingReference.selectedWorldbookGroups = [...selected];
                    renderReferenceControls();
                    autoSave();
                });
                worldPicks.appendChild(button);
            });
        }
        // 管理分组入口
        const mgmtBtn = document.createElement('button');
        mgmtBtn.type = 'button';
        mgmtBtn.textContent = '管理分组';
        mgmtBtn.style.cssText = 'font-size:11px;margin-left:4px;';
        mgmtBtn.addEventListener('click', () => { showGroupManager(() => { renderReferenceControls(); }); });
        worldPicks.appendChild(mgmtBtn);
    }

    const characterPicks = $('#character-reference-picks');
    if (characterPicks) {
        characterPicks.replaceChildren();
        const names = state.characters
            .filter(character => !isCharacterDisabled(character))
            .map(character => character.data?.name || character.name || '')
            .filter(Boolean);
        characterPicks.style.display = state.writingReference.characterMode === 'selected' ? '' : 'none';
        if (!names.length) {
            const empty = document.createElement('em');
            empty.textContent = '还没有角色';
            characterPicks.appendChild(empty);
        } else {
            names.forEach(name => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = name;
                button.classList.toggle('active', state.writingReference.selectedCharacters.includes(name));
                button.addEventListener('click', () => {
                    const selected = new Set(state.writingReference.selectedCharacters);
                    if (selected.has(name)) selected.delete(name);
                    else selected.add(name);
                    state.writingReference.selectedCharacters = [...selected];
                    renderReferenceControls();
                    autoSave();
                });
                characterPicks.appendChild(button);
            });
        }
    }
}

function showCharacterDetail(ch, _idx) {
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
            <button class="char-btn-edit-char" title="编辑角色设定">✏️ 编辑</button>
            <button class="plot-btn-cancel char-detail-close">关闭</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.plot-modal-close').addEventListener('click', close);
    overlay.querySelector('.char-detail-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Edit character button
    const editBtn = overlay.querySelector('.char-btn-edit-char');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            close();
            openCharacterEditor(ch, _idx);
        });
    }

    // Extract embedded world book button
    const extractBtn = overlay.querySelector('.char-btn-extract-book');
    if (extractBtn) {
        if (bookEntries.length > 0) {
            extractBtn.addEventListener('click', () => {
                if (!state.worldBook) state.worldBook = { entries: {} };
                if (!state.worldBook.sources) state.worldBook.sources = {};
                const nextUid = Math.max(0, ...Object.keys(state.worldBook.entries).map(Number)) + 1;
                const sourceLabel = ch._source || ('内嵌: ' + name);
                let added = 0;
                bookEntries.forEach((e, i) => {
                    const newEntry = { ...e, _source: sourceLabel, folder: e.folder || e._folder || sourceLabel, sourceGroup: e.sourceGroup || e.group || '', uid: nextUid + i };
                    state.worldBook.entries[nextUid + i] = newEntry;
                    added++;
                });
                state.worldBook.sources[sourceLabel] = {
                    name: sourceLabel,
                    entryCount: (state.worldBook.sources[sourceLabel]?.entryCount || 0) + added,
                    importedAt: Date.now(),
                };
                renderWorldBookList();
                autoSave();
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
