import { DESKTOP_ERROR_CODES } from './errors.js';

export const DESKTOP_DTO_SCHEMA_VERSION = 1;

export function defineObjectSchema(name, fields = {}, options = {}) {
    const definitions = Object.freeze({ ...fields });
    return Object.freeze({
        name,
        parse(value) {
            const input = value == null && options.allowUndefined ? {} : value;
            if (!isPlainObject(input)) throw validationError(`${name} must be an object`);
            for (const [field, definition] of Object.entries(definitions)) {
                validateField(name, field, input[field], definition);
            }
            return input;
        },
    });
}

export function parseDesktopInput(schema, value) {
    return schema ? schema.parse(value) : value;
}

function validateField(schemaName, field, value, definition) {
    const settings = typeof definition === 'string' ? { type: definition } : definition;
    if (value == null || value === '') {
        if (settings.required) throw validationError(`${schemaName}.${field} is required`);
        return;
    }
    if (Array.isArray(settings.types)) {
        if (!settings.types.includes(typeof value)) {
            throw validationError(`${schemaName}.${field} has an invalid type`);
        }
        return;
    }
    if (settings.type === 'array') {
        if (!Array.isArray(value)) throw validationError(`${schemaName}.${field} must be an array`);
        return;
    }
    if (settings.type === 'object') {
        if (!isPlainObject(value)) throw validationError(`${schemaName}.${field} must be an object`);
        return;
    }
    if (typeof value !== settings.type) {
        throw validationError(`${schemaName}.${field} must be ${settings.type}`);
    }
    if (settings.type === 'string' && value.length > (settings.maxLength || 100_000)) {
        throw validationError(`${schemaName}.${field} is too long`);
    }
}

function validationError(message) {
    const error = new Error(message);
    error.code = DESKTOP_ERROR_CODES.validation;
    error.publicMessage = '桌面接口参数格式无效。';
    return error;
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
