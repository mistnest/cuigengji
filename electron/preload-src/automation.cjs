'use strict';

const AUTOMATION_IPC_CHANNELS = Object.freeze({
    debugLastPrompt: 'cgj:v1:automation:debug:last-prompt',
    writingContinue: 'cgj:v1:automation:writing:continue',
    writingInfill: 'cgj:v1:automation:writing:infill',
    ideasPlotSuggestions: 'cgj:v1:automation:ideas:plot-suggestions',
    ideasInspire: 'cgj:v1:automation:ideas:inspire',
    extractionAnalyze: 'cgj:v1:automation:extraction:analyze',
    extractionProject: 'cgj:v1:automation:extraction:project',
    jobsCreate: 'cgj:v1:automation:jobs:create',
    jobsList: 'cgj:v1:automation:jobs:list',
    jobsGet: 'cgj:v1:automation:jobs:get',
    jobsDelete: 'cgj:v1:automation:jobs:delete',
    summaryGenerate: 'cgj:v1:automation:summary:generate',
    cancel: 'cgj:v1:automation:cancel',
});

function createAutomationFacade(invoke) {
    const call = (channel, payload) => invoke(channel, payload).then(value => value.result);
    const debug = Object.freeze({
        lastPrompt: () => call(AUTOMATION_IPC_CHANNELS.debugLastPrompt),
    });
    const writing = Object.freeze({
        continue: payload => call(AUTOMATION_IPC_CHANNELS.writingContinue, payload),
        infill: payload => call(AUTOMATION_IPC_CHANNELS.writingInfill, payload),
    });
    const ideas = Object.freeze({
        plotSuggestions: payload => call(AUTOMATION_IPC_CHANNELS.ideasPlotSuggestions, payload),
        inspire: payload => call(AUTOMATION_IPC_CHANNELS.ideasInspire, payload),
    });
    const extraction = Object.freeze({
        analyze: payload => call(AUTOMATION_IPC_CHANNELS.extractionAnalyze, payload),
        project: payload => call(AUTOMATION_IPC_CHANNELS.extractionProject, payload),
    });
    const jobs = Object.freeze({
        create: payload => call(AUTOMATION_IPC_CHANNELS.jobsCreate, payload),
        list: () => call(AUTOMATION_IPC_CHANNELS.jobsList),
        get: jobId => call(AUTOMATION_IPC_CHANNELS.jobsGet, { jobId }),
        delete: jobId => call(AUTOMATION_IPC_CHANNELS.jobsDelete, { jobId }),
    });
    const summary = Object.freeze({
        generate: payload => call(AUTOMATION_IPC_CHANNELS.summaryGenerate, payload),
    });
    const operations = Object.freeze({
        run: (operation, payload, options = {}) => {
            const input = options.operationId
                ? { ...(payload || {}), operationId: options.operationId }
                : payload;
            switch (operation) {
            case 'debug.lastPrompt': return debug.lastPrompt();
            case 'writing.continue': return writing.continue(input);
            case 'writing.infill': return writing.infill(input);
            case 'ideas.plotSuggestions': return ideas.plotSuggestions(input);
            case 'ideas.inspire': return ideas.inspire(input);
            case 'extraction.analyze': return extraction.analyze(input);
            case 'extraction.project': return extraction.project(input);
            case 'extraction.jobs.create': return jobs.create(input);
            case 'extraction.jobs.list': return jobs.list();
            case 'extraction.jobs.get': return jobs.get(options.jobId);
            case 'extraction.jobs.delete': return jobs.delete(options.jobId);
            case 'summary.generate': return summary.generate(input);
            default: return Promise.reject(new Error(`Unsupported automation operation: ${operation}`));
            }
        },
        cancel: operationId => invoke(AUTOMATION_IPC_CHANNELS.cancel, { operationId }),
    });
    return Object.freeze({
        available: true,
        debug,
        writing,
        ideas,
        extraction,
        jobs,
        summary,
        operations,
    });
}
