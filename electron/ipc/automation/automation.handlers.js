import { randomUUID } from 'node:crypto';

import { executeAutomationOperation } from '../../../src/backend/intelligence/automation/index.js';
import {
    AUTOMATION_INPUT_SCHEMAS,
    AUTOMATION_IPC_CHANNELS,
    AUTOMATION_OPERATIONS,
} from '../../../shared/desktop-api/automation/index.js';
import { createGuardedHandler, registerHandlers } from '../core/guard.js';

const OPERATION_DEFINITIONS = Object.freeze([
    ['debugLastPrompt', 'debugLastPrompt'],
    ['writingContinue', 'writingContinue'],
    ['writingInfill', 'writingInfill'],
    ['ideasPlotSuggestions', 'ideasPlotSuggestions'],
    ['ideasInspire', 'ideasInspire'],
    ['extractionAnalyze', 'extractionAnalyze'],
    ['extractionProject', 'extractionProject'],
    ['jobsCreate', 'jobsCreate'],
    ['jobsList', 'jobsList'],
    ['jobsGet', 'jobsGet'],
    ['jobsDelete', 'jobsDelete'],
    ['summaryGenerate', 'summaryGenerate'],
]);

export function registerAutomationIpcHandlers({
    ipcMain,
    getMainWindow,
    executeOperation = executeAutomationOperation,
}) {
    const active = new Map();
    const handlers = new Map();

    for (const [channelKey, operationKey] of OPERATION_DEFINITIONS) {
        const channel = AUTOMATION_IPC_CHANNELS[channelKey];
        const operation = AUTOMATION_OPERATIONS[operationKey];
        handlers.set(channel, createGuardedHandler(
            getMainWindow,
            input => runOperation(active, executeOperation, operation, input),
            `automation.${operation}`,
            AUTOMATION_INPUT_SCHEMAS[operationKey],
        ));
    }

    handlers.set(AUTOMATION_IPC_CHANNELS.cancel, createGuardedHandler(
        getMainWindow,
        input => {
            const controller = active.get(input.operationId);
            controller?.abort();
            return { operationId: input.operationId, cancelled: Boolean(controller) };
        },
        'automation.cancel',
        AUTOMATION_INPUT_SCHEMAS.cancel,
    ));

    const unregister = registerHandlers(ipcMain, handlers);
    return () => {
        for (const controller of active.values()) controller.abort();
        active.clear();
        unregister();
    };
}

async function runOperation(active, executeOperation, operation, input = {}) {
    const operationId = input.operationId || randomUUID();
    if (active.has(operationId)) {
        const error = new Error(`Automation operation is already active: ${operationId}`);
        error.code = 'CONFLICT';
        throw error;
    }
    const controller = new AbortController();
    active.set(operationId, controller);
    const payload = { ...input };
    delete payload.operationId;
    try {
        const result = await executeOperation(operation, payload, {
            jobId: payload.jobId,
            signal: controller.signal,
        });
        return { operationId, result };
    } finally {
        active.delete(operationId);
    }
}
