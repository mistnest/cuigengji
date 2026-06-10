/**
 * Novel AI Editor — Chat Panel (Dual Mode)
 * 📝 正文模式 — AI 协作写作，接受/重试/修改
 * 📚 设定制作 — 讨论创作、辅助生成世界书/角色卡
 */
const ChatPanel = (function () {
    'use strict';

    // State per mode
    const messages = { write: [], assist: [] };
    const isLoading = { write: false, assist: false };
    let currentMode = 'write';

    // ==================== Init ====================
    function init() {
        // Mode tab switching
        document.querySelectorAll('.chat-mode-tab').forEach(tab => {
            tab.addEventListener('click', () => switchMode(tab.dataset.mode));
        });

        // Bind send buttons
        document.querySelectorAll('.chat-send-btn').forEach(btn => {
            btn.addEventListener('click', () => sendMessage(btn.dataset.mode));
        });

        // Bind stop buttons
        document.querySelectorAll('.chat-stop-btn').forEach(btn => {
            btn.addEventListener('click', stopGeneration);
        });

        // Bind clear buttons
        document.querySelectorAll('.chat-clear-btn').forEach(btn => {
            btn.addEventListener('click', () => clearChat(btn.dataset.mode));
        });

        // Bind input enter key
        ['write', 'assist'].forEach(mode => {
            const input = document.getElementById(`chat-input-${mode}`);
            if (input) {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage(mode);
                    }
                });
                input.addEventListener('input', autoResizeInput);
            }
        });

        // Quick action buttons in assist mode (event delegation — survives clear)
        document.getElementById('chat-messages-assist')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.assist-quick-btn');
            if (btn?.dataset.prompt) {
                const input = document.getElementById('chat-input-assist');
                if (input) {
                    input.value = btn.dataset.prompt;
                    sendMessage('assist');
                }
            }
        });

        // Bind inline import preset button
        const inlineBtn = document.getElementById('btn-import-preset-inline');
        if (inlineBtn) {
            inlineBtn.addEventListener('click', () => {
                document.getElementById('file-input-preset')?.click();
            });
        }

        // Listen for JSON extraction in assist mode
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('chat-extract-json-btn')) {
                const jsonStr = e.target.dataset.json;
                handleExtractedJSON(jsonStr);
            }
        });
    }

    // ==================== Mode Switching ====================
    function switchMode(mode) {
        currentMode = mode;
        document.querySelectorAll('.chat-mode-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === mode);
        });
        document.querySelectorAll('.chat-mode-panel').forEach(p => {
            p.classList.toggle('active', p.id === `chat-mode-${mode}`);
        });
        // Focus the right input
        const input = document.getElementById(`chat-input-${mode}`);
        if (input) setTimeout(() => input.focus(), 100);
    }

    function getActiveMode() {
        return currentMode;
    }

    // ==================== Send Message ====================
    async function sendMessage(mode, directPrompt) {
        const input = document.getElementById(`chat-input-${mode}`);
        const text = directPrompt || (input ? input.value.trim() : '');
        if (!text) return;

        // Only clear input if this is a user-initiated message (not retry/revise)
        if (!directPrompt && input) {
            input.value = '';
            autoResizeInput({ target: input });
        }

        // Add user message (only for non-retry)
        if (!directPrompt) {
            addMessage(mode, 'user', text);
        }

        // Add loading
        const loadingId = addLoading(mode);
        isLoading[mode] = true;
        updateButtons(mode);

        try {
            const context = collectContext();
            const reply = await callAPI(mode, text, context, mode === 'write' ? 'write' : 'chat');

            removeMessage(loadingId);

            if (reply) {
                const msg = addMessage(mode, 'assistant', reply);

                // In write mode, show Accept/Retry/Revise buttons
                if (mode === 'write') {
                    if (msg) {
                        const el = document.getElementById(msg.id);
                        if (el) el._userPrompt = text;
                    }
                    addReviewButtons(msg, reply, text);
                }

                // In assist mode, detect JSON blocks for saving
                if (mode === 'assist') {
                    detectAndOfferSave(msg, reply);
                }
            } else {
                addMessage(mode, 'assistant', '*(未收到回复)*');
            }
        } catch (err) {
            removeMessage(loadingId);
            if (err.name !== 'AbortError') {
                addMessage(mode, 'assistant', `❌ **出错**: ${err.message}`);
            }
        } finally {
            isLoading[mode] = false;
            updateButtons(mode);
            // Trigger auto-save
            try { localStorage.setItem('novel-editor-chat', JSON.stringify(messages)); } catch(e) {}
        }
    }

    function stopGeneration() {
        // Will be wired when we add AbortController support
        isLoading[currentMode] = false;
        updateButtons(currentMode);
    }

    // ==================== API Call ====================
    async function callAPI(mode, userMessage, context, type) {
        const aiConfig = getConfig();
        if (!aiConfig.apiKey && aiConfig.provider !== 'ollama') {
            throw new Error('请先在 🤖 AI 面板配置 API Key');
        }

        const history = messages[mode].slice(-20).map(m => ({
            role: m.role,
            content: m.rawContent || m.content,  // Send raw content without markup
        }));

        let endpoint, body;

        if (mode === 'write') {
            // Tavern-like write mode
            endpoint = '/api/chat/write';
            body = {
                message: userMessage,
                history,
                context,
                config: aiConfig,
                promptTemplates: getEnabledTemplates(),
            };
        } else {
            // CC-like assist mode
            endpoint = '/api/chat';
            body = {
                message: userMessage,
                history,
                context,
                config: aiConfig,
            };
        }

        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        return data.reply;
    }

    // ==================== Message Rendering ====================
    function addMessage(mode, role, content) {
        const msgList = document.getElementById(`chat-messages-${mode}`);
        if (!msgList) return null;

        // Remove welcome message if present
        const welcome = msgList.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const el = document.createElement('div');
        el.className = `chat-message chat-msg-${role}`;
        el.id = id;

        const avatar = role === 'user' ? '👤' : '🤖';
        const name = role === 'user' ? '你' : 'AI';

        el.innerHTML = `
            <div class="chat-msg-avatar">${avatar}</div>
            <div class="chat-msg-body">
                <div class="chat-msg-header">
                    <span class="chat-msg-role">${name}</span>
                    <span class="chat-msg-time">${now()}</span>
                </div>
                <div class="chat-msg-content">${renderMD(content)}</div>
                <div class="chat-msg-actions"></div>
            </div>
        `;

        msgList.appendChild(el);
        scrollBottom(msgList);

        const msg = { id, role, content, rawContent: content };
        messages[mode].push(msg);
        return msg;
    }

    function addReviewButtons(msg, text, userPrompt) {
        if (!msg) return;
        const el = document.getElementById(msg.id);
        if (!el) return;
        const actionsEl = el.querySelector('.chat-msg-actions');
        if (!actionsEl) return;

        // Container
        const bar = document.createElement('div');
        bar.className = 'chat-review-bar';

        // ✅ Accept
        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'chat-review-btn accept';
        acceptBtn.textContent = '✅ 接受';
        acceptBtn.title = '写入编辑器';
        acceptBtn.addEventListener('click', () => {
            insertToEditor(text);
            bar.innerHTML = '<span class="chat-review-done">✅ 已写入编辑器</span>';
        });

        // 🔄 Retry
        const retryBtn = document.createElement('button');
        retryBtn.className = 'chat-review-btn retry';
        retryBtn.textContent = '🔄 重试';
        retryBtn.title = '重新生成';
        retryBtn.addEventListener('click', () => {
            // Remove this message
            el.remove();
            const idx = messages.write.findIndex(m => m.id === msg.id);
            if (idx >= 0) messages.write.splice(idx, 1);
            // Re-send the same prompt
            sendMessage('write', userPrompt);
        });

        // ✏️ Revise
        const reviseBtn = document.createElement('button');
        reviseBtn.className = 'chat-review-btn revise';
        reviseBtn.textContent = '✏️ 修改';
        reviseBtn.title = '输入修改意见';
        reviseBtn.addEventListener('click', () => {
            showReviseInput(msg.id, text, userPrompt);
        });

        bar.appendChild(acceptBtn);
        bar.appendChild(retryBtn);
        bar.appendChild(reviseBtn);
        actionsEl.appendChild(bar);
    }

    function showReviseInput(msgId, originalText, userPrompt) {
        const el = document.getElementById(msgId);
        if (!el) return;
        const actionsEl = el.querySelector('.chat-msg-actions');
        if (!actionsEl) return;

        // Replace buttons with input
        actionsEl.innerHTML = '';
        const reviseBar = document.createElement('div');
        reviseBar.className = 'chat-revise-bar';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'chat-revise-input';
        input.placeholder = '输入修改意见，如：写得更热血、减少对话...';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doRevise();
        });

        const goBtn = document.createElement('button');
        goBtn.className = 'chat-review-btn revise';
        goBtn.textContent = '🚀 重新生成';
        goBtn.addEventListener('click', doRevise);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'chat-review-btn retry';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => {
            // Restore original buttons
            actionsEl.innerHTML = '';
            addReviewButtons({ id: msgId }, originalText, userPrompt);
        });

        function doRevise() {
            const instruction = input.value.trim();
            if (!instruction) return;
            // Remove this message
            el.remove();
            const idx = messages.write.findIndex(m => m.id === msgId);
            if (idx >= 0) messages.write.splice(idx, 1);
            // Re-send with revision instruction
            const revisedPrompt = `${userPrompt}\n\n【修改意见】${instruction}`;
            sendMessage('write', revisedPrompt);
        }

        reviseBar.appendChild(input);
        reviseBar.appendChild(goBtn);
        reviseBar.appendChild(cancelBtn);
        actionsEl.appendChild(reviseBar);
        setTimeout(() => input.focus(), 100);
    }

    function insertToEditor(text) {
        const editor = document.getElementById('chapter-editor');
        if (!editor) return;

        // Clean up the text a bit
        let clean = text
            .replace(/^```[\s\S]*?\n/, '')  // Remove opening code fence
            .replace(/\n```$/, '');           // Remove closing code fence

        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const before = editor.value.substring(0, start);
        const after = editor.value.substring(end);

        // Add spacing
        const spacer = before && !before.endsWith('\n') ? '\n\n' : '';
        editor.value = before + spacer + clean + '\n' + after;

        // Move cursor after inserted text
        const newPos = start + spacer.length + clean.length + 1;
        editor.selectionStart = editor.selectionEnd = newPos;

        // Trigger input event
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.focus();
        editor.scrollTop = editor.scrollHeight;

        // Update status
        const statusEl = document.getElementById('status-message');
        if (statusEl) {
            statusEl.textContent = '✅ 内容已写入编辑器';
            statusEl.className = 'status-success';
            setTimeout(() => { statusEl.textContent = '就绪'; statusEl.className = ''; }, 3000);
        }
    }

    function addLoading(mode) {
        const msgList = document.getElementById(`chat-messages-${mode}`);
        if (!msgList) return null;

        const id = `loading_${Date.now()}`;
        const el = document.createElement('div');
        el.className = 'chat-message chat-msg-assistant';
        el.id = id;
        el.innerHTML = `
            <div class="chat-msg-avatar">🤖</div>
            <div class="chat-msg-body">
                <div class="chat-msg-header"><span class="chat-msg-role">AI</span></div>
                <div class="chat-msg-content">
                    <div class="chat-loading"><span></span><span></span><span></span></div>
                </div>
            </div>
        `;
        msgList.appendChild(el);
        scrollBottom(msgList);
        return id;
    }

    function removeMessage(id) {
        if (!id) return;
        const el = document.getElementById(id);
        if (el) el.remove();
        // Also remove from messages array
        for (const mode of ['write', 'assist']) {
            const idx = messages[mode].findIndex(m => m.id === id);
            if (idx >= 0) messages[mode].splice(idx, 1);
        }
    }

    function clearChat(mode) {
        messages[mode] = [];
        const msgList = document.getElementById(`chat-messages-${mode}`);
        if (!msgList) return;

        if (mode === 'write') {
            msgList.innerHTML = `
                <div class="chat-welcome">
                    <p><strong>📝 正文模式</strong> — AI 协作写作</p>
                    <p>你提要求，AI 生成。然后选择 <strong>✅接受 / 🔄重试 / ✏️修改</strong></p>
                    <p class="chat-welcome-hint">像 Claude Code 审阅代码一样审阅你的小说段落。</p>
                </div>`;
        } else {
            msgList.innerHTML = `
                <div class="chat-welcome">
                    <div class="chat-welcome assist-welcome">
                    <p><strong>📚 设定制作模式</strong></p>
                    <p>我会引导你一步步创建角色卡和世界书。</p>
                    <p class="chat-welcome-hint">选择一个开始，或者直接描述你想要的设定：</p>
                    <div class="assist-quick-actions">
                        <button class="assist-quick-btn" data-prompt="我想创建一个新角色，帮我从零开始引导。">👤 创建角色卡</button>
                        <button class="assist-quick-btn" data-prompt="我想添加新的世界观条目。">📚 创建世界书条目</button>
                        <button class="assist-quick-btn" data-prompt="帮我分析一下已有角色之间的关系和设定完整性。">🔍 评估已有设定</button>
                        <button class="assist-quick-btn" data-prompt="我有一段角色/世界观的材料，帮我整理转化成角色卡或世界书条目。">📄 从材料转化</button>
                    </div>
                    </div>
                </div>`;
        }
    }

    // ==================== Context ====================
    function collectContext() {
        const editor = document.getElementById('chapter-editor');
        const text = editor?.value || '';
        const state = window.editorState || {};

        return {
            currentText: text.slice(-2000),
            chapterTitle: document.getElementById('chapter-title-input')?.value || '',
            worldBookEntries: getWorldBookSummary(state),
            characters: getCharacterSummary(state),
            outline: getOutlineSummary(state),
            novelTitle: state.currentNovel?.title || '',
        };
    }

    function getWorldBookSummary(state) {
        const entries = state.worldBook?.entries || {};
        return Object.values(entries).filter(e => !e.disable).slice(0, 10).map(e => ({
            name: e.comment || e.key?.[0] || '',
            content: e.content?.substring(0, 200) || '',
        }));
    }

    function getCharacterSummary(state) {
        return (state.characters || []).slice(0, 8).map(c => ({
            name: c.data?.name || c.name || '',
            description: (c.data?.description || c.description || '').substring(0, 150),
        })).filter(c => c.name);
    }

    function getOutlineSummary(state) {
        return (state.outline || []).slice(0, 10).map(n => ({
            title: n.title,
            description: n.description || '',
            completed: n.completed,
        }));
    }

    function getConfig() {
        return window.editorState?.aiConfig || {};
    }

    function getEnabledTemplates() {
        const state = window.editorState || {};
        if (!state.promptTemplates) return [];
        if (!state.enabledTemplates) return state.promptTemplates; // All enabled by default
        return state.promptTemplates.filter(t => state.enabledTemplates[t.identifier] !== false);
    }

    // ==================== Rendering ====================
    function renderMD(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
    }

    function now() {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function scrollBottom(el) {
        setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
    }

    function autoResizeInput(e) {
        const t = e.target;
        t.style.height = 'auto';
        t.style.height = Math.min(Math.max(t.scrollHeight, 40), 180) + 'px';
    }

    // ==================== JSON Extraction ====================

    function detectAndOfferSave(msg, text) {
        if (!msg || !text) return;
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch) return;

        const el = document.getElementById(msg.id);
        if (!el) return;
        const actionsEl = el.querySelector('.chat-msg-actions');
        if (!actionsEl) return;

        try {
            const parsed = JSON.parse(jsonMatch[1]);
            const isCharCard = parsed.name && (parsed.description || parsed.personality);
            const isWorldEntry = parsed.key && parsed.content;
            const label = isCharCard ? '💾 保存为角色卡' : isWorldEntry ? '💾 保存为世界书条目' : '💾 保存';

            const btn = document.createElement('button');
            btn.className = 'chat-extract-json-btn';
            btn.textContent = label;
            btn.title = '保存此设定到项目中';
            btn.dataset.json = JSON.stringify(parsed);
            actionsEl.appendChild(btn);
        } catch {
            // Not valid JSON, ignore
        }
    }

    function handleExtractedJSON(jsonStr) {
        try {
            const data = JSON.parse(jsonStr);
            const state = window.editorState || {};

            if (data.name && (data.description || data.personality)) {
                // This is a character card
                if (!state.characters) state.characters = [];
                // Wrap in ST-compatible format
                const charCard = {
                    spec: 'chara_card_v3',
                    spec_version: '3.0',
                    data: {
                        name: data.name,
                        description: data.description || '',
                        personality: data.personality || '',
                        scenario: data.scenario || '',
                        first_mes: data.first_mes || '',
                        mes_example: data.mes_example || '',
                        tags: data.tags || [],
                        creator_notes: '',
                        system_prompt: '',
                        post_history_instructions: '',
                        character_book: data.character_book || { entries: {} },
                    },
                };
                state.characters.push(charCard);
                // Trigger re-render if function available
                if (typeof window.renderCharacterList === 'function') window.renderCharacterList();
                showToast(`✅ 已保存角色: ${data.name}`);
            } else if (data.key && data.content) {
                // This is a world book entry
                if (!state.worldBook) state.worldBook = { entries: {} };
                const nextUid = Math.max(0, ...Object.keys(state.worldBook.entries).map(Number)) + 1;
                state.worldBook.entries[nextUid] = {
                    uid: nextUid,
                    key: Array.isArray(data.key) ? data.key : [data.key],
                    keysecondary: data.keysecondary || [],
                    content: data.content,
                    comment: data.comment || data.key?.[0] || `条目${nextUid}`,
                    constant: data.constant || false,
                    selective: true,
                    order: data.order || 100,
                    position: data.position || 0,
                    disable: false,
                    group: data.group || '',
                    groupWeight: 100,
                    sticky: 0,
                    cooldown: 0,
                    probability: 100,
                    depth: data.depth || 4,
                    role: null,
                    caseSensitive: null,
                    matchWholeWords: null,
                    useGroupScoring: null,
                    scanDepth: null,
                    automationId: '',
                };
                if (typeof window.renderWorldBookList === 'function') window.renderWorldBookList();
                showToast(`✅ 已保存世界书条目: ${data.comment || data.key?.[0] || '新条目'}`);
            }
        } catch (e) {
            console.error('Failed to save extracted JSON:', e);
            showToast('❌ 保存失败，格式不正确');
        }
    }

    function showToast(msg) {
        const el = document.getElementById('status-message');
        if (!el) return;
        el.textContent = msg;
        el.className = 'status-success';
        clearTimeout(el._toast);
        el._toast = setTimeout(() => { el.textContent = '就绪'; el.className = ''; }, 4000);
    }

    // Expose render functions for the save flow
    window.renderCharacterList = null;  // Will be set from app.js
    window.renderWorldBookList = null;

    // ==================== Update UI ====================
    function updateButtons(mode) {
        document.querySelectorAll(`.chat-send-btn[data-mode="${mode}"]`).forEach(b => {
            b.style.display = isLoading[mode] ? 'none' : '';
        });
        document.querySelectorAll(`.chat-stop-btn`).forEach(b => {
            b.style.display = isLoading[mode] ? '' : 'none';
        });
    }

    // ==================== Public ====================
    return {
        init,
        sendMessage,
        clearChat,
        getActiveMode,
        insertToEditor,
        getMessages: () => messages,
        loadMessages: (saved) => {
            if (saved?.write) messages.write = saved.write;
            if (saved?.assist) messages.assist = saved.assist;
            // Re-render
            ['write', 'assist'].forEach(mode => {
                const msgList = document.getElementById(`chat-messages-${mode}`);
                if (!msgList) return;
                const welcome = msgList.querySelector('.chat-welcome');
                if (welcome) welcome.remove();
                messages[mode].forEach(m => {
                    addMessage(mode, m.role, m.rawContent || m.content);
                });
            });
        },
    };
})();
