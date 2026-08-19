import fs from 'node:fs/promises';

import { AppError } from '../../../foundation/platform/index.js';

const MAX_EXPORT_BYTES = 100 * 1024 * 1024;

export async function writeTextExport(targetPath, content) {
    const text = String(content ?? '');
    assertExportSize(Buffer.byteLength(text, 'utf8'));
    await fs.writeFile(targetPath, text, 'utf8');
    return { saved: true };
}

export async function writeJsonExport(targetPath, data) {
    let content;
    try {
        content = JSON.stringify(data, null, 2);
    } catch {
        throw new AppError('VALIDATION_ERROR', 'Export data is not serializable', {
            status: 400,
            publicMessage: '导出内容无法序列化。',
        });
    }
    return writeTextExport(targetPath, content);
}

function assertExportSize(bytes) {
    if (bytes > MAX_EXPORT_BYTES) {
        throw new AppError('VALIDATION_ERROR', 'Export exceeds 100MB limit', {
            status: 400,
            publicMessage: '单次导出内容不能超过 100MB。',
        });
    }
}
