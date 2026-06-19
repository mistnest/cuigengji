import { test, expect } from '@playwright/test';
import { app } from '../../src/server.js';

function listen() {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

test('chat endpoint returns SSE events when config.stream is true', async () => {
  const { server, baseUrl } = await listen();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith(baseUrl)) return originalFetch(url, init);
    return new Response([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"stream"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Say hello.',
        history: [],
        context: {},
        config: {
          provider: 'custom',
          endpoint: 'http://local.test/v1',
          apiKey: 'test-key',
          model: 'fake-model',
          stream: true,
        },
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('data: {"type":"chunk","content":"Hello "}');
    expect(text).toContain('data: {"type":"chunk","content":"stream"}');
    expect(text).toContain('data: {"type":"done","reply":"Hello stream"}');
  } finally {
    globalThis.fetch = originalFetch;
    await close(server);
  }
});

test('chat endpoint forces SSE even when config.stream is false', async () => {
  const { server, baseUrl } = await listen();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith(baseUrl)) return originalFetch(url, init);
    return new Response([
      'data: {"choices":[{"delta":{"content":"Forced "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"stream"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Say hello.',
        history: [],
        context: {},
        config: {
          provider: 'custom',
          endpoint: 'http://local.test/v1',
          apiKey: 'test-key',
          model: 'fake-model',
          stream: false,
        },
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('data: {"type":"chunk","content":"Forced "}');
    expect(text).toContain('data: {"type":"done","reply":"Forced stream"}');
  } finally {
    globalThis.fetch = originalFetch;
    await close(server);
  }
});
