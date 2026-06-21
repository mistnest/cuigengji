import { test, expect } from '@playwright/test';
import { generateWritingStream } from '../../src/services/writing-service.js';

function sse(chunks) {
  return chunks.map(chunk => `data: ${chunk}\n\n`).join('');
}

test('writing service streams OpenAI-compatible chunks and reasoning separately', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];

  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    requests.push(body);
    return new Response(sse([
      JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking...' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'world' } }] }),
      '[DONE]',
    ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const result = await generateWritingStream({
      message: 'Continue.',
      context: { novelId: 'streaming-writing-test', currentText: 'Start.' },
      config: {
        provider: 'custom',
        endpoint: 'http://local.test/v1',
        apiKey: 'test-key',
        model: 'fake-model',
        stream: true,
        maxTokens: 128,
      },
      onEvent: event => events.push(event),
    });

    expect(result.reply).toBe('Hello world');
    expect(events).toEqual([
      { type: 'reasoning', content: 'thinking...' },
      { type: 'chunk', content: 'Hello ' },
      { type: 'chunk', content: 'world' },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].stream).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('writing stream waits for reference tools before emitting final chunks', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  let autoCalls = 0;

  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    requests.push(body);

    if (body.tool_choice === 'auto') {
      autoCalls += 1;
      if (autoCalls > 1) {
        return new Response(sse([
          JSON.stringify({ choices: [{ delta: { content: 'Tool-informed ' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'reply.' } }] }),
          '[DONE]',
        ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }

      return new Response(sse([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_ref_1', type: 'function', function: { name: 'search_reference', arguments: '{"query":"Beacon"' } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ',"limit":3}' } }] } }] }),
        '[DONE]',
      ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }

    throw new Error('Unexpected non-tool streaming request');
  };

  try {
    const result = await generateWritingStream({
      message: 'Continue the scene.',
      context: {
        novelId: 'streaming-reference-tool-test',
        compactReference: true,
        currentText: 'The Beacon hums at the edge of the city.',
        worldBookEntries: [{
          name: 'Beacon',
          content: 'The Beacon is a memory tower used to preserve city history.',
        }],
      },
      config: {
        provider: 'custom',
        endpoint: 'http://local.test/v1',
        apiKey: 'test-key',
        model: 'fake-model',
        compactReference: true,
        stream: true,
        maxTokens: 128,
      },
      onEvent: event => events.push(event),
    });

    expect(result.reply).toBe('Tool-informed reply.');
    expect(events).toEqual([
      { type: 'chunk', content: 'Tool-informed ' },
      { type: 'chunk', content: 'reply.' },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[0].tool_choice).toBe('auto');
    expect(requests[0].stream).toBe(true);
    expect(requests[1].tool_choice).toBe('auto');
    expect(requests[1].stream).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('writing stream emits normal first-round chunks immediately when no tool is requested', async () => {
  const originalFetch = globalThis.fetch;
  const events = [];

  globalThis.fetch = async () => new Response(sse([
    JSON.stringify({ choices: [{ delta: { content: '第一段正常正文，' } }] }),
    JSON.stringify({ choices: [{ delta: { content: '应该立刻显示。' } }] }),
    '[DONE]',
  ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

  try {
    const result = await generateWritingStream({
      message: '继续。',
      context: {
        novelId: 'streaming-no-tool-first-round-test',
        compactReference: true,
        currentText: '上一句。',
        worldBookEntries: [{ name: '灯塔', content: '灯塔摘要。' }],
      },
      config: {
        provider: 'custom',
        endpoint: 'http://local.test/v1',
        apiKey: 'test-key',
        model: 'fake-model',
        compactReference: true,
        stream: true,
        maxTokens: 128,
      },
      onEvent: event => events.push(event),
    });

    expect(result.reply).toBe('第一段正常正文，应该立刻显示。');
    expect(events).toEqual([
      { type: 'chunk', content: '第一段正常正文，' },
      { type: 'chunk', content: '应该立刻显示。' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('writing stream converts DSML pseudo tool calls into real reference tool calls without leaking them', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  let calls = 0;

  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    requests.push(body);
    calls += 1;

    if (calls === 1) {
      return new Response(sse([
        JSON.stringify({
          choices: [{
            delta: {
              content: '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="get_reference_detail">\n<｜｜DSML｜｜parameter name="id" string="true">character:封不觉</｜｜DSML｜｜parameter>\n<｜｜DSML｜｜parameter name="maxTokens" string="false">800</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>',
            },
          }],
        }),
        '[DONE]',
      ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }

    return new Response(sse([
      JSON.stringify({ choices: [{ delta: { content: '封不觉抬手扣住管钳，笑着向老朋友打了个招呼。' } }] }),
      '[DONE]',
    ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const result = await generateWritingStream({
      message: '封不觉遇到老朋友，利用自己的装备和他简单交手',
      context: {
        novelId: 'streaming-pseudo-tool-test',
        compactReference: true,
        currentText: '紫禁之巅的屋脊在夜色里延伸。',
      },
      config: {
        provider: 'custom',
        endpoint: 'http://local.test/v1',
        apiKey: 'test-key',
        model: 'fake-model',
        compactReference: true,
        stream: true,
        maxTokens: 128,
      },
      onEvent: event => events.push(event),
    });

    expect(result.reply).toBe('封不觉抬手扣住管钳，笑着向老朋友打了个招呼。');
    expect(events).toEqual([
      { type: 'chunk', content: '封不觉抬手扣住管钳，笑着向老朋友打了个招呼。' },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.some(message => message.role === 'tool' && message.name === 'get_reference_detail')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('DSML');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
