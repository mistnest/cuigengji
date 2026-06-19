/**
 * 催更姬 — Unified Chat Panel
 * 单一聊天面板，模式选择器在输入区
 */
const ChatPanel = (function () {
    'use strict';
    const ApiClient = window.ApiClient;

    const messages = [];
    let currentMode = 'write';
    let isLoading = false;
    let activeSessionId = 'default';
    let onSwitchSessionCb = null;  // Callback to app.js
    let onDeleteSessionCb = null;
    let onNewSessionCb = null;
    let activeRequestController = null;

    // Streaming state
    let streamingActive = false;
    let streamAbortController = null;
    let streamMsgId = null;
    let streamAccumulatedText = '';
    let streamRenderedText = '';
    let streamPendingText = '';
    let streamReasoningBlocks = [];
    let streamMetaData = null;
    let streamThinkTimer = null;
    let streamTypewriterTimer = null;
    let streamPendingFinalize = null;
    let streamUserScrollLocked = false;
    let streamUserPrompt = '';

    const MESSAGE_PAGE_SIZE = 15;
    let renderedStart = 0;

    // ==================== Init ====================
    function init() {
        // Mode popover
        const modeCurrent = document.getElementById('mode-current');
        if (modeCurrent) {
            modeCurrent.addEventListener('click', () => {
                document.getElementById('mode-dropdown').classList.toggle('open');
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('#mode-popover')) document.getElementById('mode-dropdown').classList.remove('open');
            });
        }

        // History popover toggle
        const btnHistory = document.getElementById('btn-history');
        if (btnHistory) {
            btnHistory.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('chat-history-dropdown').classList.toggle('open');
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('#chat-history-popover')) {
                    document.getElementById('chat-history-dropdown').classList.remove('open');
                }
            });
        }

        // New chat button
        const btnNewChat = document.getElementById('btn-new-chat');
        if (btnNewChat) {
            btnNewChat.addEventListener('click', () => {
                document.getElementById('chat-history-dropdown').classList.remove('open');
                if (onNewSessionCb) onNewSessionCb();
            });
        }

        // Session search filter
        const searchInput = document.getElementById('session-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => filterSessions(searchInput.value));
        }

        // Session list click delegation
        const sessionList = document.getElementById('session-list');
        if (sessionList) {
            sessionList.addEventListener('click', (e) => {
                const item = e.target.closest('.chat-history-item');
                if (!item) return;
                const id = item.dataset.sessionId;

                if (e.target.closest('.sess-delete')) {
                    // Delete
                    e.stopPropagation();
                    document.getElementById('chat-history-dropdown').classList.remove('open');
                    if (onDeleteSessionCb) onDeleteSessionCb(id);
                } else {
                    // Switch
                    document.getElementById('chat-history-dropdown').classList.remove('open');
                    if (onSwitchSessionCb && id !== activeSessionId) onSwitchSessionCb(id);
                }
            });
        }

        // Mode dropdown items
        document.querySelectorAll('.cc-dropdown-item[data-mode]').forEach(btn => {
            btn.addEventListener('click', () => switchMode(btn.dataset.mode));
        });

        // Quick command buttons
        document.querySelectorAll('.cc-cmd-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById('chat-input');
                if (input && btn.dataset.cmd) {
                    input.value = btn.dataset.cmd + ': ';
                    input.focus();
                }
            });
        });

        // Context circle — hover tooltip + click to compress
        const ctxCircle = document.getElementById('ctx-circle');
        if (ctxCircle) {
            ctxCircle.addEventListener('click', compressContext);
            ctxCircle.addEventListener('mouseenter', () => {
                const pct = estimateContextUsage();
                ctxCircle.title = `上下文用量: ${pct}% (点击压缩)`;
            });
        }

        // Send
        document.getElementById('btn-send').addEventListener('click', () => sendMessage());
        document.getElementById('btn-stop').addEventListener('click', () => stopGeneration());

        // Input Enter key
        const input = document.getElementById('chat-input');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(Math.max(input.scrollHeight, 40), 180) + 'px';
        });

        // Quick action buttons in assist welcome
        document.getElementById('chat-messages')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.assist-quick-btn');
            if (btn?.dataset.prompt) {
                input.value = btn.dataset.prompt;
                sendMessage();
            }
        });
        document.getElementById('chat-messages')?.addEventListener('scroll', onMessageScroll);
    }

    // ==================== Mode Switching ====================
    function updateModeLabel() {
        const modeNames = { write: '正文', plan: '研讨', assist: '设定' };
        const modeDescs = { write: '正文模式 — AI 协作续写', plan: '情节研讨 — 多方案剧情分析', assist: '设定制作 — 创建角色卡/世界书' };
        const label = document.getElementById('mode-current');
        if (label) label.textContent = modeNames[currentMode] || '正文';
        const desc = document.getElementById('mode-desc');
        if (desc) desc.textContent = modeDescs[currentMode] || '';
    }

    function switchMode(mode) {
        currentMode = mode;
        // Update dropdown active state
        document.querySelectorAll('.cc-dropdown-item[data-mode]').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
        updateModeLabel();
        const input = document.getElementById('chat-input');

        if (mode === 'assist') {
            input.placeholder = '设定制作 — 直接描述你想要的角色或世界观...';
        } else if (mode === 'plan') {
            input.placeholder = '情节研讨 — 描述你的情节困惑，AI 给出多方案分析...';
        } else {
            input.placeholder = '正文模式 — 让 AI 写一段...';
        }
        input.focus();
    }

    // ==================== Send ====================
    let _sessionAutoNamed = false;

    async function sendMessage(directPrompt) {
        const input = document.getElementById('chat-input');
        const text = directPrompt || input.value.trim();
        if (!text || isLoading) return;

        if (!directPrompt) input.value = '';
        addMessage('user', text, currentMode);

        // Auto-name session on first message (CC-style)
        if (!_sessionAutoNamed && window.autoNameSession) {
            _sessionAutoNamed = true;
            window.autoNameSession(text);
        }

        await sendMessageStream(text);
    }

    // ==================== Streaming Send ====================

    async function sendMessageStream(text) {
        const loadingId = addLoading();
        isLoading = true;
        updateButtons();

        // Thinking timer for tool-calling wait
        let thinkSeconds = 0;
        streamThinkTimer = setInterval(() => {
            thinkSeconds++;
            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) {
                const thinkText = loadingEl.querySelector('.chat-thinking');
                if (thinkText && thinkSeconds <= 30) {
                    thinkText.innerHTML = 'Thinking<span class="chat-thinking-dots"><span></span><span></span><span></span></span> (' + thinkSeconds + 's)';
                } else if (thinkText && thinkSeconds > 30) {
                    thinkText.textContent = '正在检索设定...';
                }
            }
        }, 1000);

        const endpoint = currentMode === 'write' ? '/api/chat/write' :
                        currentMode === 'plan' ? '/api/chat/plan' : '/api/chat';
        const context = collectContext();
        streamAbortController = new AbortController();
        streamAccumulatedText = '';
        streamRenderedText = '';
        streamPendingText = '';
        streamReasoningBlocks = [];
        streamMetaData = null;
        streamPendingFinalize = null;
        streamUserScrollLocked = false;
        streamingActive = false;
        streamMsgId = null;
        streamUserPrompt = text;

        try {
            await startStream(endpoint, text, context, streamAbortController.signal);
        } catch (err) {
            if (err.name === 'AbortError') {
                // User clicked stop — keep partial content
                if (streamMsgId && streamAccumulatedText) {
                    finalizePartialMessage(streamMsgId, streamAccumulatedText, streamReasoningBlocks);
                } else {
                    removeMessage(loadingId);
                }
            } else {
                // Real error
                removeMessage(loadingId);
                if (streamMsgId) removeMessage(streamMsgId);
                addMessage('assistant', `❌ ${err.message}`, currentMode, { transient: true });
            }
        } finally {
            clearInterval(streamThinkTimer);
            streamThinkTimer = null;
            streamingActive = false;
            streamMsgId = null;
            streamAbortController = null;
            if (!streamPendingFinalize) stopStreamTypewriter();
            isLoading = false;
            updateButtons();
        }
    }

    // ==================== Removed Non-Streaming Path ====================

    async function removedNonStreamingFallback(text) {
        const loadingId = addLoading();
        isLoading = true;
        updateButtons();

        try {
            const context = collectContext();
            const endpoint = currentMode === 'write' ? '/api/chat/write' :
                            currentMode === 'plan' ? '/api/chat/plan' : '/api/chat';
            activeRequestController = new AbortController();
            const rawReply = await removedNonStreamingApiCall(endpoint, text, context, activeRequestController.signal);
            let reply = typeof window.applyRegexBindings === 'function'
                ? window.applyRegexBindings(rawReply) : rawReply;

            removeMessage(loadingId);
            if (reply) {
                const msg = addMessage('assistant', reply, currentMode);
                if (currentMode === 'write') addReviewButtons(msg, reply, text);
                window.onAISuccess?.();
            } else {
                addMessage('assistant', '*(未收到回复)*', currentMode);
            }
        } catch (err) {
            removeMessage(loadingId);
            if (err.name !== 'AbortError') addMessage('assistant', `❌ ${err.message}`, currentMode, { transient: true });
        } finally {
            activeRequestController = null;
            isLoading = false;
            updateButtons();
            window.saveActiveChatSession?.();
        }
    }

    function stopGeneration() {
        if (streamAbortController) {
            streamAbortController.abort();
        }
        updateButtons();
    }

    // ==================== Stream Core: SSE Fetch & Parse ====================

    async function startStream(endpoint, userMessage, context, signal) {
        const config = { ...getConfig(), stream: true };
        const presetName = window.editorState?.presetName || '__default__';
        const history = buildModelHistory();

        const body = {
            message: userMessage,
            history,
            context,
            config,
            presetName,
            promptTemplates: getEnabledTemplates(),
            promptOrder: window.editorState?.promptOrder || [],
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || 'HTTP ' + response.status);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
            // Chat generation is streaming-only.
            throw new Error('后端未返回流式响应');
        }

        // SSE streaming
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        return new Promise((resolve, reject) => {
            let stopped = false;

            async function read() {
                try {
                    while (!stopped) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const jsonStr = line.slice(6);
                                try {
                                    const event = JSON.parse(jsonStr);
                                    const shouldStop = processStreamEvent(event);
                                    if (shouldStop) { stopped = true; resolve(); return; }
                                } catch { /* skip malformed JSON line */ }
                            }
                        }
                    }
                    resolve();
                } catch (err) {
                    reject(err);
                }
            }
            read();
        });
    }

    function processStreamEvent(event) {
        switch (event.type) {
            case 'chunk':
                if (!streamMsgId) {
                    // First chunk — replace loading with stream message
                    clearInterval(streamThinkTimer);
                    const loadingEl = document.querySelector('.chat-message[id^="loading_"]');
                    if (loadingEl) loadingEl.remove();
                    const result = createStreamMessage('assistant', currentMode);
                    streamMsgId = result.id;
                    streamingActive = true;
                }
                streamAccumulatedText += event.content || '';
                enqueueStreamChunk(streamMsgId, event.content || '');
                break;

            case 'reasoning':
                if (!streamMsgId) {
                    clearInterval(streamThinkTimer);
                    const loadingEl = document.querySelector('.chat-message[id^="loading_"]');
                    if (loadingEl) loadingEl.remove();
                    const result = createStreamMessage('assistant', currentMode);
                    streamMsgId = result.id;
                    streamingActive = true;
                }
                streamReasoningBlocks.push(event.content || '');
                appendStreamReasoning(streamMsgId, event.content || '');
                break;

            case 'meta':
                streamMetaData = event;
                if (event.contextDebug) window.lastContextDebug = event.contextDebug;
                break;

            case 'done':
                streamingActive = false;  // Allow session save to proceed
                if (streamMsgId) {
                    const fullReply = event.reply || streamAccumulatedText;
                    finalizeStreamMessageAfterTypewriter(streamMsgId, fullReply, streamReasoningBlocks, currentMode, streamUserPrompt);
                }
                window.saveActiveChatSession?.();
                window.onAISuccess?.();
                return true;  // Signal stream complete

            case 'error':
                throw new Error(event.message || 'Stream error');

            default:
                break;
        }
        return false;
    }

    // ==================== Stream DOM Helpers ====================

    function createStreamMessage(role, mode) {
        const msgList = document.getElementById('chat-messages');
        if (!msgList) return null;
        const welcome = msgList.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const el = document.createElement('div');
        el.className = 'chat-message chat-msg-' + role + ' chat-message-streaming';
        el.id = id;
        const name = role === 'user' ? 'You' : 'AI';
        const modeLabel = mode === 'assist' ? '<span class="chat-msg-mode-badge">设定</span>' : '';

        el.innerHTML = '<div class="chat-msg-avatar"></div><div class="chat-msg-body">' +
            '<div class="chat-msg-header"><span class="chat-msg-role">' + name + '</span>' + modeLabel + '<span class="chat-msg-time">' + now() + '</span></div>' +
            '<div class="chat-msg-content"></div>' +
            '<div class="chat-msg-actions"></div>' +
            '</div>';
        msgList.appendChild(el);
        scrollBottom(msgList, { force: true });

        const msg = { id: id, role: role, content: '', rawContent: '', mode: mode };
        messages.push(msg);
        renderedStart = Math.max(0, messages.length - MESSAGE_PAGE_SIZE);
        while (msgList.querySelectorAll('.chat-message').length > MESSAGE_PAGE_SIZE) {
            msgList.querySelector('.chat-message')?.remove();
        }
        return msg;
    }

    function enqueueStreamChunk(msgId, text) {
        if (!text) return;
        streamPendingText += text;
        if (streamTypewriterTimer) return;
        streamTypewriterTimer = setInterval(() => drainStreamChunkQueue(msgId), 24);
    }

    function drainStreamChunkQueue(msgId) {
        if (!streamPendingText) {
            stopStreamTypewriter();
            return;
        }
        const chars = Array.from(streamPendingText);
        const take = chars.length > 160 ? 4 : chars.length > 40 ? 2 : 1;
        streamRenderedText += chars.slice(0, take).join('');
        streamPendingText = chars.slice(take).join('');
        renderStreamChunk(msgId);
        if (!streamPendingText && streamPendingFinalize) {
            const finalize = streamPendingFinalize;
            streamPendingFinalize = null;
            stopStreamTypewriter();
            finalize();
        }
    }

    function flushStreamChunkQueue(msgId) {
        if (streamPendingText) {
            streamRenderedText += streamPendingText;
            streamPendingText = '';
            renderStreamChunk(msgId);
        }
        stopStreamTypewriter();
    }

    function stopStreamTypewriter() {
        if (!streamTypewriterTimer) return;
        clearInterval(streamTypewriterTimer);
        streamTypewriterTimer = null;
    }

    function finalizeStreamMessageAfterTypewriter(msgId, fullText, reasoningBlocks, mode, userPrompt) {
        const finalize = () => finalizeStreamMessage(msgId, fullText, reasoningBlocks, mode, userPrompt);
        if (streamPendingText || streamTypewriterTimer) {
            streamPendingFinalize = finalize;
            return;
        }
        finalize();
    }

    function renderStreamChunk(msgId) {
        const el = document.getElementById(msgId);
        if (!el) return;
        const contentEl = el.querySelector('.chat-msg-content');
        if (!contentEl) return;
        const msgList = el.closest('.chat-messages');
        const keepAtBottom = !streamUserScrollLocked && shouldAutoScroll(msgList);
        // Strip XML wrapper tags for streaming display (raw text kept in streamAccumulatedText)
        const displayText = stripXmlForStreaming(streamRenderedText);
        contentEl.innerHTML = escHtml(displayText).replace(/\n/g, '<br>');
        scrollBottom(msgList, { force: keepAtBottom });
        // Update message object — keep raw accumulated text for final structured render
        const msg = messages.find(m => m.id === msgId);
        if (msg) { msg.content = streamAccumulatedText; msg.rawContent = streamAccumulatedText; }
    }

    // Remove XML wrapper tags for clean streaming display, keep inner text
    function stripXmlForStreaming(text) {
        let result = String(text || '');
        // Replace full tag pairs: show inner content only
        result = result.replace(/<refine\s*>[\s\S]*?<\/refine\s*>/gi, '\n[润色建议 — 完成后显示]\n');
        result = result.replace(/<details\s*>([\s\S]*?)<\/details\s*>/gi, (_, inner) => {
            const summary = (inner.match(/<summary\s*>([\s\S]*?)<\/summary\s*>/i) || [])[1] || '';
            return summary ? '\n[详情: ' + summary.trim() + ']\n' : '\n[详情]\n';
        });
        // Strip <content> and </content> wrappers but keep inner text
        result = result.replace(/<\/?content\s*>/gi, '');
        // Strip stray closing tags
        result = result.replace(/<\/?(?:refine|details|summary)\s*>/gi, '');
        return result;
    }

    function appendStreamReasoning(msgId, text) {
        const el = document.getElementById(msgId);
        if (!el) return;
        const body = el.querySelector('.chat-msg-body');
        if (!body) return;
        const msgList = el.closest('.chat-messages');
        const keepAtBottom = !streamUserScrollLocked && shouldAutoScroll(msgList);
        let details = body.querySelector('.chat-reasoning-streaming');
        if (!details) {
            details = document.createElement('details');
            details.className = 'chat-reasoning chat-reasoning-streaming';
            details.open = true;
            details.innerHTML = '<summary>思考过程（生成中）</summary><div class="chat-reasoning-content"></div>';
            const content = body.querySelector('.chat-msg-content');
            if (content) body.insertBefore(details, content);
            else body.appendChild(details);
        }
        const div = details.querySelector('.chat-reasoning-content');
        if (div) div.textContent += text;
        scrollBottom(msgList, { force: keepAtBottom });
    }

    function finalizeStreamMessage(msgId, fullText, reasoningBlocks, mode, userPrompt) {
        const el = document.getElementById(msgId);
        if (!el) return;

        // Apply regex bindings on complete reply
        let boundReply = typeof window.applyRegexBindings === 'function'
            ? window.applyRegexBindings(fullText) : fullText;

        // renderStructuredReply handles [REASONING] blocks, structured tags, and markdown
        const contentEl = el.querySelector('.chat-msg-content');
        if (contentEl) {
            contentEl.innerHTML = renderStructuredReply(boundReply);
        }

        // Remove streaming cursor and reasoning streaming state
        el.classList.remove('chat-message-streaming');
        const streamingDetails = el.querySelector('.chat-reasoning-streaming');
        if (streamingDetails) {
            const summary = streamingDetails.querySelector('summary');
            if (summary) summary.textContent = '思考过程';
            streamingDetails.classList.remove('chat-reasoning-streaming');
        }

        // Update message object
        const msg = messages.find(m => m.id === msgId);
        if (msg) { msg.content = boundReply; msg.rawContent = boundReply; }

        // Add review buttons (write mode)
        if (mode === 'write' && msg) {
            addReviewButtons(msg, boundReply, userPrompt);
        }
    }

    function finalizePartialMessage(msgId, text, reasoningBlocks) {
        streamingActive = false;  // Allow session save to proceed
        const el = document.getElementById(msgId);
        if (!el) return;

        const contentEl = el.querySelector('.chat-msg-content');
        if (contentEl) {
            flushStreamChunkQueue(msgId);
            let html = escHtml(streamRenderedText || text).replace(/\n/g, '<br>');
            html += '<br><br><em class="chat-stream-interrupted">（已中断，内容不完整）</em>';
            contentEl.innerHTML = html;
        }

        el.classList.remove('chat-message-streaming');
        const streamingDetails = el.querySelector('.chat-reasoning-streaming');
        if (streamingDetails) streamingDetails.classList.remove('chat-reasoning-streaming');

        const msg = messages.find(m => m.id === msgId);
        if (msg) { msg.content = text; msg.rawContent = text; }

        window.saveActiveChatSession?.();
    }

    function handleLegacyReply(rawReply, userPrompt) {
        // Kept only for rendering older saved JSON replies.
        let reply = typeof window.applyRegexBindings === 'function'
            ? window.applyRegexBindings(rawReply) : rawReply;

        if (reply) {
            const msg = addMessage('assistant', reply, currentMode);
            if (currentMode === 'write') addReviewButtons(msg, reply, userPrompt);
            window.onAISuccess?.();
        } else {
            addMessage('assistant', '*(未收到回复)*', currentMode);
        }
    }

    async function removedNonStreamingApiCall(endpoint, userMessage, context, signal) {
        const config = { ...getConfig() };
        const presetName = window.editorState?.presetName || '__default__';

        // Use AI panel settings as-is
        const history = buildModelHistory();
        const data = await ApiClient.post(endpoint, {
                message: userMessage,
                history,
                context,
                config,
                presetName,
                promptTemplates: getEnabledTemplates(),
                promptOrder: window.editorState?.promptOrder || [],
        }, { signal, timeout: 120000 });
        if (data.contextDebug) window.lastContextDebug = data.contextDebug;
        return data.reply;
    }

    // ==================== Messages ====================
    function buildModelHistory() {
        return compactMessagesForModel(messages
            .slice(0, -1)
            .filter(shouldSendMessageToModel)
            .map(m => ({ role: m.role, content: String(m.rawContent || m.content || '').trim() })))
            .slice(-20);
    }

    function shouldSendMessageToModel(message) {
        if (!message || message.transient) return false;
        if (!['user', 'assistant'].includes(message.role)) return false;
        const content = String(message.rawContent || message.content || '').trim();
        if (!content) return false;
        if (message.role === 'assistant' && isAssistantErrorMessage(content)) return false;
        return true;
    }

    function isAssistantErrorMessage(content) {
        return content.startsWith('❌')
            || content.includes('API key required')
            || content.includes('请先配置 API Key')
            || content.includes('Stream error')
            || content.includes('HTTP 4')
            || content.includes('HTTP 5');
    }

    function compactMessagesForModel(source) {
        const cleaned = [];
        for (const msg of source || []) {
            if (!msg || !['user', 'assistant'].includes(msg.role)) continue;
            const content = String(msg.content || '').trim();
            if (!content) continue;
            if (msg.role === 'assistant' && isAssistantErrorMessage(content)) continue;

            const last = cleaned[cleaned.length - 1];
            if (last?.role === msg.role && last.content === content) continue;
            cleaned.push({ role: msg.role, content });
        }
        return cleaned;
    }

    function sanitizeLoadedMessages(saved) {
        const cleaned = [];
        for (const msg of saved || []) {
            if (!msg || !['user', 'assistant'].includes(msg.role)) continue;
            const content = String(msg.rawContent || msg.content || '').trim();
            if (!content) continue;
            if (msg.role === 'assistant' && isAssistantErrorMessage(content)) continue;
            const normalized = {
                ...msg,
                content,
                rawContent: content,
                transient: false,
            };
            const last = cleaned[cleaned.length - 1];
            if (last?.role === normalized.role && String(last.rawContent || last.content || '').trim() === content) continue;
            cleaned.push(normalized);
        }
        return cleaned;
    }

    function addMessage(role, content, mode, options = {}) {
        const msgList = document.getElementById('chat-messages');
        if (!msgList) return null;
        const welcome = msgList.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
        const el = document.createElement('div');
        el.className = `chat-message chat-msg-${role}`;
        el.id = id;
        const name = role === 'user' ? 'You' : 'AI';
        const modeLabel = mode === 'assist' ? '<span class="chat-msg-mode-badge">设定</span>' : '';

        el.innerHTML = `<div class="chat-msg-avatar"></div><div class="chat-msg-body">
            <div class="chat-msg-header"><span class="chat-msg-role">${name}</span>${modeLabel}<span class="chat-msg-time">${now()}</span></div>
            <div class="chat-msg-content">${renderStructuredReply(content)}</div>
            <div class="chat-msg-actions"></div>
        </div>`;
        msgList.appendChild(el);
        scrollBottom(msgList, { force: true });

        // Fade-in animation for new message
        if (window.DomAnimator) {
            window.DomAnimator.fadeIn(el);
        }

        const msg = { id, role, content, rawContent: content, mode, transient: Boolean(options.transient) };
        if (!options.transient) messages.push(msg);
        renderedStart = Math.max(0, messages.length - MESSAGE_PAGE_SIZE);
        while (msgList.querySelectorAll('.chat-message').length > MESSAGE_PAGE_SIZE) {
            msgList.querySelector('.chat-message')?.remove();
        }
        return msg;
    }

    function renderStoredMessage(message) {
        const id = message.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
        const el = document.createElement('div');
        el.className = `chat-message chat-msg-${message.role}`;
        el.id = id;
        const name = message.role === 'user' ? 'You' : 'AI';
        const modeLabel = message.mode === 'assist' ? '<span class="chat-msg-mode-badge">设定</span>' : '';
        el.innerHTML = `<div class="chat-msg-avatar"></div><div class="chat-msg-body">
            <div class="chat-msg-header"><span class="chat-msg-role">${name}</span>${modeLabel}</div>
            <div class="chat-msg-content">${renderStructuredReply(message.rawContent || message.content)}</div>
            <div class="chat-msg-actions"></div>
        </div>`;
        return el;
    }

    function renderRecentMessages() {
        const msgList = document.getElementById('chat-messages');
        if (!msgList) return;
        msgList.replaceChildren();
        renderedStart = Math.max(0, messages.length - MESSAGE_PAGE_SIZE);
        messages.slice(renderedStart).forEach(message => msgList.appendChild(renderStoredMessage(message)));
        scrollBottom(msgList, { force: true });
    }

    function onMessageScroll(event) {
        const msgList = event.currentTarget;
        if (streamingActive) {
            streamUserScrollLocked = !shouldAutoScroll(msgList);
        }
        if (msgList.scrollTop > 1 || renderedStart <= 0) return;

        const oldHeight = msgList.scrollHeight;
        const nextStart = Math.max(0, renderedStart - MESSAGE_PAGE_SIZE);
        const fragment = document.createDocumentFragment();
        messages.slice(nextStart, renderedStart).forEach(message => fragment.appendChild(renderStoredMessage(message)));
        msgList.prepend(fragment);
        renderedStart = nextStart;
        msgList.scrollTop = msgList.scrollHeight - oldHeight;
    }

    function addLoading() {
        const msgList = document.getElementById('chat-messages');
        if (!msgList) return null;
        const id = `loading_${Date.now()}`;
        const el = document.createElement('div');
        el.className = 'chat-message chat-msg-assistant'; el.id = id;
        el.innerHTML = `<div class="chat-msg-avatar"></div><div class="chat-msg-body">
            <div class="chat-msg-header"><span class="chat-msg-role">AI</span></div>
            <div class="chat-msg-content"><div class="chat-thinking">Thinking<span class="chat-thinking-dots"><span></span><span></span><span></span></span></div></div>
        </div>`;
        msgList.appendChild(el); scrollBottom(msgList, { force: true });
        return id;
    }

    function removeMessage(id) {
        if (!id) return;
        const el = document.getElementById(id); if (el) el.remove();
        const idx = messages.findIndex(m => m.id === id);
        if (idx >= 0) messages.splice(idx, 1);
    }

    function clearChat() {
        messages.length = 0;
        renderedStart = 0;
        _sessionAutoNamed = false;
        const msgList = document.getElementById('chat-messages');
        if (!msgList) return;
        msgList.innerHTML = `<div class="chat-welcome">
            <p>在正文模式下，你可以让 AI 帮你续写小说。</p>
            <p>生成后可以选择 <strong>接受</strong>、<strong>重试</strong> 或 <strong>修改</strong>。</p>
        </div>`;
    }

    // ==================== Review Buttons (Write mode) ====================
    function addReviewButtons(msg, text, userPrompt) {
        if (!msg) return;
        const el = document.getElementById(msg.id);
        if (!el) return;
        const actionsEl = el.querySelector('.chat-msg-actions');
        if (!actionsEl) return;

        const bar = document.createElement('div'); bar.className = 'chat-review-bar';

        const acceptBtn = document.createElement('button'); acceptBtn.className = 'chat-review-btn accept';
        acceptBtn.textContent = '接受'; acceptBtn.addEventListener('click', () => { insertToEditor(text); bar.innerHTML = '<span class="chat-review-done">已写入编辑器</span>'; });

        const retryBtn = document.createElement('button'); retryBtn.className = 'chat-review-btn retry';
        retryBtn.textContent = '重试'; retryBtn.addEventListener('click', () => { el.remove(); const i = messages.findIndex(m => m.id === msg.id); if (i >= 0) messages.splice(i, 1); sendMessage(userPrompt); });

        const reviseBtn = document.createElement('button'); reviseBtn.className = 'chat-review-btn revise';
        reviseBtn.textContent = '修改'; reviseBtn.addEventListener('click', () => showReviseInput(msg.id, text, userPrompt));

        bar.appendChild(acceptBtn); bar.appendChild(retryBtn); bar.appendChild(reviseBtn);
        actionsEl.appendChild(bar);
    }

    function showReviseInput(msgId, originalText, userPrompt) {
        const el = document.getElementById(msgId); if (!el) return;
        const actionsEl = el.querySelector('.chat-msg-actions'); if (!actionsEl) return;
        actionsEl.innerHTML = '';
        const bar = document.createElement('div'); bar.className = 'chat-revise-bar';
        const input = document.createElement('input'); input.type = 'text'; input.className = 'chat-revise-input';
        input.placeholder = '输入修改意见...'; input.addEventListener('keydown', e => { if (e.key === 'Enter') doRevise(); });
        const goBtn = document.createElement('button'); goBtn.className = 'chat-review-btn revise'; goBtn.textContent = '🚀'; goBtn.addEventListener('click', doRevise);
        const cancelBtn = document.createElement('button'); cancelBtn.className = 'chat-review-btn retry'; cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => { actionsEl.innerHTML = ''; addReviewButtons({ id: msgId }, originalText, userPrompt); });
        function doRevise() { const inst = input.value.trim(); if (!inst) return; el.remove(); const i = messages.findIndex(m => m.id === msgId); if (i >= 0) messages.splice(i, 1); sendMessage(`${userPrompt}\n\n【修改意见】${inst}`); }
        bar.appendChild(input); bar.appendChild(goBtn); bar.appendChild(cancelBtn);
        actionsEl.appendChild(bar); setTimeout(() => input.focus(), 100);
    }

    function insertToEditor(text) {
        const editor = document.getElementById('chapter-editor'); if (!editor) return;
        // Extract only <content> section if structured, otherwise use full text
        let clean = extractContentOnly(text);
        clean = clean.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '');
        const start = editor.selectionStart, end = editor.selectionEnd;
        const before = editor.value.substring(0, start), after = editor.value.substring(end);
        const spacer = before && !before.endsWith('\n') ? '\n\n' : '';
        editor.value = before + spacer + clean + '\n' + after;
        const newPos = start + spacer.length + clean.length + 1;
        editor.selectionStart = editor.selectionEnd = newPos;
        editor.dispatchEvent(new Event('input', { bubbles: true })); editor.focus();
    }

    function extractContentOnly(rawText) {
        const match = String(rawText || '').match(/<content\s*>([\s\S]*?)<\/content\s*>/i);
        return match ? match[1].trim() : rawText;
    }

    // ==================== Context ====================
    function collectContext() {
        const editor = document.getElementById('chapter-editor');
        const text = editor?.value || '';
        const state = window.editorState || {};
        return {
            currentText: text.slice(-2000), chapterTitle: document.getElementById('chapter-title-input')?.value || '',
            worldBookEntries: getWBSummary(state), characters: getCharSummary(state),
            outline: getOutlineSummary(state), novelTitle: state.currentNovel?.title || '',
            novelId: state.currentNovel?.id || 'default',
            writingReference: state.writingReference || null,
        };
    }

    function getWBSummary(s) {
        const e = s.worldBook?.entries || {};
        const ref = s.writingReference || {};
        const selectedGroups = ref.selectedWorldbookGroups || [];
        if (ref.worldbookMode === 'off') return [];
        return Object.values(e)
            .filter(x => !x.disable && (ref.worldbookMode !== 'selected' || (x.group && selectedGroups.includes(x.group))))
            .slice(0, 10)
            .map(x => ({ name: x.comment || x.key?.[0] || '', content: (x.content||'').substring(0, 200) }));
    }

    function getCharSummary(s) {
        const ref = s.writingReference || {};
        const currentText = document.getElementById('chapter-editor')?.value || '';
        const selected = ref.selectedCharacters || [];
        if (ref.characterMode === 'off') return [];
        return (s.characters||[])
            .filter(c => {
                const name = c.data?.name || c.name || '';
                if (!name) return false;
                if (ref.characterMode === 'selected') return selected.includes(name);
                return currentText.includes(name);
            })
            .slice(0,8)
            .map(c => ({ name: c.data?.name||c.name||'', description: (c.data?.description||c.description||'').substring(0,150) }))
            .filter(c => c.name);
    }

    function getOutlineSummary(s) {
        return (s.outline||[]).slice(0,10).map(n => ({ title: n.title, description: n.description||'', completed: n.completed }));
    }

    function getConfig() { return window.editorState?.aiConfig || {}; }

    function getEnabledTemplates() {
        const s = window.editorState || {};
        if (!s.promptTemplates) return [];
        if (!s.enabledTemplates) return s.promptTemplates;
        return s.promptTemplates.filter(t => s.enabledTemplates[t.identifier] !== false);
    }

    // ==================== Rendering ====================
    function renderMD(text) {
        if (!text) return '';
        return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
            .replace(/```(\w*)\n?([\s\S]*?)```/g,'<pre><code>$2</code></pre>').replace(/`([^`]+)`/g,'<code>$1</code>')
            .replace(/^### (.+)$/gm,'<h4>$1</h4>').replace(/^## (.+)$/gm,'<h3>$1</h3>')
            .replace(/^- (.+)$/gm,'<li>$1</li>').replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');
    }

    // ==================== Structured Reply Rendering ====================

    function renderStructuredReply(rawText) {
        if (!rawText) return '';
        let text = String(rawText);

        // Extract [REASONING] blocks — keep separate from content details
        let reasoningHtml = '';
        text = text.replace(/\[REASONING\]\s*([\s\S]*?)\s*\[\/REASONING\]/g, (_, thinking) => {
            reasoningHtml += '<details><summary>思考过程</summary><div>' + escHtml(String(thinking)) + '</div></details>';
            return '';
        });

        reasoningHtml = reasoningHtml
            .replace(/<details>/g, '<details class="chat-reasoning">')
            .replace(/<summary>[\s\S]*?<\/summary>/g, '<summary>思考过程</summary>');

        // Strip orphaned %%REASONING_N%% markers from older sessions
        text = text.replace(/%%REASONING_\d+%%/g, '');

        // Extract <content>...</content>
        const contentMatch = extractTag(text, 'content');
        // Extract <refine>[...]</refine>
        const refineMatch = extractTag(text, 'refine');
        const sceneMatch = extractTag(text, 'scene');

        // Extract AI content <details>, excluding chat-reasoning ones (already handled)
        const contentDetails = [];
        const summaryDetails = [];
        text = text.replace(/<details(?:\s[^>]*)?>([\s\S]*?)<\/details\s*>/gi, (full) => {
            if (/class="chat-reasoning"/i.test(full)) {
                reasoningHtml += full;
            } else if (isSummaryDetails(full)) {
                summaryDetails.push(full);
            } else {
                contentDetails.push(full);
            }
            return '';
        });

        if (!contentMatch && !contentDetails.length && !summaryDetails.length && !refineMatch && !sceneMatch && !reasoningHtml) {
            return renderMD(String(rawText));
        }

        let remainder = text;
        if (contentMatch) remainder = remainder.replace(contentMatch.full, '');
        if (refineMatch) remainder = remainder.replace(refineMatch.full, '');
        if (sceneMatch) remainder = remainder.replace(sceneMatch.full, '');

        const parts = [];
        if (reasoningHtml.trim()) {
            parts.push('<div class="structured-section-toggle open" onclick="var d=this.nextElementSibling;d.classList.toggle(\'hidden\');this.classList.toggle(\'open\')">思考过程</div>' +
                '<div class="structured-details">' + reasoningHtml + '</div>');
            reasoningHtml = '';
        }

        // 1. Content — just the prose, no wrapper
        if (contentMatch && contentMatch.inner.trim()) {
            parts.push(renderMD(contentMatch.inner.trim()));
        }

        // 2. Reasoning — lightweight collapsible section
        if (reasoningHtml.trim()) {
            parts.push('<div class="structured-section-toggle open" onclick="var d=this.nextElementSibling;d.classList.toggle(\'hidden\');this.classList.toggle(\'open\')">思考过程</div>' +
                '<div class="structured-details">' + reasoningHtml + '</div>');
        }

        // 3. Content details — same lightweight treatment
        if (sceneMatch && sceneMatch.inner.trim()) {
            parts.push('<div class="structured-scene">场景：' + escHtml(sceneMatch.inner.trim()) + '</div>');
        }

        if (summaryDetails.length) {
            parts.push('<div class="structured-section-toggle open" onclick="var d=this.nextElementSibling;d.classList.toggle(\'hidden\');this.classList.toggle(\'open\')">摘要</div>' +
                '<div class="structured-details structured-summary-details">' + summaryDetails.map(openDetailsTag).join('\n') + '</div>');
        }

        if (contentDetails.length) {
            parts.push('<div class="structured-section-toggle" onclick="var d=this.nextElementSibling;d.classList.toggle(\'hidden\');this.classList.toggle(\'open\')">详情</div>' +
                '<div class="structured-details hidden">' + contentDetails.join('\n') + '</div>');
        }

        // 4. Refine cards
        if (refineMatch && refineMatch.inner.trim()) {
            parts.push(renderRefineCards(refineMatch.inner.trim()));
        }

        // 5. Leftover
        const leftover = remainder.trim();
        if (leftover) {
            parts.push(renderMD(leftover));
        }

        return parts.join('\n') || renderMD(String(rawText));
    }

    function isSummaryDetails(detailsHtml) {
        const title = (String(detailsHtml || '').match(/<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary\s*>/i) || [])[1] || '';
        return /摘要|总结|大总结|小总结|summary/i.test(title.replace(/<[^>]*>/g, ''));
    }

    function openDetailsTag(detailsHtml) {
        return String(detailsHtml || '').replace(/^<details(?![^>]*\bopen\b)/i, '<details open');
    }


    function extractTag(text, tagName) {
        const pattern = new RegExp('<' + tagName + '\\s*>([\\s\\S]*?)<\\/' + tagName + '\\s*>', 'i');
        const match = text.match(pattern);
        if (!match) return null;
        return { full: match[0], inner: match[1] };
    }

    function extractAllTags(text, tagName) {
        const results = [];
        const pattern = new RegExp('<' + tagName + '\\s*>([\\s\\S]*?)<\\/' + tagName + '\\s*>', 'gi');
        let match;
        while ((match = pattern.exec(text)) !== null) {
            results.push({ full: match[0], inner: match[1] });
        }
        return results;
    }

    function renderRefineCards(jsonText) {
        let refines = [];
        try {
            refines = JSON.parse(jsonText);
        } catch {
            return '<div class="structured-refine"><div class="refine-error">润色数据解析失败</div></div>';
        }
        if (!Array.isArray(refines) || !refines.length) return '';

        const cards = refines.map((r, i) => {
            const analyze = escHtml(r.analyze || '');
            const original = escHtml(r.original || '');
            const corrected = escHtml(r.corrected || '');
            return '<div class="refine-card" onclick="applyRefineCard(this,\'' +
                original.replace(/'/g, "\\'") + '\',\'' +
                corrected.replace(/'/g, "\\'") + '\')" title="点击应用此条修改">' +
                '<div class="refine-card-header">' +
                '<span class="refine-num">#' + (i + 1) + '</span> ' + analyze +
                '<span class="refine-confirmed-mark">已应用</span>' +
                '</div>' +
                '<div class="refine-compare">' +
                '<div class="refine-original"><span class="refine-label">原文</span><s>' + original + '</s></div>' +
                '<div class="refine-corrected"><span class="refine-label">修改</span><span>' + corrected + '</span></div>' +
                '</div>' +
                '</div>';
        }).join('');

        return '<div class="structured-refine refine-collapsed">' +
            '<div class="structured-section-title" onclick="this.parentElement.classList.toggle(\'refine-collapsed\')">润色建议 <span class="section-count">' + refines.length + ' 条</span></div>' +
            '<div class="refine-cards">' + cards + '</div>' +
            '</div>';
    }


    function now() { const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
    function escHtml(str) { if (!str) return ''; const el = document.createElement('span'); el.textContent = str; return el.innerHTML; }
    function shouldAutoScroll(el) {
        if (!el) return false;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    }

    function scrollBottom(el, options = {}) {
        if (!el) return;
        const force = options.force === true;
        if (!force && !shouldAutoScroll(el)) return;
        el.scrollTop = el.scrollHeight;
    }

    function updateButtons() {
        const send = document.getElementById('btn-send');
        const stop = document.getElementById('btn-stop');
        if (send) send.style.display = isLoading ? 'none' : '';
        if (stop) stop.style.display = isLoading ? '' : 'none';
    }

    // ==================== Context Management (CC-style) ====================
    const CONTEXT_WARN = 60, CONTEXT_HIGH = 80, CONTEXT_CRITICAL = 92;
    const PROTECT_RECENT = 5;  // Keep last N messages during compaction

    function estimateContextUsage() {
        let totalChars = 0;
        messages.forEach(m => { totalChars += (m.rawContent || m.content || '').length; });
        const estimatedTokens = Math.round(totalChars / 2.5);
        const config = { ...getConfig(), stream: false };
        const model = String(config.model || '').toLowerCase();
        const modelLimit = Number(config.maxContext || 0)
            || (model.includes('deepseek') || model.includes('gemini') || model.includes('qwen') || model.includes('minimax')
                ? 1000000
                : model.includes('claude') ? 200000 : 128000);
        const pct = Math.min(Math.round(estimatedTokens / modelLimit * 100), 99);
        updateContextCircle(pct);

        // Auto-warn at 80%
        if (pct >= CONTEXT_HIGH && !isLoading && messages.length > PROTECT_RECENT + 3) {
            const ctxBar = document.querySelector('.cc-context-bar');
            if (ctxBar) ctxBar.style.display = '';
        }
        return pct;
    }

    function updateContextCircle(pct) {
        const arc = document.getElementById('ctx-arc');
        if (!arc) return;
        const circ = 2 * Math.PI * 7;
        const offset = circ * (1 - Math.min(pct, 100) / 100);
        arc.setAttribute('stroke-dasharray', circ);
        arc.setAttribute('stroke-dashoffset', offset);
        if (pct >= CONTEXT_CRITICAL) arc.setAttribute('stroke', 'var(--error)');
        else if (pct >= CONTEXT_WARN) arc.setAttribute('stroke', 'var(--warning)');
        else arc.setAttribute('stroke', 'var(--success)');

        // Update text: message count
        const userMsgs = messages.filter(m => m.role === 'user').length;
        const ctxText = document.getElementById('ctx-text');
        if (ctxText) ctxText.textContent = `${userMsgs}`;

        const ctxCircle = document.getElementById('ctx-circle');
        if (ctxCircle) ctxCircle.title = `消息: ${messages.length}条 | 用量: ${pct}% | 点击压缩`;
    }

    async function compressContext() {
        if (messages.length <= PROTECT_RECENT + 2) { alert('消息太少，无需压缩'); return; }
        if (isLoading) return;

        const oldMessages = messages.slice(0, -PROTECT_RECENT);
        if (!oldMessages.length) return;

        // Build structured summary prompt (CC-style)
        const conversationText = oldMessages.map(m =>
            `[${m.role === 'user' ? '用户' : 'AI'}${m.mode ? ' · ' + m.mode : ''}]: ${(m.rawContent || m.content || '').substring(0, 300)}`
        ).join('\n');

        const config = getConfig();
        const presetName = window.editorState?.presetName || '__default__';

        isLoading = true; updateButtons();
        try {
            const resp = await fetch('/api/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: `请将以下对话历史压缩为结构化摘要（300字内），保留：\n1. 关键情节决策\n2. 角色设定变更\n3. 世界观讨论结论\n4. 未完成的创作任务\n\n对话历史：\n${conversationText}`,
                    history: [], context: {}, config: { ...config, temperature: 0.3, maxTokens: 600 }, presetName,
                }),
            });
            const data = await resp.json();
            const summary = data.reply || '(压缩失败)';

            // Keep recent messages, insert summary boundary (CC-style compact_boundary)
            const kept = messages.slice(-PROTECT_RECENT);
            messages.length = 0;
            messages.push({
                id: `compact_${Date.now()}`, role: 'assistant',
                content: `📋 *上下文已压缩，前文摘要：*\n${summary}`,
                rawContent: summary, mode: 'system',
            });
            messages.push(...kept);

            // Rerender
            const msgList = document.getElementById('chat-messages');
            if (msgList) {
                msgList.querySelectorAll('.chat-message').forEach(el => el.remove());
                msgList.querySelectorAll('.chat-welcome').forEach(el => el.remove());
                messages.forEach(m => addMessage(m.role, m.rawContent || m.content, m.mode));
            }
            estimateContextUsage();
        } catch (e) { /* silent */ }
        finally { isLoading = false; updateButtons(); }
    }

    // Update context after each message
    const origAddMessage = addMessage;
    addMessage = function(...args) {
        const result = origAddMessage.apply(this, args);
        setTimeout(() => { const pct = estimateContextUsage(); if (pct >= CONTEXT_HIGH) updateContextCircle(pct); }, 100);
        return result;
    };

    // ==================== Session Management (CC-style) ====================
    let _allSessions = [];

    function renderSessionList(sessions, activeId) {
        _allSessions = sessions || [];
        activeSessionId = activeId || 'default';
        _renderFiltered(_allSessions);
    }

    function _renderFiltered(sessions) {
        const list = document.getElementById('session-list');
        if (!list) return;
        if (!sessions.length) {
            list.innerHTML = '<div class="chat-history-empty">暂无历史会话</div>';
            return;
        }
        list.innerHTML = sessions.map(s => {
            const isActive = s.id === activeSessionId;
            const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleDateString('zh-CN', { month:'short', day:'numeric' }) : '';
            const countStr = s.messageCount ? `${s.messageCount}条` : '';
            return `<div class="chat-history-item${isActive ? ' active' : ''}" data-session-id="${s.id}">
                <span class="sess-name">${escHtml(s.name || '未命名')}</span>
                <span class="sess-meta">${countStr} ${dateStr}</span>
                <button class="sess-delete" title="删除会话">✕</button>
            </div>`;
        }).join('');
    }

    function filterSessions(query) {
        const q = (query || '').toLowerCase().trim();
        if (!q) { _renderFiltered(_allSessions); return; }
        const filtered = _allSessions.filter(s => (s.name || '').toLowerCase().includes(q));
        _renderFiltered(filtered);
    }

    function setActiveSession(id) {
        activeSessionId = id;
        _sessionAutoNamed = false;
        document.querySelectorAll('#session-list .chat-history-item').forEach(el => {
            el.classList.toggle('active', el.dataset.sessionId === id);
        });
    }

    function registerSessionCallbacks({ onSwitch, onDelete, onNew }) {
        onSwitchSessionCb = onSwitch;
        onDeleteSessionCb = onDelete;
        onNewSessionCb = onNew;
    }

    return {
        init, sendMessage, clearChat, getActiveMode: () => currentMode, insertToEditor,
        getMessages: () => messages,
        loadMessages: (saved) => {
            if (Array.isArray(saved)) {
                messages.length = 0;
                messages.push(...sanitizeLoadedMessages(saved));
                renderRecentMessages();
            }
        },
        renderSessionList, setActiveSession, registerSessionCallbacks,
        cancelActiveRequest: stopGeneration,
        isStreamingActive: () => streamingActive,
    };
})();
window.ChatPanel = ChatPanel;
