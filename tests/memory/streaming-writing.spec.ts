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
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: 'Ready for final stream.',
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_ref_1',
              type: 'function',
              function: {
                name: 'search_reference',
                arguments: JSON.stringify({ query: 'Beacon', limit: 3 }),
              },
            }],
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(sse([
      JSON.stringify({ choices: [{ delta: { content: 'Tool-informed ' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'reply.' } }] }),
      '[DONE]',
    ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
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
    expect(requests).toHaveLength(3);
    expect(requests[0].tool_choice).toBe('auto');
    expect(requests[0].stream).toBeUndefined();
    expect(requests[1].tool_choice).toBe('auto');
    expect(requests[1].stream).toBeUndefined();
    expect(requests[2].tool_choice).toBe('none');
    expect(requests[2].stream).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
