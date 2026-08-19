import { AppError, requireObject } from '../../../foundation/platform/index.js';
import {
    callAIText,
    detectNetworkProxy,
    fetchModelList,
    isLikelyNetworkProxyError,
} from './legacy-ai-client.js';
import { applyAiSecret, sanitizeAiConfig } from '../../../foundation/configuration/index.js';

export async function listProviderModels(input = {}) {
    const config = resolveProviderConfig(input);
    const models = await fetchModelList(config);
    return { models };
}

export async function testProviderConnection(input = {}) {
    const config = resolveProviderConfig(input);
    const runTest = candidate => callAIText(
        candidate,
        '简短回复。',
        '只回复“连接成功”。',
        { maxTokens: 512 },
    );
    try {
        const response = await runTest(config);
        return { success: true, response };
    } catch (error) {
        const mode = String(config.networkProxyMode || 'auto');
        if (mode !== 'auto' || config.networkProxyUrl || !isLikelyNetworkProxyError(error)) throw error;
        const detected = await detectNetworkProxy({ timeoutMs: 3500 });
        if (!detected?.proxyUrl) throw error;
        try {
            const response = await runTest({
                ...config,
                networkProxyMode: 'manual',
                networkProxyUrl: detected.proxyUrl,
            });
            return {
                success: true,
                response,
                detectedNetworkProxy: detected.proxyUrl,
                networkProxyStatus: `已自动识别代理 ${detected.proxyUrl}`,
            };
        } catch (retryError) {
            return {
                success: false,
                error: retryError.message,
                detectedNetworkProxy: detected.proxyUrl,
                networkProxyStatus: `已自动识别代理 ${detected.proxyUrl}，但模型服务返回错误`,
            };
        }
    }
}

export async function detectProviderProxy() {
    const detected = await detectNetworkProxy({ timeoutMs: 3500 });
    if (!detected?.proxyUrl) return { success: false, error: '未检测到可用的本机网络代理' };
    return { success: true, ...detected };
}

export function resolveProviderConfig(input = {}) {
    requireObject(input, 'input');
    requireObject(input.config, 'config');
    const safeConfig = sanitizeAiConfig(input.config);
    if (!safeConfig.provider) {
        throw new AppError('VALIDATION_ERROR', 'provider is required', { status: 400 });
    }
    return applyAiSecret(safeConfig, input.profile || input.presetName);
}
