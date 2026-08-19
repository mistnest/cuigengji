'use strict';

const DESKTOP_API_VERSION = 1;

function createInvoke(ipcRenderer) {
    return async function invoke(channel, payload) {
        const result = await ipcRenderer.invoke(channel, payload);
        if (result?.ok === true) return result.data;

        const remoteError = result?.error || {};
        const error = new Error(remoteError.message || '桌面端操作失败，请稍后重试。');
        error.name = 'DesktopApiError';
        error.code = remoteError.code || 'INTERNAL_ERROR';
        error.retryable = Boolean(remoteError.retryable);
        error.details = remoteError.details;
        error.requestId = result?.requestId;
        throw error;
    };
}
