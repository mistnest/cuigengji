(function () {
    'use strict';

    const desktopApi = window.cuigengji;
    if (!desktopApi?.app) return;

    window.DesktopApi = desktopApi;
    desktopApi.app.onMenuCommand(command => {
        window.dispatchEvent(new CustomEvent('cuigengji:menu-command', {
            detail: { command },
        }));

        // Temporary adapter for the legacy renderer. New feature modules should
        // subscribe to the semantic event instead of querying DOM elements.
        if (command === 'save') document.querySelector('#btn-save')?.click();
    });
}());
