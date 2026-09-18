import {
    getWorldBook,
    listCharacters,
    listWorldBooks,
    saveCharacter,
    saveWorldBook,
    updateWorldBookEntry,
} from '../../../src/backend/domains/knowledge/index.js';
import {
    commitGraph,
    getGraphEdge,
    getGraphNode,
    listGraphEdges,
    searchGraphNodes,
    syncCharacterNode,
    syncWorldBookNode,
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
            async input => {
                const saved = await saveWorldBook(input?.projectId, input?.name, input?.data, {
                    expectedRevision: input?.expectedRevision,
                    expectedContentHash: input?.expectedContentHash,
                    actor: humanActor(input?.clientId),
                });
                const canonical = await getWorldBook(input?.projectId, input?.name);
                await syncWorldBookNode(input?.projectId, input?.name, canonical, saved.revision);
                return withoutPath(saved);
            },
            'references.saveWorldBook', KNOWLEDGE_INPUT_SCHEMAS.saveWorldBook)],
        [REFERENCE_IPC_CHANNELS.updateWorldBookEntry, createGuardedHandler(getMainWindow,
            async input => {
                const result = await updateWorldBookEntry(input?.projectId, input?.bookName, input?.uid, input?.entry, {
                    expectedRevision: input?.expectedRevision,
                    expectedContentHash: input?.expectedContentHash,
                    actor: humanActor(input?.clientId),
                });
                const book = await getWorldBook(input?.projectId, input?.bookName);
                await syncWorldBookNode(input?.projectId, input?.bookName, book, result.revision);
                return result;
            }, 'references.updateWorldBookEntry', KNOWLEDGE_INPUT_SCHEMAS.updateWorldBookEntry)],
        [REFERENCE_IPC_CHANNELS.listCharacters, createGuardedHandler(getMainWindow,
            async input => (await listCharacters(input?.projectId)).map(withoutPath),
            'references.listCharacters', KNOWLEDGE_INPUT_SCHEMAS.listCharacters)],
        [REFERENCE_IPC_CHANNELS.saveCharacter, createGuardedHandler(getMainWindow,
            async input => {
                const saved = await saveCharacter(input?.projectId, input?.data, {
                    expectedRevision: input?.expectedRevision,
                    expectedContentHash: input?.expectedContentHash,
                    actor: humanActor(input?.clientId),
                });
                await syncCharacterNode(input?.projectId, saved.name, saved.character, saved.revision);
                return withoutPath(saved);
            },
            'references.saveCharacter', KNOWLEDGE_INPUT_SCHEMAS.saveCharacter)],
        [REFERENCE_IPC_CHANNELS.searchGraphNodes, createGuardedHandler(getMainWindow,
            input => searchGraphNodes(input?.projectId, input?.query || '', input?.kinds || [], input?.limit || 100),
            'graph.searchNodes', KNOWLEDGE_INPUT_SCHEMAS.searchGraphNodes)],
        [REFERENCE_IPC_CHANNELS.getGraphNode, createGuardedHandler(getMainWindow,
            input => getGraphNode(input?.projectId, input?.nodeId, input?.includeBody !== false),
            'graph.getNode', KNOWLEDGE_INPUT_SCHEMAS.getGraphNode)],
        [REFERENCE_IPC_CHANNELS.getGraphEdge, createGuardedHandler(getMainWindow,
            input => getGraphEdge(input?.projectId, input?.edgeId),
            'graph.getEdge', KNOWLEDGE_INPUT_SCHEMAS.getGraphEdge)],
        [REFERENCE_IPC_CHANNELS.listGraphEdges, createGuardedHandler(getMainWindow,
            input => listGraphEdges(input?.projectId, input?.nodeId, input?.direction || 'both', input?.types || [], input?.limit || 200),
            'graph.listEdges', KNOWLEDGE_INPUT_SCHEMAS.listGraphEdges)],
        [REFERENCE_IPC_CHANNELS.commitGraph, createGuardedHandler(getMainWindow,
            input => commitGraph(input?.projectId, input?.request, humanActor(input?.clientId)),
            'graph.commit', KNOWLEDGE_INPUT_SCHEMAS.commitGraph)],
    ]);
    return registerHandlers(ipcMain, handlers);
}

function humanActor(clientId) {
    const id = typeof clientId === 'string' ? clientId.replace(/[\0\r\n]/gu, '').slice(0, 160) : '';
    return { kind: 'human', id: id || 'renderer' };
}
