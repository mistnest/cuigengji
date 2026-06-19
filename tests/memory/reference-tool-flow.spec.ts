import { test, expect } from '@playwright/test';
import { buildWritingContext } from '../../src/services/context-orchestrator.js';
import { generateWriting } from '../../src/services/writing-service.js';

test('writing context injects reference tool instructions and definitions at the memory layer', async () => {
  const prompt = await buildWritingContext({
    message: 'Continue the scene.',
    context: {
      novelId: 'reference-tool-context-test',
      compactReference: true,
      currentText: 'The Beacon hums at the edge of the city.',
    },
    config: {
      provider: 'custom',
      endpoint: 'http://local.test/v1',
      apiKey: 'test-key',
      model: 'fake-model',
      compactReference: true,
      maxTokens: 128,
    },
  });

  expect(prompt.referenceTools.enabled).toBe(true);
  expect(prompt.tools.map(tool => tool.function.name)).toEqual([
    'search_reference',
    'get_reference_detail',
    'get_scene_context',
  ]);
  expect(prompt.systemPrompt).toContain('## 资料工具');
  expect(prompt.debug.tools.enabled).toBe(true);
});

test('writing service exposes reference tools to the model and feeds tool results back', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
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
              content: 'Final prose after reading reference tools.',
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

    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: 'Final prose after reading reference tools.',
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await generateWriting({
      message: 'Continue the scene.',
      context: {
        novelId: 'reference-tool-flow-test',
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
        maxTokens: 128,
      },
    });

    expect(result.reply).toBe('Final prose after reading reference tools.');
    expect(requests).toHaveLength(2);
    expect(requests[0].tools.map(tool => tool.function.name)).toEqual([
      'search_reference',
      'get_reference_detail',
      'get_scene_context',
    ]);
    expect(requests[0].tool_choice).toBe('auto');
    expect(requests[0].messages[0].content).toContain('## 资料工具');
    expect(requests[0].messages[0].content.match(/## 资料工具/g)).toHaveLength(1);
    expect(requests[1].tool_choice).toBe('auto');
    expect(requests[1].messages.some(message => message.role === 'tool' && message.name === 'search_reference')).toBe(true);
    expect(result.prompt.debug.tools.enabled).toBe(true);
    expect(result.prompt.debug.tools.trace[0].name).toBe('search_reference');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
