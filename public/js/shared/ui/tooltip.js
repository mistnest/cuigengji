/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function bindGlobalTooltip() {
    document.addEventListener('mouseenter', (e) => {
        const el = e.target instanceof Element ? e.target : null;
        const icon = el?.closest('.info-tooltip-icon');
        if (!icon) return;
        const textEl = icon.parentElement?.querySelector('.info-tooltip-text');
        if (!textEl) return;
        const tip = document.getElementById('global-tooltip');
        if (!tip) return;
        tip.innerHTML = textEl.innerHTML;
        tip.style.display = '';
        const rect = icon.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - 170;
        if (left < 8) left = 8;
        if (left + 340 > window.innerWidth - 8) left = window.innerWidth - 348;
        tip.style.left = left + 'px';
        tip.style.top = (rect.bottom + 8) + 'px';
        requestAnimationFrame(() => tip.classList.add('show'));
    }, true);
    document.addEventListener('mouseleave', (e) => {
        const el = e.target instanceof Element ? e.target : null;
        if (!el?.closest('.info-tooltip-icon')) return;
        const tip = document.getElementById('global-tooltip');
        if (tip) { tip.classList.remove('show'); tip.style.display = 'none'; }
    }, true);
}

// ==================== Prompt Editor ====================
let _promptEditorCurrentId = null;
