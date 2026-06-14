export class ApiError extends Error {
    constructor(status, message, code = 'REQUEST_FAILED', details) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export function asyncRoute(handler) {
    return function routeHandler(req, res, next) {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

export function requireString(value, name, options = {}) {
    const { allowEmpty = false, maxLength = 10000 } = options;
    if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
        throw new ApiError(400, `${name} is required`, 'VALIDATION_ERROR', { field: name });
    }
    if (value.length > maxLength) {
        throw new ApiError(400, `${name} is too long`, 'VALIDATION_ERROR', { field: name, maxLength });
    }
    return value;
}

export function requireObject(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, `${name} must be an object`, 'VALIDATION_ERROR', { field: name });
    }
    return value;
}

export function notFoundHandler(_req, res) {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

export function errorHandler(err, _req, res, _next) {
    const bodyParserError = err?.type === 'entity.parse.failed';
    const status = bodyParserError ? 400 : Number(err?.status || err?.statusCode || 500);
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const message = bodyParserError
        ? 'Malformed JSON body'
        : safeStatus >= 500
            ? 'Internal server error'
            : err.message || 'Request failed';
    const code = bodyParserError
        ? 'MALFORMED_JSON'
        : err?.code || (safeStatus >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');

    if (safeStatus >= 500) {
        console.error('[HTTP]', err);
    }

    const payload = { error: message, code };
    if (safeStatus < 500 && err?.details !== undefined) payload.details = err.details;
    res.status(safeStatus).json(payload);
}
