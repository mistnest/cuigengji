import { randomUUID } from 'node:crypto';

export const DSH_RPC_ALLOWLIST = Object.freeze([
    'workspace.create',
    'workspace.rename',
    'session.list',
    'session.create',
    'session.history',
    'session.prompt',
    'session.cancel',
]);

const ALLOWED_METHODS = new Set(DSH_RPC_ALLOWLIST);

export class DshRpcError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'DshRpcError';
        this.code = code;
        this.method = options.method;
        this.retryable = Boolean(options.retryable);
        this.remoteCode = options.remoteCode;
    }
}

export function createDshRpcClient({ baseUrl, fetchImpl = fetch, defaultTimeoutMs = 10_000 }) {
    const endpoint = new URL(baseUrl);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
        throw new DshRpcError('DSH_ENDPOINT_INVALID', 'DSH endpoint must be loopback HTTP');
    }

    async function call(method, payload = {}, options = {}) {
        if (!ALLOWED_METHODS.has(method)) {
            throw new DshRpcError('DSH_RPC_METHOD_DENIED', 'DSH RPC method is not allowed', { method });
        }
        const rpcId = randomUUID();
        const timeoutMs = boundedTimeout(options.timeoutMs, defaultTimeoutMs);
        let response;
        try {
            response = await fetchImpl(new URL(`/api/${method}`, endpoint), {
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
        } catch (error) {
            throw new DshRpcError('DSH_RPC_UNREACHABLE', 'DSH RPC request failed', {
                method,
                retryable: true,
            });
        }
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw new DshRpcError('DSH_RPC_HTTP_ERROR', 'DSH RPC returned an HTTP error', {
                method,
                retryable: response.status >= 500,
            });
        }

        let envelope;
        try {
            envelope = await response.json();
        } catch {
            throw new DshRpcError('DSH_RPC_INVALID_RESPONSE', 'DSH RPC returned invalid JSON', {
                method,
                retryable: true,
            });
        }
        if (envelope?.rpcId !== rpcId) {
            throw new DshRpcError('DSH_RPC_ID_MISMATCH', 'DSH RPC response id mismatch', {
                method,
                retryable: true,
            });
        }
        if (envelope?.result?.ok !== true) {
            throw new DshRpcError('DSH_RPC_REJECTED', 'DSH RPC rejected the request', {
                method,
                retryable: true,
                remoteCode: cleanCode(envelope?.result?.error?.code),
            });
        }
        return envelope.result.value;
    }

    return { call };
}

function boundedTimeout(value, fallback) {
    const timeout = Number(value ?? fallback);
    return Number.isFinite(timeout) ? Math.min(60_000, Math.max(250, timeout)) : fallback;
}

function cleanCode(value) {
    return typeof value === 'string' ? value.slice(0, 100) : 'unknown';
}
