import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';

import iconv from 'iconv-lite';
import ipaddr from 'ipaddr.js';
import jschardet from 'jschardet';
import TurndownService from 'turndown';

import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'cuigenji-safe-web-fetch';
export const inject = ['tools'];

export const SAFE_WEB_FETCH_LIMITS = Object.freeze({
    maxRedirects: 5,
    maxResponseBytes: 2 * 1024 * 1024,
    maxOutputChars: 120_000,
    timeoutMs: 20_000,
});

const ALLOWED_CONTENT_TYPES = new Set([
    'text/html',
    'application/xhtml+xml',
    'text/plain',
    'application/json',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'safe_web_fetch',
        description: '读取一个公开 HTTP(S) 网页的有限文本内容。仅用于具体资料页面，不携带登录态，且会阻止本机、私网、危险重定向和非文本响应。',
        parameters: {
            url: {
                type: 'string',
                required: true,
                description: '需要读取的完整公开 HTTP(S) URL，通常来自 web_search 结果或用户明确提供的链接。',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    requestedUrl: { type: 'string', required: true },
                    finalUrl: { type: 'string', required: true },
                    status: { type: 'integer', required: true },
                    title: { type: 'string', required: true },
                    contentType: { type: 'string', required: true },
                    text: { type: 'string', required: true },
                    truncated: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: renderFetchResult(value),
            }],
        },
        timeoutMs: SAFE_WEB_FETCH_LIMITS.timeoutMs + 2_000,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            return fetchSafeWebPage(args.url, { signal: exec.signal });
        },
    }));
}

export async function fetchSafeWebPage(rawUrl, options = {}) {
    const limits = {
        ...SAFE_WEB_FETCH_LIMITS,
        ...(options.limits || {}),
    };
    const resolver = options.resolver || dnsLookup;
    const requestOnce = options.requestOnce || requestPinned;
    const requested = parseSafeUrl(rawUrl);
    let current = requested;

    for (let redirect = 0; redirect <= limits.maxRedirects; redirect += 1) {
        const target = await resolveSafeTarget(current, { resolver });
        const response = await requestOnce(target, {
            signal: options.signal,
            timeoutMs: limits.timeoutMs,
            maxResponseBytes: limits.maxResponseBytes,
        });
        if (!Buffer.isBuffer(response.body)) {
            throw safeFetchError('WEB_FETCH_INVALID_RESPONSE', '网页读取器返回了无效响应。');
        }
        if (response.body.length > limits.maxResponseBytes) {
            throw safeFetchError('WEB_FETCH_TOO_LARGE', '网页内容超过安全大小限制。');
        }

        const location = headerValue(response.headers, 'location');
        if (REDIRECT_STATUSES.has(response.status) && location) {
            if (redirect >= limits.maxRedirects) {
                throw safeFetchError('WEB_FETCH_TOO_MANY_REDIRECTS', '网页重定向次数过多。');
            }
            const next = parseSafeUrl(new URL(location, current).href);
            if (current.protocol === 'https:' && next.protocol === 'http:') {
                throw safeFetchError('WEB_FETCH_DOWNGRADE_BLOCKED', '网页重定向降低了连接安全级别，已阻止。');
            }
            current = next;
            continue;
        }

        const contentTypeHeader = headerValue(response.headers, 'content-type');
        const contentType = normalizeContentType(contentTypeHeader);
        if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
            throw safeFetchError(
                'WEB_FETCH_UNSUPPORTED_CONTENT',
                `网页内容类型不受支持：${contentType || '未声明'}`,
            );
        }
        const decoded = decodeBody(response.body, contentTypeHeader);
        const converted = contentType === 'text/html' || contentType === 'application/xhtml+xml'
            ? htmlToReadableText(decoded)
            : normalizeReadableText(decoded);
        const title = contentType === 'text/html' || contentType === 'application/xhtml+xml'
            ? extractHtmlTitle(decoded)
            : '';
        const truncated = converted.length > limits.maxOutputChars;
        return {
            requestedUrl: requested.href,
            finalUrl: current.href,
            status: Number(response.status || 0),
            title,
            contentType,
            text: truncated ? converted.slice(0, limits.maxOutputChars) : converted,
            truncated,
        };
    }
    throw safeFetchError('WEB_FETCH_TOO_MANY_REDIRECTS', '网页重定向次数过多。');
}

export async function resolveSafeTarget(rawUrl, { resolver = dnsLookup } = {}) {
    const url = rawUrl instanceof URL ? parseSafeUrl(rawUrl.href) : parseSafeUrl(rawUrl);
    const hostname = stripIpv6Brackets(url.hostname).toLocaleLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
        throw safeFetchError('WEB_FETCH_BLOCKED_URL', '该网页地址不允许访问。');
    }

    let records;
    const family = isIP(hostname);
    if (family) {
        records = [{ address: hostname, family }];
    } else {
        try {
            records = await resolver(hostname, { all: true, verbatim: true });
        } catch {
            throw safeFetchError('WEB_FETCH_DNS_FAILED', '无法解析网页域名。');
        }
    }
    if (!Array.isArray(records) || records.length === 0) {
        throw safeFetchError('WEB_FETCH_DNS_FAILED', '无法解析网页域名。');
    }
    const normalized = records.map(record => ({
        address: String(record?.address || ''),
        family: Number(record?.family || isIP(String(record?.address || ''))),
    }));
    if (normalized.some(record => !record.address || !isPublicNetworkAddress(record.address))) {
        throw safeFetchError('WEB_FETCH_BLOCKED_URL', '该网页地址解析到了非公网目标，已阻止。');
    }
    return {
        url,
        hostname,
        address: normalized[0].address,
        family: normalized[0].family,
    };
}

export function isPublicNetworkAddress(address) {
    try {
        let parsed = ipaddr.parse(String(address || ''));
        if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) {
            parsed = parsed.toIPv4Address();
        }
        return parsed.range() === 'unicast';
    } catch {
        return false;
    }
}

export function requestPinned(target, { signal, timeoutMs, maxResponseBytes } = {}) {
    const transport = target.url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(safeFetchError('WEB_FETCH_ABORTED', '网页读取已取消。'));
            return;
        }
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (error) reject(normalizeRequestError(error));
            else resolve(value);
        };
        const request = transport.request(buildPinnedRequestOptions(target), response => {
            const declaredLength = Number(response.headers['content-length'] || 0);
            if (declaredLength > maxResponseBytes) {
                response.destroy();
                finish(safeFetchError('WEB_FETCH_TOO_LARGE', '网页内容超过安全大小限制。'));
                return;
            }
            const chunks = [];
            let bytes = 0;
            response.on('data', chunk => {
                bytes += chunk.length;
                if (bytes > maxResponseBytes) {
                    response.destroy(safeFetchError('WEB_FETCH_TOO_LARGE', '网页内容超过安全大小限制。'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => finish(null, {
                status: Number(response.statusCode || 0),
                headers: response.headers,
                body: Buffer.concat(chunks),
            }));
            response.on('error', error => finish(error));
        });
        const timer = setTimeout(() => {
            request.destroy(safeFetchError('WEB_FETCH_TIMEOUT', '网页读取超时。'));
        }, timeoutMs);
        const onAbort = () => request.destroy(safeFetchError('WEB_FETCH_ABORTED', '网页读取已取消。'));
        signal?.addEventListener('abort', onAbort, { once: true });
        request.on('error', error => finish(error));
        request.end();
    });
}

export function buildPinnedRequestOptions(target) {
    const lookup = (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) {
            callback(null, [{ address: target.address, family: target.family }]);
        } else {
            callback(null, target.address, target.family);
        }
    };
    return {
        protocol: target.url.protocol,
        hostname: target.hostname,
        port: Number(target.url.port || (target.url.protocol === 'https:' ? 443 : 80)),
        path: `${target.url.pathname}${target.url.search}`,
        method: 'GET',
        agent: false,
        lookup,
        ...(target.url.protocol === 'https:' && !isIP(target.hostname)
            ? { servername: target.hostname }
            : {}),
        headers: {
            Accept: 'text/html, application/xhtml+xml, text/plain, application/json;q=0.8',
            'Accept-Encoding': 'identity',
            'User-Agent': 'Cuigengji-SafeFetch/0.1',
            Connection: 'close',
        },
    };
}

function parseSafeUrl(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 4_000) {
        throw safeFetchError('WEB_FETCH_INVALID_URL', '网页地址格式无效。');
    }
    let url;
    try {
        url = new URL(text);
    } catch {
        throw safeFetchError('WEB_FETCH_INVALID_URL', '网页地址格式无效。');
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
        throw safeFetchError('WEB_FETCH_INVALID_URL', '仅支持完整的 HTTP(S) 网页地址。');
    }
    if (url.username || url.password) {
        throw safeFetchError('WEB_FETCH_CREDENTIALS_BLOCKED', '网页地址不能包含用户名或密码。');
    }
    const allowedPort = url.protocol === 'https:' ? '443' : '80';
    if (url.port && url.port !== allowedPort) {
        throw safeFetchError('WEB_FETCH_PORT_BLOCKED', '网页地址使用了不允许的端口。');
    }
    url.hash = '';
    return url;
}

function headerValue(headers, name) {
    if (!headers || typeof headers !== 'object') return '';
    const value = headers[name] ?? headers[name.toLocaleLowerCase()];
    if (Array.isArray(value)) return String(value[0] || '');
    return String(value || '');
}

function normalizeContentType(value) {
    return String(value || '').split(';', 1)[0].trim().toLocaleLowerCase();
}

function decodeBody(body, contentTypeHeader) {
    const declared = /charset\s*=\s*["']?([^;"'\s]+)/iu.exec(String(contentTypeHeader || ''))?.[1];
    const detected = declared || jschardet.detect(body)?.encoding || 'utf-8';
    const encoding = iconv.encodingExists(detected) ? detected : 'utf-8';
    return iconv.decode(body, encoding);
}

function htmlToReadableText(html) {
    const cleaned = String(html || '')
        .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
        .replace(/<!--([\s\S]*?)-->/gu, '');
    try {
        const service = new TurndownService({
            headingStyle: 'atx',
            bulletListMarker: '-',
            codeBlockStyle: 'fenced',
        });
        service.remove(['script', 'style', 'noscript', 'template', 'svg']);
        return normalizeReadableText(service.turndown(cleaned));
    } catch {
        return normalizeReadableText(cleaned.replace(/<[^>]+>/gu, ' '));
    }
}

function extractHtmlTitle(html) {
    const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(String(html || ''));
    if (!match) return '';
    return decodeBasicEntities(match[1].replace(/<[^>]+>/gu, ' '))
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500);
}

function decodeBasicEntities(value) {
    const entities = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    };
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity) => {
        const normalized = entity.toLocaleLowerCase();
        if (normalized.startsWith('#')) {
            const codePoint = Number.parseInt(
                normalized.startsWith('#x') ? normalized.slice(2) : normalized.slice(1),
                normalized.startsWith('#x') ? 16 : 10,
            );
            return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
                ? String.fromCodePoint(codePoint)
                : match;
        }
        return entities[normalized] ?? match;
    });
}

function normalizeReadableText(value) {
    return String(value || '')
        .replace(/\0/gu, '')
        .replace(/\r\n?/gu, '\n')
        .replace(/[ \t]+\n/gu, '\n')
        .replace(/\n{4,}/gu, '\n\n\n')
        .trim();
}

function stripIpv6Brackets(value) {
    const text = String(value || '');
    return text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
}

function renderFetchResult(value) {
    const source = safeDisplayUrl(value.finalUrl);
    return [
        `来源: ${source || '公开网页'}`,
        `状态: ${value.status}`,
        value.title ? `标题: ${value.title}` : '',
        `内容类型: ${value.contentType}`,
        '',
        value.text,
        value.truncated ? '\n…（网页正文已按安全上限截断）' : '',
    ].filter((line, index, values) => line || (index > 0 && values[index - 1])).join('\n');
}

function safeDisplayUrl(rawUrl) {
    try {
        const url = new URL(String(rawUrl || ''));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
        const path = url.pathname === '/' ? '' : url.pathname;
        return `${url.protocol}//${url.hostname}${path}`.slice(0, 500);
    } catch {
        return '';
    }
}

function normalizeRequestError(error) {
    if (error?.code?.startsWith?.('WEB_FETCH_')) return error;
    return safeFetchError('WEB_FETCH_REQUEST_FAILED', '网页读取失败。');
}

function safeFetchError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
