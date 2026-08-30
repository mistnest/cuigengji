import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const READY_PATTERN = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/u;

export async function startDshContractRuntime(launch) {
    const dshPackage = require.resolve('@deepseek-ai/dsh/package.json');
    const child = spawn(process.execPath, [
        '--expose-internals',
        path.join(path.dirname(dshPackage), 'lib', 'bin.js'),
        'web',
        '--patch', launch.patchFile,
        '--port', '0',
    ], {
        cwd: launch.runtimeRoot,
        env: {
            ...launch.env,
            ELECTRON_RUN_AS_NODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const url = await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => finish(new Error(
            `DSH contract runtime startup timed out\n${stderr.slice(-4_000)}`,
        )), 45_000);
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve(value);
        };
        child.stdout.on('data', chunk => {
            stdout = `${stdout}${String(chunk)}`.slice(-32_000);
            const match = READY_PATTERN.exec(stdout);
            if (match) finish(null, match[1]);
        });
        child.stderr.on('data', chunk => {
            stderr = `${stderr}${String(chunk)}`.slice(-32_000);
        });
        child.once('error', error => finish(error));
        child.once('exit', code => finish(new Error(
            `DSH contract runtime exited before ready (${code})\n${stderr.slice(-4_000)}`,
        )));
    });

    return {
        child,
        url,
        get stdout() {
            return stdout;
        },
        get stderr() {
            return stderr;
        },
        async stop() {
            if (child.exitCode !== null) return;
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill();
            await Promise.race([
                exited,
                new Promise(resolve => setTimeout(resolve, 3_000)),
            ]);
            if (child.exitCode === null) child.kill('SIGKILL');
        },
    };
}

export async function dshRpc(url, method, payload, timeoutMs = 10_000) {
    const rpcId = randomUUID();
    const response = await fetch(`${url}/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            type: 'client-request',
            rpcId,
            method,
            payload,
        }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`DSH ${method} returned HTTP ${response.status}`);
    const envelope = await response.json();
    if (envelope?.rpcId !== rpcId) throw new Error(`DSH ${method} rpcId mismatch`);
    if (envelope?.result?.ok !== true) {
        throw new Error(`DSH ${method} failed: ${envelope?.result?.error?.code || 'unknown'}`);
    }
    return envelope.result.value;
}

export async function createDshSession(url, launch) {
    const created = await dshRpc(url, 'workspace.create', { path: launch.workspaceDir });
    const workspace = created.workspace;
    if (!workspace?.workspaceId) throw new Error('DSH workspace.create returned no workspaceId');
    if (Array.isArray(workspace.sessionIds) && workspace.sessionIds.length > 0) {
        return { workspace, sessionId: workspace.sessionIds[0] };
    }
    const session = await dshRpc(url, 'session.create', {
        workspaceId: workspace.workspaceId,
        agentPreset: 'cuigenji',
    });
    return { workspace, sessionId: session.sessionId };
}

export function openDshMux(url) {
    const frames = [];
    let streamError;
    let readySettled = false;
    let markReady;
    let markReadyFailed;
    const ready = new Promise((resolve, reject) => {
        markReady = () => {
            readySettled = true;
            resolve();
        };
        markReadyFailed = error => {
            if (!readySettled) reject(error);
        };
    });
    const socketUrl = new URL('/api/events.mux', url);
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(socketUrl);
    let markClosed;
    const closed = new Promise(resolve => {
        markClosed = resolve;
    });
    socket.addEventListener('open', markReady, { once: true });
    socket.addEventListener('message', event => {
        try {
            if (typeof event.data !== 'string') throw new Error('DSH mux returned a binary frame');
            frames.push(JSON.parse(event.data).payload);
        } catch (error) {
            streamError = error;
        }
    });
    socket.addEventListener('error', () => {
        streamError = new Error('DSH events.mux WebSocket failed');
        markReadyFailed(streamError);
    });
    socket.addEventListener('close', () => markClosed(), { once: true });

    return {
        frames,
        ready,
        async waitFor(predicate, timeoutMs = 15_000) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const value = frames.find(predicate);
                if (value !== undefined) return value;
                if (streamError) throw streamError;
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            throw new Error(`Timed out waiting for DSH mux frame; received ${frames.length}`);
        },
        async close() {
            if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
            await closed;
        },
    };
}

export async function waitForDshHistory(url, sessionId, predicate, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let last = { events: [] };
    while (Date.now() < deadline) {
        last = await dshRpc(url, 'session.history', { sessionId, maxMessages: 100 });
        if (predicate(last.events)) return last;
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    const types = last.events.map(item => item.event?.type).join(', ');
    throw new Error(`Timed out waiting for DSH history; received: ${types}`);
}

export async function startMockDeepSeekProvider(responder = defaultResponder) {
    const requests = [];
    const sockets = new Set();
    const server = createServer(async (request, response) => {
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
            response.writeHead(404).end();
            return;
        }
        try {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const record = {
                body,
                authorization: request.headers.authorization || '',
            };
            requests.push(record);
            const result = await responder(body, requests.length - 1);
            if (result.statusCode && result.statusCode !== 200) {
                response.writeHead(result.statusCode, { 'content-type': 'application/json' });
                response.end(JSON.stringify(result.json || {
                    error: { message: `mock provider HTTP ${result.statusCode}` },
                }));
                return;
            }
            if (body.stream !== true) {
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify(result.json || completionFromFrames(result.frames)));
                return;
            }
            response.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
            });
            response.flushHeaders();
            if (result.delayBeforeFramesMs) {
                await new Promise(resolve => setTimeout(resolve, result.delayBeforeFramesMs));
            }
            for (const frame of result.frames || []) {
                response.write(`data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`);
            }
            if (!result.holdOpen) response.end();
        } catch (error) {
            if (!response.headersSent) {
                response.writeHead(500, { 'content-type': 'application/json' });
            }
            response.end(JSON.stringify({ error: { message: error.message } }));
        }
    });
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        requests,
        async waitForRequest(predicate, timeoutMs = 15_000) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const value = requests.find(predicate);
                if (value !== undefined) return value;
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            const requestMessages = requests.map((record, index) => ({
                index,
                messages: (record.body.messages || []).map(message => ({
                    role: message.role,
                    text: messageText(message).slice(0, 300),
                })),
            }));
            throw new Error(
                `Timed out waiting for mock Provider request; received ${requests.length}\n`
                + JSON.stringify(requestMessages, null, 2),
            );
        },
        async close() {
            for (const socket of sockets) socket.destroy();
            await new Promise(resolve => server.close(resolve));
        },
    };
}

function completionFromFrames(frames = []) {
    let content = '';
    let reasoning = '';
    let finishReason = 'stop';
    const toolCalls = [];
    for (const frame of frames) {
        if (!frame || typeof frame !== 'object') continue;
        const choice = frame.choices?.[0];
        content += choice?.delta?.content || '';
        reasoning += choice?.delta?.reasoning_content || '';
        if (choice?.delta?.tool_calls) toolCalls.push(...choice.delta.tool_calls);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
    return {
        id: 'mock-completion',
        object: 'chat.completion',
        created: 0,
        model: 'mock-model',
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content,
                ...(reasoning ? { reasoning_content: reasoning } : {}),
                ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: finishReason,
        }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    };
}

export function textResponseFrames(text, options = {}) {
    const choices = [];
    if (options.reasoning) {
        choices.push({ choices: [{ index: 0, delta: { reasoning_content: options.reasoning } }] });
    }
    choices.push({ choices: [{ index: 0, delta: { content: text } }] });
    choices.push({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    });
    return [...choices, '[DONE]'];
}

export function toolResponseFrames(name, args, callId = 'contract-tool-call') {
    return [{
        choices: [{
            index: 0,
            delta: {
                tool_calls: [{
                    index: 0,
                    id: callId,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                }],
            },
            finish_reason: 'tool_calls',
        }],
    }, '[DONE]'];
}

export function messageText(message) {
    if (typeof message?.content === 'string') return message.content;
    if (!Array.isArray(message?.content)) return '';
    return message.content
        .filter(part => part?.type === 'text')
        .map(part => part.text || '')
        .join('\n');
}

function defaultResponder() {
    return { frames: textResponseFrames('DSH contract reply') };
}
