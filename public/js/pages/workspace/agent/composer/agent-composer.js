(function (root) {
    'use strict';

    function mountAgentComposer({ store, form, textarea, sendButton, cancelButton, modeButton, onSend, onCancel }) {
        let composing = false;
        const onCompositionStart = () => { composing = true; };
        const onCompositionEnd = () => { composing = false; };
        const resize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
            store.setComposer({ text: textarea.value });
        };
        const submit = event => {
            event.preventDefault();
            if (!composing) void onSend(textarea.value);
        };
        const keydown = event => {
            if (event.key !== 'Enter' || event.shiftKey || composing || event.isComposing) return;
            event.preventDefault();
            form.requestSubmit();
        };
        const toggleMode = () => {
            const mode = store.getState().composer.mode === 'queue' ? 'steer' : 'queue';
            store.setComposer({ mode });
        };
        form.addEventListener('submit', submit);
        textarea.addEventListener('input', resize);
        textarea.addEventListener('keydown', keydown);
        textarea.addEventListener('compositionstart', onCompositionStart);
        textarea.addEventListener('compositionend', onCompositionEnd);
        cancelButton.addEventListener('click', onCancel);
        modeButton.addEventListener('click', toggleMode);
        const unsubscribe = store.subscribe(state => {
            if (textarea.value !== state.composer.text) {
                textarea.value = state.composer.text;
                textarea.style.height = 'auto';
            }
            const contextReady = state.project.contextState !== 'stale'
                && state.project.contextState !== 'syncing'
                && state.project.contextState !== 'error';
            const available = state.runtime.ready && state.runtime.hasCredential
                && state.activeSessionId && contextReady;
            sendButton.disabled = !available || !textarea.value.trim() || state.composer.submitting;
            cancelButton.hidden = !state.running;
            modeButton.hidden = !state.running;
            modeButton.textContent = state.composer.mode === 'steer' ? '调整当前回复' : '加入队列';
            modeButton.setAttribute('aria-pressed', String(state.composer.mode === 'steer'));
            textarea.disabled = !available;
            textarea.placeholder = !state.runtime.hasCredential
                ? '请先在 AI 设置中保存 DeepSeek API Key'
                : !contextReady
                    ? '项目正在同步，请等待同步完成'
                : state.running
                    ? '可加入队列，或选择调整当前回复…'
                    : '和 Agent 讨论情节、人物或续写方向…';
        });
        return () => {
            unsubscribe();
            form.removeEventListener('submit', submit);
            textarea.removeEventListener('input', resize);
            textarea.removeEventListener('keydown', keydown);
            textarea.removeEventListener('compositionstart', onCompositionStart);
            textarea.removeEventListener('compositionend', onCompositionEnd);
            cancelButton.removeEventListener('click', onCancel);
            modeButton.removeEventListener('click', toggleMode);
        };
    }
    root.AgentComposerModule = Object.freeze({ mountAgentComposer });
}(window));
