/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
async function importDocumentFromDialog({ newProject = false } = {}) {
    try {
        const result = await Repositories.imports.selectDocument({
            projectId: newProject ? undefined : state.currentNovel?.id,
            autoSplit: true,
        });
        if (!result) return;
        const project = result.project || state.currentNovel;
        await enterWorkspace(project.id, project.title || state.currentNovel?.title || project.id);
    } catch (err) {
        alert(`\u5bfc\u5165\u5931\u8d25: ${err.message}`);
    }
}

async function downloadFile(content, filename) {
    return Repositories.exports.saveText(filename, content);
}

async function exportCurrentChapter() {
    const text = $('#chapter-editor')?.value || '';
    if (!text.trim()) return setStatus('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u6b63\u6587', 'warn');
    const title = $('#chapter-title-input')?.value || state.currentChapter?.title || '\u672a\u547d\u540d\u7ae0\u8282';
    const result = await downloadFile(text, `${title}.txt`);
    if (result) setStatus('\u7ae0\u8282\u5df2\u5bfc\u51fa', 'success');
}

function downloadJson(data, filename) {
    return Repositories.exports.saveJson(filename, data);
}

function exportWorldBook() {
    const entries = Object.entries(state.worldBook?.entries || {});
    if (!entries.length) return setStatus('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u4e16\u754c\u4e66', 'warn');
    showExportSelectionDialog({
        title: '导出世界书',
        subtitle: '选择要导出的世界书条目。',
        items: entries.map(([uid, entry]) => ({
            id: uid,
            title: entry.comment || entry.key?.[0] || `条目 ${uid}`,
            meta: getWorldBookFolder(entry) || entry.group || '未分组',
            checked: true,
        })),
        onConfirm: async selectedIds => {
            const selected = new Set(selectedIds);
            const data = buildSelectedWorldBookExport(selected);
            if (!Object.keys(data.entries || {}).length) return setStatus('请选择至少一个世界书条目', 'warn');
            const result = await downloadJson(data, `${state.currentNovel?.title || 'worldbook'}-worldbook.json`);
            if (result) setStatus(`已导出 ${Object.keys(data.entries).length} 条世界书`, 'success');
        },
    });
}

function exportCharacters() {
    if (!state.characters.length) return setStatus('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u89d2\u8272', 'warn');
    showExportSelectionDialog({
        title: '导出角色卡',
        subtitle: '选择要导出的角色。单个角色会导出标准角色卡 JSON，多个角色会导出催更姬角色合集。',
        items: state.characters.map((character, index) => ({
            id: String(index),
            title: character.data?.name || character.name || `角色 ${index + 1}`,
            meta: character.data?.group || character.group || character._source || '未分组',
            checked: true,
        })),
        onConfirm: async selectedIds => {
            const selected = selectedIds
                .map(id => Number(id))
                .filter(index => Number.isInteger(index) && state.characters[index]);
            if (!selected.length) return setStatus('请选择至少一个角色', 'warn');
            const characters = selected.map(index => state.characters[index]);
            if (characters.length === 1) {
                const name = characters[0].data?.name || characters[0].name || 'character';
                await downloadJson(characters[0], `${safeFilename(name)}.json`);
            } else {
                await downloadJson({
                    spec: 'cuigengji_character_bundle_v1',
                    exportedAt: Date.now(),
                    characters,
                }, `${state.currentNovel?.title || 'characters'}-characters.json`);
            }
            setStatus(`已导出 ${characters.length} 个角色`, 'success');
        },
    });
}

function buildSelectedWorldBookExport(selectedIds) {
    const source = state.worldBook || {};
    const entries = {};
    const folders = new Set();
    for (const [uid, entry] of Object.entries(source.entries || {})) {
        if (!selectedIds.has(String(uid))) continue;
        entries[uid] = { ...entry };
        const folder = getWorldBookFolder(entry);
        if (folder) folders.add(folder);
    }
    return {
        ...source,
        entries,
        folders: [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN')),
        sources: source.sources || {},
    };
}

function showExportSelectionDialog({ title, subtitle, items, onConfirm }) {
    document.getElementById('export-selection-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'export-selection-overlay';
    overlay.className = 'plot-modal-overlay';
    overlay.innerHTML = `
        <div class="plot-modal export-selection-modal">
            <div class="plot-modal-header">
                <div>
                    <h3>${escHtml(title)}</h3>
                    <p class="settings-subtitle">${escHtml(subtitle || '')}</p>
                </div>
                <button class="plot-modal-close" aria-label="关闭">×</button>
            </div>
            <div class="plot-modal-body" style="display:flex;flex-direction:column;gap:10px;">
                <div style="display:flex;gap:8px;justify-content:center;">
                    <button type="button" class="export-select-all" style="width:auto;min-height:auto;padding:5px 16px;font-size:11px;border-radius:var(--radius);border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;">全选</button>
                    <button type="button" class="export-select-none" style="width:auto;min-height:auto;padding:5px 16px;font-size:11px;border-radius:var(--radius);border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;">全不选</button>
                </div>
                <div class="export-selection-list" style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto;">
                    ${items.map(item => `
                        <label class="extract-check-row" style="align-items:center;">
                            <input type="checkbox" class="export-selection-check" value="${escAttr(item.id)}" ${item.checked ? 'checked' : ''}>
                            <span><b>${escHtml(item.title)}</b>${item.meta ? `<em>${escHtml(item.meta)}</em>` : ''}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="plot-modal-footer">
                <button type="button" class="ai-btn-secondary export-selection-cancel">取消</button>
                <button type="button" class="ai-btn-primary export-selection-confirm">导出选中</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
    overlay.querySelector('.export-selection-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('.export-select-all')?.addEventListener('click', () => {
        overlay.querySelectorAll('.export-selection-check').forEach(input => { input.checked = true; });
    });
    overlay.querySelector('.export-select-none')?.addEventListener('click', () => {
        overlay.querySelectorAll('.export-selection-check').forEach(input => { input.checked = false; });
    });
    overlay.querySelector('.export-selection-confirm')?.addEventListener('click', () => {
        const selectedIds = [...overlay.querySelectorAll('.export-selection-check:checked')].map(input => input.value);
        onConfirm?.(selectedIds);
        close();
    });
    requestAnimationFrame(() => overlay.classList.add('active'));
}

function safeFilename(value = 'export') {
    return String(value || 'export').replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
}

async function exportPreset() {
    await downloadJson({
        name: state.presetName || 'preset',
        ...state.aiConfig,
        prompts: state.promptTemplates || [],
        prompt_order: state.promptOrder || [],
    }, `${state.presetName || 'preset'}.json`);
}

async function importFolder() {
    try {
        const result = await Repositories.imports.selectFolder(state.currentNovel?.id);
        if (!result) return;
        await enterWorkspace(state.currentNovel.id, state.currentNovel.title);
    } catch (err) {
        setStatus(`\u6587\u4ef6\u5939\u5bfc\u5165\u5931\u8d25: ${err.message}`, 'error');
    }
}

async function importWorldBook() {
    try {
        await ensureNovelExists();
        const result = await Repositories.imports.selectWorldBook(state.currentNovel.id);
        if (!result) return;
        // Merge into existing entries instead of replacing
        const sourceName = result.name.replace(/\.json$/i, '');
        const incoming = result.entries || {};
        if (!state.worldBook) state.worldBook = { entries: {}, sources: {} };
        if (!state.worldBook.entries) state.worldBook.entries = {};
        if (!state.worldBook.sources) state.worldBook.sources = {};
        // Tag each entry with its source file
        for (const [uid, entry] of Object.entries(incoming)) {
            entry._source = sourceName;
            entry.folder = entry.folder || entry._folder || sourceName;
            if (entry.group && !entry.sourceGroup) entry.sourceGroup = entry.group;
        }
        Object.assign(state.worldBook.entries, incoming);
        ensureWorldBookFolders().add(sourceName);
        state.worldBook.sources[sourceName] = {
            name: sourceName,
            entryCount: Object.keys(incoming).length,
            importedAt: Date.now(),
        };
        renderWorldBookList();
        autoSave();
        setStatus(`✅ 世界书导入成功: ${result.entryCount} 个条目`, 'success');
    } catch (err) {
        setStatus(`世界书导入失败: ${err.message}`, 'error');
    }
}

async function importCharacters() {
    await ensureNovelExists();
    try {
        const result = await Repositories.imports.selectCharacters(state.currentNovel.id);
        if (!result) return;
        const imported = result.characters
            .map(item => item.character || item.data)
            .filter(Boolean);
        state.characters.push(...imported);
        renderCharacterList();
        autoSave();
        setStatus(`✅ 成功导入 ${imported.length} 个角色`, 'success');
    } catch (err) {
        setStatus(`角色导入失败: ${err.message}`, 'error');
    }
}

async function importPreset() {
    try {
        const result = await Repositories.imports.selectPreset(state.currentNovel.id);
        if (!result) return;
        const data = result.data;
        const importedName = result.name.replace(/\.json$/i, '');

        // Store full preset for reference
        state.importedPreset = data;
        state.presetName = importedName;

        // === 1. AI provider mapping ===
        if (data.chat_completion_source) {
            const providerMap = { openai: 'openai', claude: 'anthropic', openrouter: 'openrouter', makersuite: 'openai', ollama: 'ollama', deepseek: 'deepseek' };
            state.aiConfig.provider = providerMap[data.chat_completion_source] || state.aiConfig.provider;
        }

        // === 2. Model name ===
        if (data.openai_model) state.aiConfig.model = data.openai_model;
        if (data.claude_model && data.chat_completion_source === 'claude') state.aiConfig.model = data.claude_model;

        // === 3. Generation parameters ===
        if (data.temperature !== undefined) state.aiConfig.temperature = Number(data.temperature);
        if (data.top_p !== undefined) state.aiConfig.topP = Number(data.top_p);
        if (data.top_k !== undefined) state.aiConfig.topK = Number(data.top_k);
        if (data.min_p !== undefined) state.aiConfig.minP = Number(data.min_p);
        if (data.top_a !== undefined) state.aiConfig.topA = Number(data.top_a);
        if (data.repetition_penalty !== undefined) state.aiConfig.repetitionPenalty = Number(data.repetition_penalty);
        if (data.frequency_penalty !== undefined) state.aiConfig.frequencyPenalty = Number(data.frequency_penalty);
        if (data.presence_penalty !== undefined) state.aiConfig.presencePenalty = Number(data.presence_penalty);
        if (data.openai_max_context) state.aiConfig.maxContext = Number(data.openai_max_context);
        if (data.openai_max_tokens) state.aiConfig.maxTokens = Number(data.openai_max_tokens);
        if (data.stream_openai !== undefined) state.aiConfig.stream = data.stream_openai;
        if (data.seed !== undefined && data.seed >= 0) state.aiConfig.seed = data.seed;

        // === 4. Prompt templates (the key part!) ===
        if (Array.isArray(data.prompts)) {
            const isConfigTemplate = (p) => {
                const n = (p.name || '').toLowerCase();
                const c = (p.content || '').toLowerCase();
                return n.includes('spreset') || n.includes('regex') || n.includes('macro')
                    || c.includes('"chatsquash"') || c.includes('"regexbinding"')
                    || c.includes('"toolbindings"') || c.includes('"macronest"')
                    || c.includes('window.spresettempdata') || c.includes('window.sillytavern');
            };
            const isCgjImportMarker = p => /^cgj-import-(worldSetting|characterState|plotHistory|recentPlot)$/.test(String(p.identifier || ''));
            state.promptTemplates = data.prompts
                .filter(p => (p.content?.trim() || p.marker || isCgjImportMarker(p)) && !isConfigTemplate(p))
                .map(p => ({
                    identifier: p.identifier || '',
                    name: p.name || p.identifier || '',
                    role: p.role || 'system',
                    content: p.content || '',
                    isSystemPrompt: !!p.system_prompt,
                    isMarker: !!p.marker || isCgjImportMarker(p),
                    markerId: p.markerId || (isCgjImportMarker(p) ? p.identifier : ''),
                    enabled: p.enabled !== false && p.disabled !== true,
                    disabled: p.disabled === true || p.enabled === false,
                }));
        }

        // === 5. Prompt ordering / enabled state ===
        if (Array.isArray(data.prompt_order)) state.promptOrder = data.prompt_order;
        if (data.prompt_order) state.promptOrder = data.prompt_order;
        state.enabledTemplates = buildPresetEnabledTemplates(data, state.promptTemplates || []);

        // === 6. Special prompts ===
        if (!state.specialPrompts) state.specialPrompts = {};
        if (data.impersonation_prompt) state.specialPrompts.impersonation = data.impersonation_prompt;
        if (data.new_chat_prompt) state.specialPrompts.newChat = data.new_chat_prompt;
        if (data.continue_nudge_prompt) state.specialPrompts.continueNudge = data.continue_nudge_prompt;

        // === 7. Format strings ===
        if (!state.formatStrings) state.formatStrings = {};
        if (data.wi_format) state.formatStrings.worldInfo = data.wi_format;
        if (data.scenario_format) state.formatStrings.scenario = data.scenario_format;
        if (data.personality_format) state.formatStrings.personality = data.personality_format;

        // === 8. Other ===
        if (data.assistant_prefill) state.aiConfig.prefill = data.assistant_prefill;
        applyPresetReferenceSettings(data);

        // === 9. RegexBinding — extract from SPreset模板 content or top-level ===
        const extractRegexFrom = (src) => {
            if (!src?.regexes) return [];
            return src.regexes
                .filter(r => !r.disabled && !r.promptOnly)
                .map(r => ({ find: r.findRegex, replace: r.replaceString, name: r.scriptName || '' }));
        };
        // Try top-level first
        let regexRules = extractRegexFrom(data.RegexBinding);
        // Also scan prompt templates for SPreset配置 with embedded JSON
        if (!regexRules.length && Array.isArray(data.prompts)) {
            const spConfig = data.prompts.find(p => {
                const n = (p.name || '').toLowerCase();
                return n.includes('spreset') && (p.content || '').includes('RegexBinding');
            });
            if (spConfig) {
                try {
                    const embedded = JSON.parse(spConfig.content);
                    regexRules = extractRegexFrom(embedded.RegexBinding);
                } catch { /* not valid JSON */ }
            }
        }
        if (regexRules.length) {
            state.regexBindings = regexRules;
            updateRegexDisplay();
        }

        applyConfigToUI();
        saveConfig();

        // Remember as active preset
        const presetName = importedName;
        state.presetName = presetName;
        updatePresetNameDisplay(presetName);

        state.presets[presetName] = {
            name: presetName,
            provider: state.aiConfig.provider,
            model: state.aiConfig.model,
            temperature: state.aiConfig.temperature,
            maxTokens: state.aiConfig.maxTokens,
            topP: state.aiConfig.topP,
            topK: state.aiConfig.topK,
            memoryBudget: state.aiConfig.memoryBudget,
            maxContext: state.aiConfig.maxContext,
            frequencyPenalty: state.aiConfig.frequencyPenalty,
            presencePenalty: state.aiConfig.presencePenalty,
            stream: state.aiConfig.stream,
            prefill: state.aiConfig.prefill,
            referenceMode: state.aiConfig.referenceMode,
            compactReference: state.aiConfig.compactReference,
            referenceTools: state.aiConfig.referenceTools,
            enableReferenceTools: state.aiConfig.enableReferenceTools,
            savedAt: Date.now(),
            templates: state.promptTemplates || [],
            promptOrder: state.promptOrder || [],
            enabledTemplates: state.enabledTemplates || {},
        };
        updatePresetSelect();
        autoSave();

        // Summary
        const promptCount = state.promptTemplates?.length || 0;
        setStatus(`✅ 已导入并保存预设: ${presetName}`, 'success');

        // Show prompt templates in a dialog
        // Render template toggles in AI panel
        renderPromptTemplates();

        // Show prompt details dialog
        if (promptCount > 0) showPresetPrompts(result.name, state.promptTemplates);
    } catch (err) {
        setStatus(`预设导入失败: ${err.message}`, 'error');
    }
}

function toggleImportMenu() {
    const menu = $('#import-menu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) {
        const btn = $('#btn-import');
        const rect = btn.getBoundingClientRect();
        // Position below button, prevent right-edge overflow
        const menuWidth = menu.offsetWidth || 320;
        const left = Math.min(rect.left, window.innerWidth - menuWidth - 12);
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${Math.max(8, left)}px`;
    }
}

function handleImportAction(action) {
    if (action === 'import-folder') {
        void importFolder();
        return;
    }
    switch (action) {
        case 'import-document':
        case 'import-split':
            void importDocumentFromDialog();
            break;
        case 'import-worldbook': void importWorldBook(); break;
        case 'import-character': void importCharacters(); break;
        case 'import-preset': void importPreset(); break;
    }
}

// ==================== Sidebar Tabs ====================
