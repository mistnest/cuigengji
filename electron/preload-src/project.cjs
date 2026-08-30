'use strict';

const PROJECT_IPC_CHANNELS = Object.freeze({
    list: 'cgj:v1:projects:list', create: 'cgj:v1:projects:create',
    requestDelete: 'cgj:v1:projects:request-delete', delete: 'cgj:v1:projects:delete',
    changed: 'cgj:v1:projects:changed',
    changes: 'cgj:v1:projects:changes',
});
const CHAPTER_IPC_CHANNELS = Object.freeze({
    list: 'cgj:v1:chapters:list', get: 'cgj:v1:chapters:get',
    create: 'cgj:v1:chapters:create', update: 'cgj:v1:chapters:update',
    delete: 'cgj:v1:chapters:delete',
});
const OUTLINE_IPC_CHANNELS = Object.freeze({
    get: 'cgj:v1:outlines:get', createNode: 'cgj:v1:outlines:create-node',
    updateNode: 'cgj:v1:outlines:update-node', reorder: 'cgj:v1:outlines:reorder',
    deleteNode: 'cgj:v1:outlines:delete-node', applyPatch: 'cgj:v1:outlines:apply-patch',
});
const WORKSPACE_IPC_CHANNELS = Object.freeze({
    get: 'cgj:v1:workspaces:get', save: 'cgj:v1:workspaces:save',
});

function createProjectFacade(input) {
    const invoke = typeof input === 'function' ? input : input.invoke;
    const ipcRenderer = typeof input === 'object' ? input.ipcRenderer : null;
    const actorId = typeof input === 'object' ? input.actorId : '';
    const writePayload = value => ({ ...value, ...(actorId ? { clientId: actorId } : {}) });
    const projects = Object.freeze({
        list: () => invoke(PROJECT_IPC_CHANNELS.list),
        changes: (projectId, options = {}) => invoke(PROJECT_IPC_CHANNELS.changes, {
            projectId,
            sinceSeq: options.sinceSeq,
            sinceStreamId: options.sinceStreamId,
        }),
        create: input => invoke(PROJECT_IPC_CHANNELS.create, writePayload(input || {})),
        requestDelete: projectId => invoke(PROJECT_IPC_CHANNELS.requestDelete, { projectId }),
        delete: (projectId, confirmationToken) => invoke(PROJECT_IPC_CHANNELS.delete, writePayload({
            projectId, confirmationToken,
        })),
        onChanged(listener) {
            if (typeof listener !== 'function') throw new TypeError('listener must be a function');
            if (!ipcRenderer) return () => {};
            const handler = (_event, value) => listener(value);
            ipcRenderer.on(PROJECT_IPC_CHANNELS.changed, handler);
            let active = true;
            return () => {
                if (!active) return;
                active = false;
                ipcRenderer.removeListener(PROJECT_IPC_CHANNELS.changed, handler);
            };
        },
    });
    const chapters = Object.freeze({
        list: projectId => invoke(CHAPTER_IPC_CHANNELS.list, { projectId }),
        get: (projectId, chapterId) => invoke(CHAPTER_IPC_CHANNELS.get, { projectId, chapterId }),
        create: (projectId, chapter) => invoke(CHAPTER_IPC_CHANNELS.create, writePayload({
            projectId, chapter,
        })),
        update: (projectId, chapterId, patch) => invoke(CHAPTER_IPC_CHANNELS.update, writePayload({
            projectId, chapterId, patch,
        })),
        delete: (projectId, chapterId, options) => invoke(CHAPTER_IPC_CHANNELS.delete, writePayload({
            projectId,
            chapterId,
            confirmed: typeof options === 'boolean' ? options : options?.confirmed,
            expectedRevision: typeof options === 'object' ? options?.expectedRevision : undefined,
            expectedContentHash: typeof options === 'object' ? options?.expectedContentHash : undefined,
        })),
    });
    const outlines = Object.freeze({
        get: projectId => invoke(OUTLINE_IPC_CHANNELS.get, { projectId }),
        createNode: (projectId, node) => invoke(OUTLINE_IPC_CHANNELS.createNode, writePayload({
            projectId, node,
        })),
        updateNode: (projectId, nodeId, patch) => invoke(OUTLINE_IPC_CHANNELS.updateNode, writePayload({
            projectId, nodeId, patch,
        })),
        reorder: (projectId, command) => invoke(OUTLINE_IPC_CHANNELS.reorder, writePayload({
            projectId, command,
        })),
        deleteNode: (projectId, nodeId, options) => invoke(OUTLINE_IPC_CHANNELS.deleteNode, writePayload({
            projectId,
            nodeId,
            confirmed: options?.confirmed,
            expectedRevision: options?.expectedRevision,
            expectedContentHash: options?.expectedContentHash,
        })),
        applyPatch: (projectId, patch) => invoke(OUTLINE_IPC_CHANNELS.applyPatch, writePayload({
            projectId, patch,
        })),
    });
    const workspace = Object.freeze({
        get: projectId => invoke(WORKSPACE_IPC_CHANNELS.get, { projectId }),
        save: (projectId, value) => invoke(WORKSPACE_IPC_CHANNELS.save, writePayload({
            projectId,
            workspace: value,
            expectedRevision: value?.expectedRevision,
            expectedContentHash: value?.expectedContentHash,
        })),
    });
    return Object.freeze({ clientId: actorId, projects, chapters, outlines, workspace });
}
