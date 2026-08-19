import { randomUUID } from 'node:crypto';

import { DESKTOP_ERROR_CODES } from '../../../shared/desktop-api/core/errors.js';

const ERROR_CODE_MAP = Object.freeze({
    PROJECT_EXISTS: DESKTOP_ERROR_CODES.conflict,
    PROJECT_DELETING: DESKTOP_ERROR_CODES.conflict,
    DELETE_CONFIRMATION_REQUIRED: DESKTOP_ERROR_CODES.conflict,
    INVALID_PATH: DESKTOP_ERROR_CODES.validation,
    CORRUPT_JSON: DESKTOP_ERROR_CODES.dataCorrupt,
});

const STABLE_CODES = new Set(Object.values(DESKTOP_ERROR_CODES));

function stableErrorCode(error) {
    if (STABLE_CODES.has(error.code)) return error.code;
    return ERROR_CODE_MAP[error.code] || DESKTOP_ERROR_CODES.internal;
}

export function desktopSuccess(data, requestId = randomUUID()) {
    return {
        ok: true,
        data,
        requestId,
    };
}

export function desktopFailure(error, requestId = randomUUID()) {
    return {
        ok: false,
        error: {
            code: stableErrorCode(error),
            message: error.publicMessage || (Number(error.status) < 500
                ? error.message
                : '桌面端操作失败，请稍后重试。'),
            retryable: Boolean(error.retryable),
            ...(error.details ? { details: error.details } : {}),
        },
        requestId,
    };
}

export function permissionDenied() {
    return desktopFailure({
        code: DESKTOP_ERROR_CODES.permissionDenied,
        publicMessage: '当前页面无权调用此桌面接口。',
        retryable: false,
    });
}
