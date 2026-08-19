/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function wrapEditorSelection(before, after) {
    const editor = $('#chapter-editor');
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    editor.setRangeText(`${before}${selected}${after}`, start, end, 'select');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
}

function formatChapterText() {
    const editor = $('#chapter-editor');
    if (!editor || editor.disabled) return;
    const original = editor.value || '';
    if (!original.trim()) {
        setStatus('正文为空，暂无可排版内容', 'warn');
        editor.focus();
        return;
    }

    const formatted = formatNovelText(original);
    if (formatted === original) {
        setStatus('正文格式已经很整齐了', 'info');
        editor.focus();
        return;
    }

    editor.value = formatted;
    editor.selectionStart = editor.selectionEnd = formatted.length;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
    setStatus('已完成正文排版', 'success');
}

function formatNovelText(text = '') {
    const normalized = String(text)
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    let inCodeBlock = false;
    const lines = normalized.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (/^```/.test(trimmed)) {
            inCodeBlock = !inCodeBlock;
            return trimmed;
        }
        if (inCodeBlock || shouldKeepLineUnindented(trimmed)) return trimmed;
        return '\u3000\u3000' + trimmed.replace(/^[\s\u3000]+/, '');
    });

    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function shouldKeepLineUnindented(line = '') {
    return /^#{1,6}\s/.test(line)
        || /^[-*+]\s/.test(line)
        || /^\d+[.)、]\s?/.test(line)
        || /^>/.test(line)
        || /^<\/?[a-zA-Z][^>]*>$/.test(line)
        || /^<[^>]+>/.test(line);
}
