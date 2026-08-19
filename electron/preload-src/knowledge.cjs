'use strict';

const REFERENCE_IPC_CHANNELS = Object.freeze({
    listWorldBooks: 'cgj:v1:references:list-worldbooks',
    getWorldBook: 'cgj:v1:references:get-worldbook',
    saveWorldBook: 'cgj:v1:references:save-worldbook',
    updateWorldBookEntry: 'cgj:v1:references:update-worldbook-entry',
    listCharacters: 'cgj:v1:references:list-characters',
    saveCharacter: 'cgj:v1:references:save-character',
});

function createKnowledgeFacade(invoke) {
    const worldbooks = Object.freeze({
        list: projectId => invoke(REFERENCE_IPC_CHANNELS.listWorldBooks, { projectId }),
        get: (projectId, name) => invoke(REFERENCE_IPC_CHANNELS.getWorldBook, {
            projectId, name,
        }),
        save: (projectId, name, data) => invoke(REFERENCE_IPC_CHANNELS.saveWorldBook, {
            projectId, name, data,
        }),
        updateEntry: (projectId, bookName, uid, entry) => invoke(
            REFERENCE_IPC_CHANNELS.updateWorldBookEntry,
            { projectId, bookName, uid, entry },
        ),
    });
    const characters = Object.freeze({
        list: projectId => invoke(REFERENCE_IPC_CHANNELS.listCharacters, { projectId }),
        save: (projectId, data) => invoke(REFERENCE_IPC_CHANNELS.saveCharacter, {
            projectId, data,
        }),
    });
    const references = Object.freeze({
        listWorldBooks: worldbooks.list,
        getWorldBook: worldbooks.get,
        saveWorldBook: worldbooks.save,
        updateWorldBookEntry: worldbooks.updateEntry,
        listCharacters: characters.list,
        saveCharacter: characters.save,
    });
    return Object.freeze({ worldbooks, characters, references });
}
