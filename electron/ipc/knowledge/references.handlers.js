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
            async input => withoutPath(await saveWorldBook(
                input?.projectId,
                input?.name,
                input?.data,
                {
                    expectedRevision: input?.expectedRevision,
                    expectedContentHash: input?.expectedContentHash,
                    actor: humanActor(input?.clientId),
                },
            )),
            'references.saveWorldBook', KNOWLEDGE_INPUT_SCHEMAS.saveWorldBook)],
        [REFERENCE_IPC_CHANNELS.updateWorldBookEntry, createGuardedHandler(getMainWindow,
            input => updateWorldBookEntry(
                input?.projectId,
                input?.bookName,
                input?.uid,
                input?.entry,
                {
                    expectedRevision: input?.expectedRevision,
                    expectedContentHash: input?.expectedContentHash,
                    actor: humanActor(input?.clientId),
                },
            ), 'references.updateWorldBookEntry', KNOWLEDGE_INPUT_SCHEMAS.updateWorldBookEntry)],
        [REFERENCE_IPC_CHANNELS.listCharacters, createGuardedHandler(getMainWindow,
            async input => (await listCharacters(input?.projectId)).map(withoutPath),
            'references.listCharacters', KNOWLEDGE_INPUT_SCHEMAS.listCharacters)],
        [REFERENCE_IPC_CHANNELS.saveCharacter, createGuardedHandler(getMainWindow,
            async input => withoutPath(await saveCharacter(
                input?.projectId,
                input?.data,
                {
                    expectedRevision: input?.expectedRevision,
                    expectedContentHash: input?.expectedContentHash,
                    actor: humanActor(input?.clientId),
                },
            )),
            'references.saveCharacter', KNOWLEDGE_INPUT_SCHEMAS.saveCharacter)],
    ]);
    return registerHandlers(ipcMain, handlers);
}

function humanActor(clientId) {
    const id = typeof clientId === 'string' ? clientId.replace(/[\0\r\n]/gu, '').slice(0, 160) : '';
    return { kind: 'human', id: id || 'renderer' };
}
