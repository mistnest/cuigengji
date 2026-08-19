/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function initWelcomePage() {
    // Wire welcome modal buttons
    const btnCreate = document.getElementById('btn-welcome-create');
    const btnImport = document.getElementById('btn-welcome-import');
    if (btnCreate) btnCreate.addEventListener('click', showWelcomeCreateModal);
    if (btnImport) btnImport.addEventListener('click', () => importDocumentFromDialog({ newProject: true }));
    bindWelcomeModal();
    bindPresetSaveModal();
    loadRecentWorkspaces();
}

let _welcomeCloseTimer = 0;

function showWelcomeCreateModal() {
    const overlay = document.getElementById('welcome-modal-overlay');
    const input = document.getElementById('welcome-modal-input');
    if (!overlay || !input) return;
    clearTimeout(_welcomeCloseTimer);
    const errorEl = document.getElementById('welcome-modal-error');
    if (errorEl) errorEl.classList.remove('show');
    overlay.style.display = '';
    input.value = '';
    requestAnimationFrame(() => overlay.classList.add('active'));
    input.focus();
}

function bindWelcomeModal() {
    const overlay = document.getElementById('welcome-modal-overlay');
    const input = document.getElementById('welcome-modal-input');
    const confirmBtn = document.getElementById('btn-welcome-modal-confirm');
    const cancelBtn = document.getElementById('btn-welcome-modal-cancel');
    if (!overlay) return;

    const close = () => {
        overlay.classList.remove('active');
        _welcomeCloseTimer = setTimeout(() => { overlay.style.display = 'none'; }, 200);
    };

    if (confirmBtn) confirmBtn.addEventListener('click', async () => {
        const title = (input?.value || '').trim();
        if (!title) { close(); return; }
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        await doCreateWorkspace(title);
        confirmBtn.disabled = false;
    });

    if (cancelBtn) cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    input?.addEventListener('keydown', e => {
        if (e.key === 'Enter') confirmBtn?.click();
        if (e.key === 'Escape') cancelBtn?.click();
    });
}

async function doCreateWorkspace(title) {
    try {
        const data = await Repositories.projects.create({ title });
        // 成功后关弹窗再进入
        const overlay = document.getElementById('welcome-modal-overlay');
        if (overlay) { overlay.classList.remove('active'); overlay.style.display = 'none'; }
        await enterWorkspace(data.id, data.config?.title || title);
    } catch (err) {
        // 在输入框下方显示红色错误提示
        const errorEl = document.getElementById('welcome-modal-error');
        if (errorEl) {
            errorEl.textContent = err.message === 'Project already exists' ? '该工作区名称已存在' : `创建失败: ${err.message}`;
            errorEl.classList.add('show');
        }
        // 保持弹窗打开，让用户可以直接修改重试
        const input = document.getElementById('welcome-modal-input');
        if (input) { input.focus(); input.select(); }
    }
}

async function loadRecentWorkspaces() {
    const list = $('#welcome-novel-list');
    if (!list) return;

    try {
        let novels = await Repositories.projects.list();
        const accessed = { ...Preferences.get('recentProjectAccess', {}) };
        novels.sort((a, b) => {
            const aTime = accessed[a.id] || a.updated || a.created || 0;
            const bTime = accessed[b.id] || b.updated || b.created || 0;
            return bTime - aTime;
        });

        list.replaceChildren();
        if (!novels.length) {
            const empty = document.createElement('div');
            empty.className = 'welcome-empty';
            empty.textContent = '\u6682\u65e0\u5de5\u4f5c\u533a';
            list.appendChild(empty);
            return;
        }

        let batchMode = false;
        const renderCards = (expanded) => {
            list.replaceChildren();
            const visible = expanded ? novels : novels.slice(0, 10);
            for (const novel of visible) {
            const card = document.createElement('div');
            card.className = 'welcome-novel-card';
            card.dataset.novelId = novel.id;

            if (batchMode) {
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'welcome-batch-check';
                cb.dataset.novelId = novel.id;
                card.appendChild(cb);
            }

            const icon = document.createElement('span');
            icon.className = 'welcome-novel-icon';
            icon.textContent = '\u25cf';

            const info = document.createElement('span');
            info.className = 'welcome-novel-info';

            const title = document.createElement('span');
            title.className = 'welcome-novel-title';
            title.textContent = novel.title || novel.id;
            info.appendChild(title);

            const timestamp = accessed[novel.id] || novel.updated || novel.created;
            if (timestamp) {
                const date = document.createElement('span');
                date.className = 'welcome-novel-path';
                date.textContent = formatRelativeTime(timestamp);
                info.appendChild(date);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'welcome-delete-btn';
            delBtn.textContent = '\u00d7';
            delBtn.title = '\u5220\u9664\u9879\u76ee';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!safeConfirm(`\u5220\u9664\u201c${novel.title || novel.id}\u201d\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002`)) return;
                try {
                    await deleteWorkspace(novel.id);
                    delete accessed[novel.id];
                    setPreference('recentProjectAccess', accessed);
                    novels.splice(novels.indexOf(novel), 1);
                    renderCards(expanded);
                } catch (error) {
                    setStatus(`删除项目失败: ${error.message}`, 'error');
                }
            });

            card.append(icon, info, delBtn);
            card.addEventListener('click', (e) => {
                if (batchMode) return;
                if (e.target.closest('.welcome-delete-btn')) return;
                enterWorkspace(novel.id, novel.title || novel.id);
            });
            // In batch mode, only the checkbox toggles selection
            const cb = card.querySelector('.welcome-batch-check');
            if (cb) cb.addEventListener('click', (e) => e.stopPropagation());
            list.appendChild(card);
            }

            // Batch actions bar
            const existingBar = list.querySelector('.welcome-batch-bar');
            if (existingBar) existingBar.remove();
            if (batchMode) {
                const bar = document.createElement('div');
                bar.className = 'welcome-batch-bar';
                bar.innerHTML = '<button id="btn-welcome-batch-delete" class="ai-btn-secondary" style="color:var(--error);border-color:rgba(229,72,77,0.4);">\u5220\u9664\u9009\u4e2d</button>';
                bar.querySelector('button').addEventListener('click', async () => {
                    const checked = list.querySelectorAll('.welcome-batch-check:checked');
                    if (!checked.length) { setStatus('\u8bf7\u5148\u52fe\u9009\u9879\u76ee', 'warn'); return; }
                    const ids = [...checked].map(cb => cb.dataset.novelId);
                    if (!safeConfirm(`\u5220\u9664\u9009\u4e2d\u7684 ${ids.length} \u4e2a\u9879\u76ee\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002`)) return;
                    const deleted = [];
                    for (const id of ids) {
                        try {
                            await deleteWorkspace(id);
                            deleted.push(id);
                            delete accessed[id];
                        } catch (error) {
                            setStatus(`删除项目失败: ${error.message}`, 'error');
                            break;
                        }
                    }
                    setPreference('recentProjectAccess', accessed);
                    novels = novels.filter(n => !deleted.includes(n.id));
                    renderCards(expanded);
                });
                list.appendChild(bar);
            }

            // Batch toggle button
            const existingToggle = list.querySelector('.welcome-batch-toggle');
            if (existingToggle) existingToggle.remove();
            if (novels.length > 0) {
                const bt = document.createElement('button');
                bt.className = 'welcome-batch-toggle';
                bt.textContent = batchMode ? '\u5b8c\u6210' : '\u6279\u91cf';
                bt.addEventListener('click', () => {
                    batchMode = !batchMode;
                    renderCards(expanded);
                });
                list.appendChild(bt);
            }

            if (novels.length > 10) {
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'welcome-fold-toggle';
                toggle.title = expanded ? '\u6536\u8d77\u9879\u76ee\u8bb0\u5f55' : '\u663e\u793a\u66f4\u591a\u9879\u76ee';
                toggle.setAttribute('aria-label', toggle.title);
                toggle.textContent = expanded ? '\u6536\u8d77' : '\u2026';
                toggle.addEventListener('click', () => renderCards(!expanded));
                list.appendChild(toggle);
            }
        }
        renderCards(false);
    } catch (err) {
        list.replaceChildren();
        const error = document.createElement('div');
        error.className = 'welcome-empty';
        error.textContent = `\u52a0\u8f7d\u5931\u8d25: ${err.message}`;
        list.appendChild(error);
    }
}

async function deleteWorkspace(id) {
    const confirmation = await Repositories.projects.requestDelete(id);
    await Repositories.projects.delete(id, confirmation.token);
}

function createWorkspaceFromWelcome() {
    showWelcomeCreateModal();
}
