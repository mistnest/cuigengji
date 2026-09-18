#!/usr/bin/env node
import { prepareHistoryGraph, sealHistoryGraph, unsealPublishedHistoryGraph, sealHistoryRollback, unsealHistoryRollback } from './history-branch.js';
const values = new Map();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1])
        throw new Error('expected --name value pairs');
    values.set(args[i].slice(2), args[i + 1]);
}
const required = (key) => { const value = values.get(key); if (!value)
    throw new Error(`--${key} required`); return value; };
try {
    const result = values.get('action') === 'seal' ? await sealHistoryGraph(required('receipt'))
        : values.get('action') === 'seal-rollback' ? await sealHistoryRollback(required('receipt'))
            : values.get('action') === 'unseal-rollback' ? await unsealHistoryRollback(required('receipt'), required('results-root'))
                : values.get('action') === 'unseal-published' ? await unsealPublishedHistoryGraph(required('receipt'), required('results-root'))
                    : await prepareHistoryGraph({ sourceNovelId: required('source-novel-id'), branchNovelId: required('branch-novel-id'),
                        runId: required('run-id'), manifestPath: required('original-handoffs'), graphRoot: required('graph-root'),
                        resultsRoot: required('results-root'), receiptPath: required('receipt') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
catch (error) {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
}
//# sourceMappingURL=history-branch-bin.js.map