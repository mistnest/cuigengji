import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const SUPPORTED_DSH_VERSION = '0.1.1-rc.2';
export const DSH_TRANSPORT_CONTRACT = 'legacy-apiproxy-v1';

// These packages are imported directly by 催更姬's preset plugins. A mixed
// wave can boot successfully and fail only on the first prompt/tool call, so
// they are verified before the child process is spawned.
export const DSH_PLUGIN_ABI_PACKAGES = Object.freeze([
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-scope',
    '@deepseek-ai/dsh-skill-filesystem',
    '@deepseek-ai/dsh-tool-skill',
    '@deepseek-ai/dsh-tool-web',
    '@deepseek-ai/dsh-tools',
]);

export function readInstalledDshVersion(packageName = '@deepseek-ai/dsh') {
    return require(`${packageName}/package.json`).version;
}

export function assertDshRuntimeCompatibility({
    readVersion = readInstalledDshVersion,
    supportedVersion = SUPPORTED_DSH_VERSION,
} = {}) {
    const versions = Object.fromEntries(DSH_PLUGIN_ABI_PACKAGES.map(packageName => [
        packageName,
        String(readVersion(packageName) || ''),
    ]));
    const mismatches = Object.entries(versions)
        .filter(([, version]) => version !== supportedVersion);
    if (mismatches.length > 0) {
        const details = mismatches
            .map(([packageName, version]) => `${packageName}@${version || 'missing'}`)
            .join(', ');
        throw new Error(
            `Unsupported mixed DeepSeek Harness runtime: expected ${supportedVersion}; ${details}`,
        );
    }
    return {
        version: supportedVersion,
        transport: DSH_TRANSPORT_CONTRACT,
        packages: versions,
    };
}

export function normalizeDshReadyUrl(value) {
    let url;
    try {
        url = new URL(String(value || ''));
    } catch {
        throw new Error('DeepSeek Harness printed an invalid ready URL');
    }
    if (url.protocol !== 'http:'
        || url.hostname !== '127.0.0.1'
        || !url.port
        || url.username
        || url.password
        || url.hash
        || (url.pathname !== '/' && url.pathname !== '')) {
        throw new Error('DeepSeek Harness ready URL is outside the supported loopback boundary');
    }
    if (url.search) {
        throw new Error(
            'DeepSeek Harness uses the unpublished authenticated Remote transport; '
            + 'this build supports the published 0.1.1-rc.2 API Proxy transport only',
        );
    }
    return url.origin;
}
