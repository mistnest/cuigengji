'use strict';

const APP_IPC_CHANNELS = Object.freeze({
    bootstrap: 'cgj:v1:app:bootstrap',
    getVersion: 'cgj:v1:app:get-version',
    openExternal: 'cgj:v1:app:open-external',
    menuCommand: 'cgj:v1:app:menu-command',
});

function createAppFacade({ invoke, ipcRenderer }) {
    function onMenuCommand(listener) {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        const handler = (_event, command) => {
            if (command === 'save') listener(command);
        };
        ipcRenderer.on(APP_IPC_CHANNELS.menuCommand, handler);
        return () => ipcRenderer.removeListener(APP_IPC_CHANNELS.menuCommand, handler);
    }

    return Object.freeze({
        bootstrap: () => invoke(APP_IPC_CHANNELS.bootstrap),
        getVersion: () => invoke(APP_IPC_CHANNELS.getVersion),
        openExternal: url => invoke(APP_IPC_CHANNELS.openExternal, { url }),
        onMenuCommand,
    });
}
