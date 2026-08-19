(function () {
    'use strict';

    const repositories = window.CuigengjiModules?.repositories;
    if (!repositories?.settings) throw new Error('Settings repository is required');

    let values = {};
    let pendingWrite = Promise.resolve();

    const preferences = Object.freeze({
        async load() {
            values = await repositories.settings.getPreferences();
            return values;
        },
        get(key, fallback) {
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
        },
        set(key, value) {
            values = { ...values, [key]: value };
            pendingWrite = pendingWrite
                .catch(() => {})
                .then(() => repositories.settings.updatePreferences({ [key]: value }));
            return pendingWrite;
        },
        remove(key) {
            const next = { ...values };
            delete next[key];
            values = next;
            pendingWrite = pendingWrite
                .catch(() => {})
                .then(() => repositories.settings.updatePreferences({ [key]: null }));
            return pendingWrite;
        },
    });

    window.CuigengjiPreferences = preferences;
}());
