/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function togglePanelSearch(selector, buttonSelector, forceOpen) {
    const input = $(selector);
    if (!input) return;
    const search = input.closest('.panel-search');
    const button = $(buttonSelector);
    if (!search) return;
    const shouldOpen = forceOpen ?? search.hidden;
    search.hidden = !shouldOpen;
    button?.classList.toggle('active', shouldOpen);
    button?.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) {
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    } else {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function bindPanelSearch(selector, buttonSelector) {
    const input = $(selector);
    const search = input?.closest('.panel-search');
    if (!input || !search) return;
    $(buttonSelector)?.addEventListener('click', () => {
        togglePanelSearch(selector, buttonSelector);
    });
    search.querySelector('.panel-search-clear')?.addEventListener('click', () => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    });
    search.querySelector('.panel-search-close')?.addEventListener('click', () => {
        togglePanelSearch(selector, buttonSelector, false);
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') togglePanelSearch(selector, buttonSelector, false);
    });
}

function filterRenderedList(listSelector, itemSelector, query) {
    const normalized = query.trim().toLowerCase();
    document.querySelectorAll(`${listSelector} ${itemSelector}`).forEach(item => {
        item.style.display = !normalized || item.textContent.toLowerCase().includes(normalized) ? '' : 'none';
    });
}
