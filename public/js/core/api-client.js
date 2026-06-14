(function () {
    'use strict';

    class ApiError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'ApiError';
            this.status = options.status || 0;
            this.code = options.code || 'REQUEST_FAILED';
            this.details = options.details;
        }
    }

    const queues = new Map();

    async function request(url, options = {}) {
        const {
            timeout = 30000,
            queueKey,
            body,
            headers,
            signal,
            ...fetchOptions
        } = options;
        const execute = () => executeRequest(url, {
            ...fetchOptions,
            body,
            headers,
            signal,
            timeout,
        });
        return queueKey ? enqueue(queueKey, execute) : execute();
    }

    async function executeRequest(url, options) {
        const controller = new AbortController();
        const timeoutId = options.timeout > 0
            ? setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), options.timeout)
            : null;
        const abort = () => controller.abort(options.signal?.reason);
        if (options.signal) {
            if (options.signal.aborted) abort();
            else options.signal.addEventListener('abort', abort, { once: true });
        }

        try {
            const isFormData = options.body instanceof FormData;
            const requestHeaders = { ...(options.headers || {}) };
            let requestBody = options.body;
            if (requestBody !== undefined && requestBody !== null && !isFormData && typeof requestBody !== 'string') {
                requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
                requestBody = JSON.stringify(requestBody);
            }
            const response = await fetch(url, {
                ...options,
                headers: requestHeaders,
                body: requestBody,
                signal: controller.signal,
            });
            const data = await parseResponse(response);
            if (!response.ok) {
                throw new ApiError(data?.error || `HTTP ${response.status}`, {
                    status: response.status,
                    code: data?.code,
                    details: data?.details,
                });
            }
            return data;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            options.signal?.removeEventListener('abort', abort);
        }
    }

    async function parseResponse(response) {
        if (response.status === 204) return null;
        const text = await response.text();
        if (!text) return {};
        const type = response.headers.get('content-type') || '';
        if (type.includes('application/json')) {
            try {
                return JSON.parse(text);
            } catch {
                throw new ApiError('Server returned invalid JSON', {
                    status: response.status,
                    code: 'INVALID_RESPONSE',
                });
            }
        }
        return text;
    }

    function enqueue(key, operation) {
        const previous = queues.get(key) || Promise.resolve();
        const current = previous.catch(() => {}).then(operation);
        queues.set(key, current);
        current.finally(() => {
            if (queues.get(key) === current) queues.delete(key);
        }).catch(() => {});
        return current;
    }

    window.ApiClient = {
        ApiError,
        request,
        get: (url, options) => request(url, { ...options, method: 'GET' }),
        post: (url, body, options) => request(url, { ...options, method: 'POST', body }),
        put: (url, body, options) => request(url, { ...options, method: 'PUT', body }),
        delete: (url, body, options) => request(url, { ...options, method: 'DELETE', body }),
    };
})();
