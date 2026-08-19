/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function addCharacter() {
    openCharacterEditor(null, -1);
}

function getCharacterBookEntries(data) {
    const charBook = data?.character_book || data?.data?.character_book || {};
    const rawEntries = charBook.entries || {};
    return (Array.isArray(rawEntries) ? rawEntries : Object.values(rawEntries)).filter(Boolean);
}

function renderEmbeddedWorldBookEntries(entries) {
    return entries.filter(e => !e.disable).map((e, i) => `
        <div class="embedded-book-entry">
            <strong>${escHtml(e.comment || e.key?.[0] || `条目${e.uid ?? i + 1}`)}</strong>
            <span>触发词：${escHtml((e.key || []).join(', ') || '无')}</span>
            <p>${escHtml((e.content || '').substring(0, 220))}</p>
        </div>
    `).join('');
}

function importEmbeddedWorldBookEntries(character, entries) {
    if (!entries?.length) return 0;
    if (!state.worldBook) state.worldBook = { entries: {} };
    if (!state.worldBook.entries) state.worldBook.entries = {};
    if (!state.worldBook.sources) state.worldBook.sources = {};
    const data = character?.data || character || {};
    const name = data.name || character?.name || '角色卡';
    const sourceLabel = character?._source || `内嵌: ${name}`;
    const numericIds = Object.keys(state.worldBook.entries).map(Number).filter(Number.isFinite);
    const nextUid = Math.max(0, ...numericIds) + 1;
    let added = 0;
    entries.forEach((entry, i) => {
        const uid = nextUid + i;
        state.worldBook.entries[uid] = {
            ...entry,
            uid,
            _source: sourceLabel,
            folder: entry.folder || entry._folder || sourceLabel,
            sourceGroup: entry.sourceGroup || entry.group || '',
        };
        added++;
    });
    state.worldBook.sources[sourceLabel] = {
        name: sourceLabel,
        entryCount: (state.worldBook.sources[sourceLabel]?.entryCount || 0) + added,
        importedAt: Date.now(),
    };
    renderWorldBookList();
    renderReferenceControls();
    autoSave();
    return added;
}

function openCharacterEditor(existingChar, charIndex) {
    const isEdit = existingChar !== null && existingChar !== undefined && charIndex >= 0;
    const data = isEdit ? (existingChar.data || existingChar) : {};
    const name = isEdit ? (data.name || existingChar.name || '') : '';
    const description = isEdit ? (data.description || '') : '';
    const personality = isEdit ? (data.personality || '') : '';
    const scenario = isEdit ? (data.scenario || '') : '';
    const firstMsg = isEdit ? (data.first_mes || '') : '';
    const tags = isEdit ? (data.tags || []).join(', ') : '';
    const group = isEdit ? (data.group || existingChar.group || '') : '';
    const embeddedBookEntries = isEdit ? getCharacterBookEntries(data) : [];
    const overlay = document.createElement('div');
    overlay.className = 'plot-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'plot-modal char-detail-modal character-edit-modal';
    modal.innerHTML = `
        <div class="plot-modal-header">
            <div>
                <h3>${isEdit ? '编辑角色' : '新建角色'}</h3>
                <p class="settings-subtitle">${isEdit ? '修改角色设定，保存后生效。' : '先建立基础角色卡，之后可继续导入或补充详细设定。'}</p>
            </div>
            <button type="button" class="plot-modal-close" aria-label="关闭">×</button>
        </div>
        <div class="plot-modal-body char-detail-body">
            <div class="char-field">
                <h4>角色名称 <span class="required-mark">*</span></h4>
                <input type="text" class="wb-edit-input" id="character-edit-name" placeholder="例如：林冬" maxlength="80" value="${escAttr(name)}">
                <div class="field-error" id="character-name-error"></div>
            </div>
            <div class="char-field">
                <h4>角色简介</h4>
                <textarea class="wb-edit-textarea character-edit-short" id="character-edit-description" placeholder="身份、外貌、经历或核心特征">${escHtml(description)}</textarea>
            </div>
            <div class="char-field">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <h4 style="margin:0;">摘要</h4>
                    <button type="button" class="ai-btn-secondary" id="char-summarize-btn">AI 提取</button>
                </div>
                <textarea class="wb-edit-textarea character-edit-short" id="character-edit-summary" placeholder="智能摘要模式下使用的简略描述。留空则该角色不会注入摘要。" style="width:100%;">${escHtml(isEdit ? (data.summary || '') : '')}</textarea>
            </div>
            <div class="character-edit-grid">
                <div class="char-field">
                    <h4>性格</h4>
                    <textarea class="wb-edit-textarea character-edit-short" id="character-edit-personality" placeholder="性格特点、行为习惯">${escHtml(personality)}</textarea>
                </div>
                <div class="char-field">
                    <h4>背景场景</h4>
                    <textarea class="wb-edit-textarea character-edit-short" id="character-edit-scenario" placeholder="角色所处环境和当前处境">${escHtml(scenario)}</textarea>
                </div>
            </div>
            <div class="char-field">
                <h4>开场白</h4>
                <textarea class="wb-edit-textarea character-edit-short" id="character-edit-first-message" placeholder="可选：角色第一次出场时的台词或动作">${escHtml(firstMsg)}</textarea>
            </div>
            <div class="char-field">
                <h4>标签</h4>
                <input type="text" class="wb-edit-input" id="character-edit-tags" placeholder="主角, 调查员, 雾港（逗号分隔）" value="${escAttr(tags)}">
            </div>
            <div class="char-field">
                <h4>分组</h4>
                <input type="text" class="wb-edit-input" id="character-edit-group" placeholder="角色分组（可选）" list="char-group-list" value="${escAttr(group)}">
                <datalist id="char-group-list">
                    <option value="主角">
                    <option value="配角">
                    <option value="反派">
                    <option value="NPC">
                </datalist>
            </div>
            ${embeddedBookEntries.length > 0 ? `
            <div class="char-field character-embedded-field">
                <h4>内嵌世界书</h4>
                <p class="st-config-hint">从 ST 角色卡携带而来，可保留在角色卡内，也可以提取为当前项目的世界书条目。</p>
                <div class="char-embedded-book">
                    ${renderEmbeddedWorldBookEntries(embeddedBookEntries)}
                </div>
                <div class="character-embedded-actions">
                    <button type="button" class="ai-btn-secondary character-extract-embedded-btn">提取到项目世界书</button>
                </div>
            </div>` : ''}
        </div>
        <div class="plot-modal-footer">
            ${isEdit ? '<button type="button" class="char-btn-delete character-edit-delete">删除角色</button>' : ''}
            <button type="button" class="plot-btn-cancel character-edit-cancel">取消</button>
            <button type="button" class="char-btn-extract-book character-edit-save">${isEdit ? '保存修改' : '创建角色'}</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#character-edit-name');
    const error = overlay.querySelector('#character-name-error');
    const close = () => overlay.remove();
    overlay.querySelector('.plot-modal-close').addEventListener('click', close);
    overlay.querySelector('.character-edit-cancel').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

    // AI summarize button
    overlay.querySelector('#char-summarize-btn')?.addEventListener('click', async () => {
        const btn = overlay.querySelector('#char-summarize-btn');
        const parts = [
            overlay.querySelector('#character-edit-description')?.value?.trim(),
            overlay.querySelector('#character-edit-personality')?.value?.trim(),
            overlay.querySelector('#character-edit-scenario')?.value?.trim(),
        ].filter(Boolean);
        if (!parts.length) { alert('请先填写角色简介、性格或背景场景。'); return; }
        btn.disabled = true; btn.textContent = '生成中...';
        try {
            const summary = await generateSummary(parts.join('\n'), 'character');
            const summaryEl = overlay.querySelector('#character-edit-summary');
            if (summaryEl) summaryEl.value = summary;
        } catch (e) { alert('生成失败: ' + e.message); }
        finally { btn.disabled = false; btn.textContent = 'AI 提取'; }
    });

    overlay.querySelector('.character-extract-embedded-btn')?.addEventListener('click', () => {
        const added = importEmbeddedWorldBookEntries(existingChar, embeddedBookEntries);
        setStatus(`已从角色卡提取 ${added} 条世界书条目`, added > 0 ? 'success' : 'warn');
    });

    overlay.querySelector('.character-edit-save').addEventListener('click', () => {
        const newName = nameInput.value.trim();
        if (!newName) {
            error.textContent = '请输入角色名称';
            nameInput.focus();
            return;
        }
        const newTags = (overlay.querySelector('#character-edit-tags').value || '')
            .split(/[,，]/)
            .map(tag => tag.trim())
            .filter(Boolean);
        const newGroup = overlay.querySelector('#character-edit-group').value.trim();
        const newData = {
            spec: 'chara_card_v3',
            spec_version: '3.0',
            data: {
                name: newName,
                description: overlay.querySelector('#character-edit-description').value.trim(),
                personality: overlay.querySelector('#character-edit-personality').value.trim(),
                scenario: overlay.querySelector('#character-edit-scenario').value.trim(),
                first_mes: overlay.querySelector('#character-edit-first-message').value.trim(),
                mes_example: isEdit ? (data.mes_example || '') : '',
                creator_notes: isEdit ? (data.creator_notes || '') : '',
                system_prompt: isEdit ? (data.system_prompt || '') : '',
                post_history_instructions: isEdit ? (data.post_history_instructions || '') : '',
                tags: newTags,
                character_book: isEdit ? (data.character_book || { entries: [] }) : { entries: [] },
                group: newGroup,
                summary: overlay.querySelector('#character-edit-summary')?.value?.trim()
                    || [
                        overlay.querySelector('#character-edit-description')?.value?.trim(),
                        overlay.querySelector('#character-edit-personality')?.value?.trim(),
                        overlay.querySelector('#character-edit-scenario')?.value?.trim(),
                    ].filter(Boolean).join('；').replace(/\s+/g, ' ').trim().substring(0, 150),
            },
        };
        if (isEdit) {
            // Preserve root-level fields that aren't part of data (e.g. _source, _group, folder)
            const preserved = {};
            for (const key of Object.keys(existingChar)) {
                if (!['spec', 'spec_version', 'data', 'name', 'description', 'personality',
                     'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt',
                     'post_history_instructions', 'tags', 'character_book', 'group'].includes(key)) {
                    preserved[key] = existingChar[key];
                }
            }
            state.characters[charIndex] = { ...newData, ...preserved };
            setStatus(`已保存角色: ${newName}`, 'success');
        } else {
            state.characters.push(newData);
            setStatus(`已创建角色: ${newName}`, 'success');
        }
        renderCharacterList();
        autoSave();
        close();
    });

    // Delete button (edit mode only)
    const deleteBtn = overlay.querySelector('.character-edit-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            document.activeElement?.blur();
            if (!safeConfirm(`确定要删除角色「${name || '(未命名)'}」吗？此操作不可撤销。`)) return;
            state.characters.splice(charIndex, 1);
            renderCharacterList();
            autoSave();
            close();
            setStatus(`已删除角色: ${name}`, 'success');
            refocusChat();
        });
    }

    requestAnimationFrame(() => {
        overlay.classList.add('active');
        nameInput.focus();
    });
}

// Format text for debug display: ensures newlines render as real line breaks
