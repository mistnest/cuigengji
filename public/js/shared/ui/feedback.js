/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function safeConfirm(msg) {
    if (document.activeElement) document.activeElement.blur();
    return confirm(msg);
}

function refocusChat() {
    setTimeout(() => {
        const input = document.getElementById('chat-input');
        if (input && document.activeElement !== input) input.focus();
    }, 50);
}

// ==================== Keyboard ====================
function onKeyboard(e) {
    if ((e.ctrlKey || e.metaKey)) {
        switch (e.key.toLowerCase()) {
            case 's': e.preventDefault(); onSave(); break;
            case 'n': e.preventDefault(); onNewNovel(); break;
        }
    }
}

// ==================== Status ====================
function showToast(msg, type = 'info', duration = 6000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast-item toast-' + type;
    el.textContent = msg;
    container.appendChild(el);
    if (duration > 0) {
        setTimeout(() => { if (el.parentNode) el.remove(); }, duration + 600);
    }
}
