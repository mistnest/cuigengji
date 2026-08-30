'use strict';

const IMPORT_IPC_CHANNELS = Object.freeze({
    selectDocument: 'cgj:v1:imports:select-document',
    selectFolder: 'cgj:v1:imports:select-folder',
    selectWorldBook: 'cgj:v1:imports:select-worldbook',
    selectCharacters: 'cgj:v1:imports:select-characters',
    selectPreset: 'cgj:v1:imports:select-preset',
});
const EXPORT_IPC_CHANNELS = Object.freeze({
    saveText: 'cgj:v1:exports:save-text', saveJson: 'cgj:v1:exports:save-json',
});

function createExchangeFacade(input) {
    const invoke = typeof input === 'function' ? input : input.invoke;
    const actorId = typeof input === 'object' ? input.actorId : '';
    const writePayload = value => ({ ...value, ...(actorId ? { clientId: actorId } : {}) });
    const imports = Object.freeze({
        selectDocument: options => invoke(
            IMPORT_IPC_CHANNELS.selectDocument,
            writePayload(options || {}),
        ),
        selectFolder: projectId => invoke(
            IMPORT_IPC_CHANNELS.selectFolder,
            writePayload({ projectId }),
        ),
        selectWorldBook: projectId => invoke(
            IMPORT_IPC_CHANNELS.selectWorldBook,
            writePayload({ projectId }),
        ),
        selectCharacters: projectId => invoke(
            IMPORT_IPC_CHANNELS.selectCharacters,
            writePayload({ projectId }),
        ),
        selectPreset: projectId => invoke(
            IMPORT_IPC_CHANNELS.selectPreset,
            writePayload({ projectId }),
        ),
    });
    const exports = Object.freeze({
        saveText: (suggestedName, content) => invoke(EXPORT_IPC_CHANNELS.saveText, {
            suggestedName, content,
        }),
        saveJson: (suggestedName, data) => invoke(EXPORT_IPC_CHANNELS.saveJson, {
            suggestedName, data,
        }),
    });
    return Object.freeze({ imports, exports });
}
