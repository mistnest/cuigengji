import {
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
            input => createOutlineNode(input?.projectId, input?.node), 'outlines.createNode',
            PROJECT_INPUT_SCHEMAS.createOutlineNode)],
        [OUTLINE_IPC_CHANNELS.updateNode, createGuardedHandler(getMainWindow,
            input => updateOutlineNode(input?.projectId, input?.nodeId, input?.patch),
            'outlines.updateNode', PROJECT_INPUT_SCHEMAS.updateOutlineNode)],
        [OUTLINE_IPC_CHANNELS.reorder, createGuardedHandler(getMainWindow,
            input => reorderOutline(input?.projectId, input?.command), 'outlines.reorder',
            PROJECT_INPUT_SCHEMAS.reorderOutline)],
        [OUTLINE_IPC_CHANNELS.deleteNode, createGuardedHandler(getMainWindow,
            input => deleteOutlineNode(input?.projectId, input?.nodeId, {
                confirmed: input?.confirmed,
                expectedRevision: input?.expectedRevision,
            }), 'outlines.deleteNode', PROJECT_INPUT_SCHEMAS.deleteOutlineNode)],
    ]);
    return registerHandlers(ipcMain, handlers);
}
