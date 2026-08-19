import {
    getWorldBook,
    listCharacters,
    listWorldBooks,
    saveCharacter,
    saveWorldBook,
    updateWorldBookEntry,
} from '../../../src/backend/domains/knowledge/index.js';
import {
    KNOWLEDGE_INPUT_SCHEMAS,
    REFERENCE_IPC_CHANNELS,
} from '../../../shared/desktop-api/knowledge/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

function withoutPath(value) {
    if (!value || typeof value !== 'object') return value;
    const safe = { ...value };
    delete safe.path;
    return safe;
}

export function registerReferenceIpcHandlers({ ipcMain, getMainWindow }) {
    const handlers = new Map([
        [REFERENCE_IPC_CHANNELS.listWorldBooks, createGuardedHandler(getMainWindow,
            async input => (await listWorldBooks(input?.projectId)).map(withoutPath),
            'references.listWorldBooks', KNOWLEDGE_INPUT_SCHEMAS.listWorldBooks)],
        [REFERENCE_IPC_CHANNELS.getWorldBook, createGuardedHandler(getMainWindow,
            input => getWorldBook(input?.projectId, input?.name), 'references.getWorldBook',
            KNOWLEDGE_INPUT_SCHEMAS.getWorldBook)],
        [REFERENCE_IPC_CHANNELS.saveWorldBook, createGuardedHandler(getMainWindow,
            async input => withoutPath(await saveWorldBook(input?.projectId, input?.name, input?.data)),
            'references.saveWorldBook', KNOWLEDGE_INPUT_SCHEMAS.saveWorldBook)],
        [REFERENCE_IPC_CHANNELS.updateWorldBookEntry, createGuardedHandler(getMainWindow,
            input => updateWorldBookEntry(
                input?.projectId,
                input?.bookName,
                input?.uid,
                input?.entry,
            ), 'references.updateWorldBookEntry', KNOWLEDGE_INPUT_SCHEMAS.updateWorldBookEntry)],
        [REFERENCE_IPC_CHANNELS.listCharacters, createGuardedHandler(getMainWindow,
            async input => (await listCharacters(input?.projectId)).map(withoutPath),
            'references.listCharacters', KNOWLEDGE_INPUT_SCHEMAS.listCharacters)],
        [REFERENCE_IPC_CHANNELS.saveCharacter, createGuardedHandler(getMainWindow,
            async input => withoutPath(await saveCharacter(input?.projectId, input?.data)),
            'references.saveCharacter', KNOWLEDGE_INPUT_SCHEMAS.saveCharacter)],
    ]);
    return registerHandlers(ipcMain, handlers);
}
