/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function setPreference(key, value) {
    Preferences.set(key, value).catch(error => {
        console.warn(`[Preferences] Failed to save ${key}:`, error.message);
    });
}

function removePreference(key) {
    Preferences.remove(key).catch(error => {
        console.warn(`[Preferences] Failed to remove ${key}:`, error.message);
    });
}
