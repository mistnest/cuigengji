'use strict';

const REFERENCE_IPC_CHANNELS = Object.freeze({
    listWorldBooks: 'cgj:v1:references:list-worldbooks',
    getWorldBook: 'cgj:v1:references:get-worldbook',
    saveWorldBook: 'cgj:v1:references:save-worldbook',
    updateWorldBookEntry: 'cgj:v1:references:update-worldbook-entry',
    listCharacters: 'cgj:v1:references:list-characters',
    saveCharacter: 'cgj:v1:references:save-character',
    searchGraphNodes: 'cgj:v1:graph:search-nodes',
    getGraphNode: 'cgj:v1:graph:get-node',
    getGraphEdge: 'cgj:v1:graph:get-edge',
    listGraphEdges: 'cgj:v1:graph:list-edges',
    commitGraph: 'cgj:v1:graph:commit',
});

function createKnowledgeFacade(input) {
    const invoke = typeof input === 'function' ? input : input.invoke;
    const actorId = typeof input === 'object' ? input.actorId : '';
    const writePayload = value => ({ ...value, ...(actorId ? { clientId: actorId } : {}) });
    const worldbooks = Object.freeze({
        list: projectId => invoke(REFERENCE_IPC_CHANNELS.listWorldBooks, { projectId }),
        get: (projectId, name) => invoke(REFERENCE_IPC_CHANNELS.getWorldBook, {
            projectId, name,
        }),
        save: (projectId, name, data, options) => invoke(REFERENCE_IPC_CHANNELS.saveWorldBook, writePayload({
            projectId, name, data,
            expectedRevision: options?.expectedRevision,
            expectedContentHash: options?.expectedContentHash,
        })),
        updateEntry: (projectId, bookName, uid, entry, options) => invoke(
            REFERENCE_IPC_CHANNELS.updateWorldBookEntry,
            writePayload({
                projectId, bookName, uid, entry,
                expectedRevision: options?.expectedRevision,
                expectedContentHash: options?.expectedContentHash,
            }),
        ),
    });
    const characters = Object.freeze({
        list: projectId => invoke(REFERENCE_IPC_CHANNELS.listCharacters, { projectId }),
        save: (projectId, data, options) => invoke(REFERENCE_IPC_CHANNELS.saveCharacter, writePayload({
            projectId, data,
            expectedRevision: options?.expectedRevision,
            expectedContentHash: options?.expectedContentHash,
        })),
    });
    const graph = Object.freeze({
        searchNodes: (projectId, query = '', options = {}) => invoke(REFERENCE_IPC_CHANNELS.searchGraphNodes, {
            projectId, query, kinds: options.kinds, limit: options.limit,
        }),
        getNode: (projectId, nodeId, includeBody = true) => invoke(REFERENCE_IPC_CHANNELS.getGraphNode, {
            projectId, nodeId, includeBody,
        }),
        getEdge: (projectId, edgeId) => invoke(REFERENCE_IPC_CHANNELS.getGraphEdge, { projectId, edgeId }),
        listEdges: (projectId, nodeId, options = {}) => invoke(REFERENCE_IPC_CHANNELS.listGraphEdges, {
            projectId, nodeId, direction: options.direction, types: options.types, limit: options.limit,
        }),
        commit: (projectId, request) => invoke(REFERENCE_IPC_CHANNELS.commitGraph, writePayload({ projectId, request })),
    });
    const references = Object.freeze({
        listWorldBooks: worldbooks.list,
        getWorldBook: worldbooks.get,
        saveWorldBook: worldbooks.save,
        updateWorldBookEntry: worldbooks.updateEntry,
        listCharacters: characters.list,
        saveCharacter: characters.save,
    });
    return Object.freeze({ worldbooks, characters, graph, references });
}
