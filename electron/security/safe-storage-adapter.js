import { AppError } from '../../src/backend/foundation/platform/index.js';

export function createSafeStorageAdapter(safeStorage) {
    return {
        encrypt(value) {
            assertAvailable(safeStorage);
            return safeStorage.encryptString(String(value)).toString('base64');
        },
        decrypt(value) {
            assertAvailable(safeStorage);
            return safeStorage.decryptString(Buffer.from(String(value), 'base64'));
        },
    };
}

function assertAvailable(safeStorage) {
    if (safeStorage?.isEncryptionAvailable?.()) return;
    throw new AppError('SECURE_STORAGE_UNAVAILABLE', 'Electron safeStorage is unavailable', {
        status: 503,
        publicMessage: '系统安全存储当前不可用，无法读写 AI 密钥。',
    });
}
