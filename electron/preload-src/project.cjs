'use strict';

const PROJECT_IPC_CHANNELS = Object.freeze({
    list: 'cgj:v1:projects:list', create: 'cgj:v1:projects:create',
    requestDelete: 'cgj:v1:projects:request-delete', delete: 'cgj:v1:projects:delete',
});
const CHAPTER_IPC_CHANNELS = Object.freeze({
    list: 'cgj:v1:chapters:list', get: 'cgj:v1:chapters:get',
    create: 'cgj:v1:chapters:create', update: 'cgj:v1:chapters:update',
    delete: 'cgj:v1:chapters:delete',
});
const OUTLINE_IPC_CHANNELS = Object.freeze({
    get: 'cgj:v1:outlines:get', createNode: 'cgj:v1:outlines:create-node',
    updateNode: 'cgj:v1:outlines:update-node', reorder: 'cgj:v1:outlines:reorder',
    deleteNode: 'cgj:v1:outlines:delete-node',
});
const WORKSPACE_IPC_CHANNELS = Object.freeze({
    get: 'cgj:v1:workspaces:get', save: 'cgj:v1:workspaces:save',
});

function createProjectFacade(invoke) {
    const projects = Object.freeze({
        list: () => invoke(PROJECT_IPC_CHANNELS.list),
        create: input => invoke(PROJECT_IPC_CHANNELS.create, input),
        requestDelete: projectId => invoke(PROJECT_IPC_CHANNELS.requestDelete, { projectId }),
        delete: (projectId, confirmationToken) => invoke(PROJECT_IPC_CHANNELS.delete, {
            projectId, confirmationToken,
        }),
    });
    const chapters = Object.freeze({
        list: projectId => invoke(CHAPTER_IPC_CHANNELS.list, { projectId }),
        get: (projectId, chapterId) => invoke(CHAPTER_IPC_CHANNELS.get, { projectId, chapterId }),
        create: (projectId, chapter) => invoke(CHAPTER_IPC_CHANNELS.create, {
            projectId, chapter,
        }),
        update: (projectId, chapterId, patch) => invoke(CHAPTER_IPC_CHANNELS.update, {
            projectId, chapterId, patch,
        }),
        delete: (projectId, chapterId, confirmed) => invoke(CHAPTER_IPC_CHANNELS.delete, {
            projectId, chapterId, confirmed,
        }),
    });
    const outlines = Object.freeze({
        get: projectId => invoke(OUTLINE_IPC_CHANNELS.get, { projectId }),
        createNode: (projectId, node) => invoke(OUTLINE_IPC_CHANNELS.createNode, {
            projectId, node,
        }),
        updateNode: (projectId, nodeId, patch) => invoke(OUTLINE_IPC_CHANNELS.updateNode, {
            projectId, nodeId, patch,
        }),
        reorder: (projectId, command) => invoke(OUTLINE_IPC_CHANNELS.reorder, {
            projectId, command,
        }),
        deleteNode: (projectId, nodeId, options) => invoke(OUTLINE_IPC_CHANNELS.deleteNode, {
            projectId,
            nodeId,
            confirmed: options?.confirmed,
            expectedRevision: options?.expectedRevision,
        }),
    });
    const workspace = Object.freeze({
        get: projectId => invoke(WORKSPACE_IPC_CHANNELS.get, { projectId }),
        save: (projectId, value) => invoke(WORKSPACE_IPC_CHANNELS.save, {
            projectId, workspace: value,
        }),
    });
    return Object.freeze({ projects, chapters, outlines, workspace });
}
