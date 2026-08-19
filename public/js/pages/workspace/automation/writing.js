/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
async function showLastPrompt() {
    try {
        const data = await AutomationRuntime.execute('debug.lastPrompt');
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay active';
        const modal = document.createElement('div');
        modal.className = 'plot-modal';
        modal.style.cssText = 'max-width:860px;max-height:90vh;display:flex;flex-direction:column;';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'plot-modal-close';
        close.textContent = '\u00d7';
        close.addEventListener('click', () => overlay.remove());
        const body = document.createElement('div');
        body.style.cssText = 'flex:1;overflow-y:auto;padding:20px;font-size:13px;line-height:1.7;';
        if (data.empty) {
            body.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:60px 0;">\u8fd8\u6ca1\u6709\u53d1\u9001\u8fc7 AI \u8bf7\u6c42</p>';
        } else {
            const parts = [];
            // Header
            const sysLen = (data.systemPrompt || '').length;
            const usrLen = (data.userPrompt || '').length;
            parts.push('<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid var(--accent-primary);">');
            parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">Provider: <b>' + escHtml(data.provider || '-') + '</b></span>');
            parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">Model: <b>' + escHtml(data.model || '-') + '</b></span>');
            parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">Temp: <b>' + (data.temperature ?? '-') + '</b></span>');
            parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">MaxTokens: <b>' + (data.maxTokens ?? '-') + '</b></span>');
            parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;margin-left:auto;">Sys: <b>' + Math.round(sysLen / 2.5) + ' tok</b></span>');
            parts.push('<span style="background:var(--bg-tertiary);padding:3px 10px;border-radius:4px;font-size:12px;">User: <b>' + Math.round(usrLen / 2.5) + ' tok</b></span>');
            parts.push('</div>');

            // Section 1: System Prompt (what goes to AI first)
            parts.push('<div style="margin-bottom:18px;">');
            parts.push('<h4 style="margin:0 0 8px;padding:4px 8px;background:var(--accent-glow);color:var(--accent-primary);border-radius:4px;font-size:13px;display:inline-block;">\u25b6 1. System Prompt \u53d1\u7ed9AI</h4>');
            const sysText = debugFormat(data.systemPrompt, 15000);
            const sysPre = document.createElement('pre');
            sysPre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:14px;max-height:400px;overflow:auto;font-size:12px;color:var(--text-primary);font-family:var(--font-mono);line-height:1.6;';
            sysPre.textContent = sysText || '(\u65e0)';
            const sysWrapper = document.createElement('div');
            sysWrapper.appendChild(sysPre);
            parts.push(sysWrapper.outerHTML);
            parts.push('</div>');

            // Separator
            parts.push('<div style="text-align:center;margin:12px 0;color:var(--text-muted);font-size:11px;">\u2500\u2500 \u4ee5\u4e0a\u4e3a System Prompt \u00b7 \u4ee5\u4e0b\u4e3a User Message \u2500\u2500</div>');

            // Section 2: User Prompt
            parts.push('<div style="margin-bottom:18px;">');
            parts.push('<h4 style="margin:0 0 8px;padding:4px 8px;background:rgba(91,60,196,0.1);color:#8b7cf0;border-radius:4px;font-size:13px;display:inline-block;">\u25b6 2. User Message \u53d1\u7ed9AI</h4>');
            const usrText = debugFormat(data.userPrompt, 15000);
            const usrPre = document.createElement('pre');
            usrPre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:14px;max-height:400px;overflow:auto;font-size:12px;color:var(--text-primary);font-family:var(--font-mono);line-height:1.6;';
            usrPre.textContent = usrText || '(\u65e0)';
            const usrWrapper = document.createElement('div');
            usrWrapper.appendChild(usrPre);
            parts.push(usrWrapper.outerHTML);
            parts.push('</div>');

            // Section 3: Memory Stats (collapsible)
            if (data.memoryStats) {
                parts.push('<details style="margin-top:4px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:12px;">Memory Stats</summary>');
                parts.push('<pre style="white-space:pre-wrap;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:10px;font-size:11px;margin-top:6px;">' + escHtml(JSON.stringify(data.memoryStats, null, 2)) + '</pre>');
                parts.push('</details>');
            }
            body.innerHTML = parts.join('\n');
        }
        modal.append(close, body);
        overlay.appendChild(modal);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    } catch (err) {
        setStatus('\u8c03\u8bd5\u4fe1\u606f\u52a0\u8f7d\u5931\u8d25: ' + err.message, 'error');
    }
}

async function onInfill() {
    const editor = $('#chapter-editor');
    if (!editor) return;
    if (!hasConfiguredAiCredentials()) {
        setStatus('请先配置 API Key', 'error');
        return;
    }
    if (state.isGenerating) return;
    const instruction = prompt('\u8bf7\u63cf\u8ff0\u4e2d\u95f4\u9700\u8981\u8865\u5199\u7684\u5185\u5bb9');
    if (!instruction?.trim()) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const button = $('#btn-infill');
    state.isGenerating = true;
    if (button) button.disabled = true;
    try {
        setStatus('AI \u6b63\u5728\u8865\u5199...', 'loading');
        const data = await AutomationRuntime.execute('writing.infill', {
                beforeText: editor.value.slice(0, start),
                afterText: editor.value.slice(end),
                instruction: instruction.trim(),
                config: { ...state.aiConfig, stream: false },
                context: {
                    novelId: state.currentNovel?.id,
                    novelTitle: state.currentNovel?.title,
                    chapterTitle: $('#chapter-title-input')?.value || '',
                    writingReference: state.writingReference,
                },
                presetName: state.presetName || '__default__',
        });
        editor.setRangeText(data.reply || '', start, end, 'end');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        setStatus('\u8865\u5199\u5b8c\u6210', 'success');
    } catch (err) {
        setStatus(`\u8865\u5199\u5931\u8d25: ${err.message}`, 'error');
    } finally {
        state.isGenerating = false;
        if (button) button.disabled = false;
    }
}
