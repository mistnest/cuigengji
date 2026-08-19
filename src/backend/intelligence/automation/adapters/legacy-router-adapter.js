import { EventEmitter } from 'node:events';

import { router as aiRouter } from '../../../../legacy/http/endpoints/ai.js';
import { router as chatRouter } from '../../../../legacy/http/endpoints/chat.js';
import { router as debugRouter } from '../../../../legacy/http/endpoints/debug.js';

const OPERATIONS = Object.freeze({
    'debug.lastPrompt': [debugRouter, 'get', '/last-prompt'],
    'writing.infill': [chatRouter, 'post', '/infill'],
    'writing.continue': [chatRouter, 'post', '/write'],
    'ideas.plotSuggestions': [aiRouter, 'post', '/plot-suggestions'],
    'ideas.inspire': [aiRouter, 'post', '/inspire'],
    'extraction.analyze': [aiRouter, 'post', '/extract'],
    'extraction.project': [aiRouter, 'post', '/extract-project-stream'],
    'extraction.jobs.create': [aiRouter, 'post', '/extract-jobs'],
    'extraction.jobs.list': [aiRouter, 'get', '/extract-jobs'],
    'extraction.jobs.get': [aiRouter, 'get', '/extract-jobs/:jobId'],
    'extraction.jobs.delete': [aiRouter, 'delete', '/extract-jobs/:jobId'],
    'summary.generate': [aiRouter, 'post', '/summarize'],
});

export async function executeLegacyAutomation(operation, payload = {}, options = {}) {
    const target = OPERATIONS[operation];
    if (!target) throw automationError('UNSUPPORTED_OPERATION', `Unknown automation operation: ${operation}`);
    const [router, method, routePath] = target;
    const layer = router.stack.find(candidate => (
        candidate.route?.path === routePath && candidate.route.methods?.[method]
    ));
    const handler = layer?.route?.stack?.at(-1)?.handle;
    if (typeof handler !== 'function') {
        throw automationError('AUTOMATION_ADAPTER_ERROR', `Missing automation handler: ${operation}`);
    }

    return invokeHandler(handler, {
        method: method.toUpperCase(),
        path: routePath,
        body: payload || {},
        params: routePath.includes(':jobId') ? { jobId: options.jobId || payload?.jobId } : {},
        signal: options.signal,
    });
}

function invokeHandler(handler, input) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = input.method;
        req.url = input.path;
        req.originalUrl = input.path;
        req.body = input.body;
        req.params = input.params;
        req.query = {};
        req.headers = {};

        const res = new EventEmitter();
        const headers = new Map();
        const chunks = [];
        let settled = false;
        res.statusCode = 200;
        res.headersSent = false;
        res.destroyed = false;
        res.writableEnded = false;
        res.status = code => {
            res.statusCode = Number(code) || 200;
            return res;
        };
        res.setHeader = (name, value) => {
            headers.set(String(name).toLowerCase(), String(value));
            return res;
        };
        res.getHeader = name => headers.get(String(name).toLowerCase());
        res.flushHeaders = () => {
            res.headersSent = true;
        };
        res.write = chunk => {
            res.headersSent = true;
            chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || ''));
            return true;
        };
        res.json = data => {
            res.headersSent = true;
            res.writableEnded = true;
            finish(data);
            return res;
        };
        res.end = chunk => {
            if (chunk) res.write(chunk);
            res.writableEnded = true;
            finish(parseStream(chunks.join('')));
            return res;
        };

        const finish = data => {
            if (settled) return;
            settled = true;
            cleanup();
            if (res.statusCode >= 400) {
                reject(automationError(
                    data?.code || 'AUTOMATION_FAILED',
                    data?.error || data?.message || `Automation failed with status ${res.statusCode}`,
                ));
                return;
            }
            resolve(data);
        };
        const abort = () => {
            if (settled) return;
            req.emit('aborted');
            res.emit('close');
            settled = true;
            cleanup();
            reject(automationError('CANCELLED', 'Automation operation was cancelled.'));
        };
        const cleanup = () => input.signal?.removeEventListener('abort', abort);
        if (input.signal?.aborted) {
            abort();
            return;
        }
        input.signal?.addEventListener('abort', abort, { once: true });

        Promise.resolve(handler(req, res, error => {
            if (error && !settled) {
                settled = true;
                cleanup();
                reject(error);
            }
        })).catch(error => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        });
    });
}

function parseStream(source) {
    const events = source.split(/\r?\n\r?\n/u).flatMap(block => {
        const data = block.split(/\r?\n/u)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n');
        if (!data) return [];
        try {
            return [JSON.parse(data)];
        } catch {
            return [];
        }
    });
    return { stream: true, events };
}

function automationError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.publicMessage = message;
    return error;
}
