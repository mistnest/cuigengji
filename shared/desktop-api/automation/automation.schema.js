import { defineObjectSchema } from '../core/schema.js';

const operationId = { type: 'string', maxLength: 200 };
const config = { type: 'object', required: true };
const text = { type: 'string', required: true, maxLength: 10_000_000 };

export const AUTOMATION_INPUT_SCHEMAS = Object.freeze({
    debugLastPrompt: defineObjectSchema('automation.debug.lastPrompt', {}, {
        allowUndefined: true,
    }),
    writingContinue: defineObjectSchema('automation.writing.continue', {
        operationId,
        message: { type: 'string', required: true, maxLength: 100_000 },
        config,
        context: { type: 'object' },
    }),
    writingInfill: defineObjectSchema('automation.writing.infill', {
        operationId,
        beforeText: { type: 'string', maxLength: 10_000_000 },
        afterText: { type: 'string', maxLength: 10_000_000 },
        instruction: { type: 'string', required: true, maxLength: 100_000 },
        config,
    }),
    ideasPlotSuggestions: defineObjectSchema('automation.ideas.plotSuggestions', {
        operationId, text, config,
    }),
    ideasInspire: defineObjectSchema('automation.ideas.inspire', {
        operationId,
        text: { type: 'string', maxLength: 10_000_000 },
        config,
    }),
    extractionAnalyze: defineObjectSchema('automation.extraction.analyze', {
        operationId, text, config,
    }),
    extractionProject: defineObjectSchema('automation.extraction.project', {
        operationId,
        novelId: { type: 'string', required: true, maxLength: 200 },
        config,
        startOrder: { type: 'number' },
        endOrder: { type: 'number' },
    }),
    jobsCreate: defineObjectSchema('automation.jobs.create', {
        operationId,
        type: { type: 'string', required: true, maxLength: 20 },
        config,
        novelId: { type: 'string', maxLength: 200 },
        text: { type: 'string', maxLength: 10_000_000 },
    }),
    jobsList: defineObjectSchema('automation.jobs.list', {}, { allowUndefined: true }),
    jobsGet: defineObjectSchema('automation.jobs.get', {
        jobId: { type: 'string', required: true, maxLength: 200 },
    }),
    jobsDelete: defineObjectSchema('automation.jobs.delete', {
        jobId: { type: 'string', required: true, maxLength: 200 },
    }),
    summaryGenerate: defineObjectSchema('automation.summary.generate', {
        operationId, text, config,
        type: { type: 'string', maxLength: 50 },
    }),
    cancel: defineObjectSchema('automation.cancel', {
        operationId: { type: 'string', required: true, maxLength: 200 },
    }),
});
