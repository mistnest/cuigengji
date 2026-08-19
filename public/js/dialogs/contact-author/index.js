/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function initContactAuthorDialog() {
    const overlay = $('#contact-author-overlay');
    if (!overlay) return;
    const close = () => closeContactAuthor();
    $('#btn-contact-author')?.addEventListener('click', openContactAuthor);
    $('#btn-contact-author-close')?.addEventListener('click', close);
    $('#btn-contact-author-done')?.addEventListener('click', close);
    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && overlay.classList.contains('active')) close();
    });
}

function openContactAuthor() {
    const overlay = $('#contact-author-overlay');
    if (!overlay) return;
    overlay.style.display = '';
    requestAnimationFrame(() => overlay.classList.add('active'));
}

function closeContactAuthor() {
    const overlay = $('#contact-author-overlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    setTimeout(() => {
        if (!overlay.classList.contains('active')) overlay.style.display = 'none';
    }, 180);
}
