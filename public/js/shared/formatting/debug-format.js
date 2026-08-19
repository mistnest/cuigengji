/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function debugFormat(text, maxLen) {
    const s = String(text || '');
    const truncated = maxLen && s.length > maxLen ? s.substring(0, maxLen) + '\n\u2026[\u622a\u65ad]' : s;
    return truncated;
}
