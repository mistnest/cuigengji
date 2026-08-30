import {
    applyOutlinePatch,
    createOutlineNode,
    deleteOutlineNode,
    getOutline,
    reorderOutline,
    updateOutlineNode,
} from '../../../src/backend/domains/project/index.js';
import {
    OUTLINE_IPC_CHANNELS,
    PROJECT_INPUT_SCHEMAS,
} from '../../../shared/desktop-api/project/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

export function registerOutlineIpcHandlers({ ipcMain, getMainWindow }) {
    const handlers = new Map([
        [OUTLINE_IPC_CHANNELS.get, createGuardedHandler(getMainWindow,
            input => getOutline(input?.projectId), 'outlines.get',
            PROJECT_INPUT_SCHEMAS.getOutline)],
        [OUTLINE_IPC_CHANNELS.createNode, createGuardedHandler(getMainWindow,
            input => createOutlineNode(input?.projectId, {
                ...(input?.node || {}),
                actor: humanActor(input?.clientId),
            }), 'outlines.createNode',
            PROJECT_INPUT_SCHEMAS.createOutlineNode)],
        [OUTLINE_IPC_CHANNELS.updateNode, createGuardedHandler(getMainWindow,
            input => updateOutlineNode(input?.projectId, input?.nodeId, {
                ...(input?.patch || {}),
                actor: humanActor(input?.clientId),
            }),
            'outlines.updateNode', PROJECT_INPUT_SCHEMAS.updateOutlineNode)],
        [OUTLINE_IPC_CHANNELS.reorder, createGuardedHandler(getMainWindow,
            input => reorderOutline(input?.projectId, {
                ...(input?.command || {}),
                actor: humanActor(input?.clientId),
            }), 'outlines.reorder',
            PROJECT_INPUT_SCHEMAS.reorderOutline)],
        [OUTLINE_IPC_CHANNELS.deleteNode, createGuardedHandler(getMainWindow,
            input => deleteOutlineNode(input?.projectId, input?.nodeId, {
                confirmed: input?.confirmed,
                expectedRevision: input?.expectedRevision,
                expectedContentHash: input?.expectedContentHash,
                actor: humanActor(input?.clientId),
            }), 'outlines.deleteNode', PROJECT_INPUT_SCHEMAS.deleteOutlineNode)],
        [OUTLINE_IPC_CHANNELS.applyPatch, createGuardedHandler(getMainWindow,
            input => applyOutlinePatch(input?.projectId, {
                ...(input?.patch || {}),
                actor: humanActor(input?.clientId),
            }),
            'outlines.applyPatch', PROJECT_INPUT_SCHEMAS.applyOutlinePatch)],
    ]);
    return registerHandlers(ipcMain, handlers);
}

function humanActor(clientId) {
    const id = typeof clientId === 'string' ? clientId.replace(/[\0\r\n]/gu, '').slice(0, 160) : '';
    return { kind: 'human', id: id || 'renderer' };
}
