import { savePreset } from '../../../src/backend/foundation/configuration/index.js';
import {
    CONFIGURATION_INPUT_SCHEMAS,
    PRESET_IPC_CHANNELS,
} from '../../../shared/desktop-api/configuration/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

function withoutPath(value) {
    if (!value || typeof value !== 'object') return value;
    const safe = { ...value };
    delete safe.path;
    return safe;
}

export function registerPresetIpcHandlers({ ipcMain, getMainWindow }) {
    const handlers = new Map([
        [PRESET_IPC_CHANNELS.save, createGuardedHandler(getMainWindow,
            async input => withoutPath(await savePreset(
                input?.projectId,
                input?.name,
                input?.data,
                {
                    expectedRevision: input?.expectedRevision,
                    expectedContentHash: input?.expectedContentHash,
                    actor: humanActor(input?.clientId),
                },
            )),
            'presets.save', CONFIGURATION_INPUT_SCHEMAS.savePreset)],
    ]);
    return registerHandlers(ipcMain, handlers);
}

function humanActor(clientId) {
    const id = typeof clientId === 'string' ? clientId.replace(/[\0\r\n]/gu, '').slice(0, 160) : '';
    return { kind: 'human', id: id || 'renderer' };
}
