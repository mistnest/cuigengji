/**
 * Novel AI Editor - Shared Config
 * 避免循环依赖的共享配置模块
 */
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');

export function getDataRoot() {
    return globalThis.DATA_ROOT || path.join(PROJECT_ROOT, 'data');
}
