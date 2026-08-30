import { expect, test } from '@playwright/test';

import {
    apply as applySafeWebFetch,
    buildPinnedRequestOptions,
    fetchSafeWebPage,
    isPublicNetworkAddress,
    requestPinned,
    resolveSafeTarget,
} from '../../../electron/intelligence/agent/dsh/plugins/cuigenji-safe-web-fetch.mjs';

test('@interface Safe Web Fetch only accepts globally routable addresses', () => {
    expect(isPublicNetworkAddress('8.8.8.8')).toBe(true);
    expect(isPublicNetworkAddress('2606:4700:4700::1111')).toBe(true);
    for (const address of [
        '0.0.0.0',
        '10.0.0.1',
        '100.64.0.1',
        '127.0.0.1',
        '169.254.169.254',
        '172.16.0.1',
        '192.168.1.1',
        '192.0.2.1',
        '224.0.0.1',
        '::',
        '::1',
        '::ffff:127.0.0.1',
        'fc00::1',
        'fe80::1',
        'ff02::1',
        '2001:db8::1',
    ]) expect(isPublicNetworkAddress(address), address).toBe(false);
});

test('@interface Safe Web Fetch validates URL credentials, ports and every DNS answer', async () => {
    const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];
    await expect(resolveSafeTarget('https://example.com/path?q=1', { resolver: publicResolver }))
        .resolves.toMatchObject({
            hostname: 'example.com',
            address: '93.184.216.34',
            family: 4,
        });
    await expect(resolveSafeTarget('https://user:secret@example.com/', { resolver: publicResolver }))
        .rejects.toMatchObject({ code: 'WEB_FETCH_CREDENTIALS_BLOCKED' });
    await expect(resolveSafeTarget('https://example.com:8443/', { resolver: publicResolver }))
        .rejects.toMatchObject({ code: 'WEB_FETCH_PORT_BLOCKED' });
    await expect(resolveSafeTarget('http://localhost/', { resolver: publicResolver }))
        .rejects.toMatchObject({ code: 'WEB_FETCH_BLOCKED_URL' });
    await expect(resolveSafeTarget('https://mixed.example/', {
        resolver: async () => [
            { address: '93.184.216.34', family: 4 },
            { address: '10.0.0.8', family: 4 },
        ],
    })).rejects.toMatchObject({ code: 'WEB_FETCH_BLOCKED_URL' });
});

test('@interface Safe Web Fetch revalidates redirects and converts bounded HTML', async () => {
    const addresses = {
        'start.example': '93.184.216.34',
        'article.example': '93.184.216.35',
    };
    const calls = [];
    const result = await fetchSafeWebPage('https://start.example/', {
        resolver: async hostname => [{ address: addresses[hostname], family: 4 }],
        requestOnce: async target => {
            calls.push({ hostname: target.hostname, address: target.address });
            if (target.hostname === 'start.example') {
                return {
                    status: 302,
                    headers: { location: 'https://article.example/story' },
                    body: Buffer.alloc(0),
                };
            }
            return {
                status: 200,
                headers: { 'content-type': 'text/html; charset=utf-8' },
                body: Buffer.from([
                    '<html><head><title>县衙 &amp; 职位</title>',
                    '<style>.hidden{display:none}</style></head>',
                    '<body><h1>县衙职位</h1><script>stealSecret()</script><p>正文资料。</p></body></html>',
                ].join('')),
            };
        },
    });

    expect(calls).toEqual([
        { hostname: 'start.example', address: '93.184.216.34' },
        { hostname: 'article.example', address: '93.184.216.35' },
    ]);
    expect(result).toMatchObject({
        requestedUrl: 'https://start.example/',
        finalUrl: 'https://article.example/story',
        status: 200,
        title: '县衙 & 职位',
        contentType: 'text/html',
        truncated: false,
    });
    expect(result.text).toContain('县衙职位');
    expect(result.text).toContain('正文资料');
    expect(result.text).not.toContain('stealSecret');
    expect(result.text).not.toContain('display:none');
});

test('@interface Safe Web Fetch pins the validated IP and sends no ambient credentials', async () => {
    const target = {
        url: new URL('https://example.com/research?q=term'),
        hostname: 'example.com',
        address: '93.184.216.34',
        family: 4,
    };
    const options = buildPinnedRequestOptions(target);
    expect(options).toMatchObject({
        protocol: 'https:',
        hostname: 'example.com',
        port: 443,
        path: '/research?q=term',
        method: 'GET',
        agent: false,
        servername: 'example.com',
    });
    expect(Object.keys(options.headers).map(name => name.toLocaleLowerCase()))
        .not.toEqual(expect.arrayContaining(['cookie', 'authorization', 'referer']));

    const one = await new Promise((resolve, reject) => {
        options.lookup('example.com', {}, (error, address, family) => {
            if (error) reject(error);
            else resolve({ address, family });
        });
    });
    const all = await new Promise((resolve, reject) => {
        options.lookup('example.com', { all: true }, (error, records) => {
            if (error) reject(error);
            else resolve(records);
        });
    });
    expect(one).toEqual({ address: '93.184.216.34', family: 4 });
    expect(all).toEqual([{ address: '93.184.216.34', family: 4 }]);
    await expect(requestPinned(target, {
        signal: AbortSignal.abort(),
        timeoutMs: 1_000,
        maxResponseBytes: 1_024,
    })).rejects.toMatchObject({ code: 'WEB_FETCH_ABORTED' });
});

test('@interface Safe Web Fetch blocks private redirects, HTTPS downgrade and unsafe bodies', async () => {
    const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];
    await expect(fetchSafeWebPage('https://example.com/', {
        resolver: publicResolver,
        requestOnce: async () => ({
            status: 302,
            headers: { location: 'http://127.0.0.1/admin' },
            body: Buffer.alloc(0),
        }),
    })).rejects.toMatchObject({ code: 'WEB_FETCH_DOWNGRADE_BLOCKED' });

    await expect(fetchSafeWebPage('http://example.com/', {
        resolver: publicResolver,
        requestOnce: async () => ({
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
            body: Buffer.alloc(0),
        }),
    })).rejects.toMatchObject({ code: 'WEB_FETCH_BLOCKED_URL' });

    await expect(fetchSafeWebPage('https://example.com/archive.zip', {
        resolver: publicResolver,
        requestOnce: async () => ({
            status: 200,
            headers: { 'content-type': 'application/zip' },
            body: Buffer.from('not really a zip'),
        }),
    })).rejects.toMatchObject({ code: 'WEB_FETCH_UNSUPPORTED_CONTENT' });

    await expect(fetchSafeWebPage('https://example.com/large', {
        resolver: publicResolver,
        limits: { maxResponseBytes: 8 },
        requestOnce: async () => ({
            status: 200,
            headers: { 'content-type': 'text/plain' },
            body: Buffer.from('larger than eight bytes'),
        }),
    })).rejects.toMatchObject({ code: 'WEB_FETCH_TOO_LARGE' });
});

test('@interface Safe Web Fetch registers one read-only model tool', () => {
    const definitions = new Map();
    applySafeWebFetch({
        tools: {
            register(definition) {
                definitions.set(definition.name, definition);
                return () => definitions.delete(definition.name);
            },
        },
    });

    expect([...definitions.keys()]).toEqual(['safe_web_fetch']);
    expect(definitions.get('safe_web_fetch')).toMatchObject({
        name: 'safe_web_fetch',
        timeoutMs: 22_000,
    });
    const rendered = definitions.get('safe_web_fetch').output.render({}, {
        finalUrl: 'https://example.com/research?token=do-not-expose',
        status: 200,
        title: 'Research',
        contentType: 'text/plain',
        text: '公开内容',
        truncated: false,
    });
    expect(rendered[0].text).toContain('https://example.com/research');
    expect(rendered[0].text).not.toContain('token=do-not-expose');
});
