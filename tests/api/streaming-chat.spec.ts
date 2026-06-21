import { test, expect } from '@playwright/test';
import { app } from '../../src/server.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from '../../src/config.js';

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

test('plan endpoint streams visible analysis chunks immediately', async () => {
  const { server, baseUrl } = await listen();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith(baseUrl)) return originalFetch(url, init);
    return new Response([
      'data: {"choices":[{"delta":{"content":"方案A："}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"先制造冲突。"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/chat/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '分析下一章怎么写。',
        history: [],
        context: { novelTitle: '测试小说', chapterTitle: '第一章' },
        config: {
          provider: 'custom',
          endpoint: 'http://local.test/v1',
          apiKey: 'test-key',
          model: 'fake-model',
        },
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('data: {"type":"chunk","content":"方案A："}');
    expect(text).toContain('data: {"type":"chunk","content":"先制造冲突。"}');
    expect(text).toContain('data: {"type":"done","reply":"方案A：先制造冲突。"}');
  } finally {
    globalThis.fetch = originalFetch;
    await close(server);
  }
});

test('assist chat streams tool calls and final visible text without waiting for a full JSON response', async () => {
  const { server, baseUrl } = await listen();
  const originalFetch = globalThis.fetch;
  const novelId = 'assist-stream-tool-test';
  const root = path.join(getDataRoot(), 'novels', novelId);
  let providerCalls = 0;

  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify({}, null, 2), 'utf8');

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith(baseUrl)) return originalFetch(url, init);
    providerCalls += 1;
    if (providerCalls === 1) {
      return new Response([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_import_1","type":"function","function":{"name":"import_data","arguments":"{\\\"target\\\":\\\"character\\\",\\\"data\\\":{\\\"name\\\":\\\"流式角色\\\""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":",\\\"description\\\":\\\"用于验证流式工具导入。\\\"}}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response([
      'data: {"choices":[{"delta":{"content":"已创建"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"流式角色。"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '创建一个测试角色并导入。',
        history: [],
        context: { novelId },
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
    const text = await response.text();
    expect(text).toContain('data: {"type":"tool_start"');
    expect(text).toContain('data: {"type":"tool_call","name":"import_data","target":"character"');
    expect(text).toContain('data: {"type":"tool_result","name":"import_data","result":{"success":true');
    expect(text).toContain('data: {"type":"chunk","content":"已创建"}');
    expect(text).toContain('data: {"type":"done","reply":"已创建流式角色。"}');

    const saved = JSON.parse(await fs.readFile(path.join(root, 'assets', 'characters', '流式角色.json'), 'utf8'));
    expect(saved.data.name).toBe('流式角色');
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
    await close(server);
  }
});
