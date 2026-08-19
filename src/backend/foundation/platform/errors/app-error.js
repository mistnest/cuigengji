export class AppError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'AppError';
        this.code = code || 'INTERNAL_ERROR';
        this.status = Number(options.status || 500);
        this.details = options.details;
        this.retryable = Boolean(options.retryable);
        this.publicMessage = options.publicMessage
            || (this.status < 500 ? message : '操作失败，请稍后重试。');
    }
}

export function isAppError(error) {
    return error instanceof AppError;
}
