import { AppError } from '../errors/app-error.js';

export function requireString(value, name, options = {}) {
    const { allowEmpty = false, maxLength = 10000 } = options;
    if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
        throw new AppError('VALIDATION_ERROR', `${name} is required`, {
            status: 400,
            details: { field: name },
        });
    }
    if (value.length > maxLength) {
        throw new AppError('VALIDATION_ERROR', `${name} is too long`, {
            status: 400,
            details: { field: name, maxLength },
        });
    }
    return value;
}

export function requireObject(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AppError('VALIDATION_ERROR', `${name} must be an object`, {
            status: 400,
            details: { field: name },
        });
    }
    return value;
}
