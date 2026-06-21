import { test, expect } from '@playwright/test';
import { executeReferenceTool, getReferenceToolDefinitions } from '../../src/services/ai-tools/reference/index.js';

const runtime = {
  message: '继续写下一段',
  context: {
    novelId: 'sample-novel',
    chapterTitle: '第1章',
    currentText: '旧档案室里，主角望着窗外，等待下一条线索出现。',
  },
};

test.describe('Reference AI tools', () => {
  test('exposes the three reference tool definitions', () => {
    const names = getReferenceToolDefinitions().map(tool => tool.function.name);
    expect(names).toEqual([
      'search_reference',
      'get_reference_detail',
      'get_scene_context',
    ]);
  });

  test('search_reference returns compact project references', async () => {
    const result = await executeReferenceTool('search_reference', {
      query: '档案室 线索',
      limit: 5,
    }, runtime);

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]).toHaveProperty('id');
    expect(result.results[0]).toHaveProperty('summary');
  });

  test('get_reference_detail reads details by id', async () => {
    const search = await executeReferenceTool('search_reference', {
      query: '档案室 线索',
      limit: 5,
    }, runtime);
    const id = search.results[0].id;
    const detail = await executeReferenceTool('get_reference_detail', {
      id,
      maxTokens: 300,
    }, runtime);

    expect(detail.id).toBe(id);
    expect(detail.content.length).toBeGreaterThan(0);
  });

  test('get_scene_context returns current writing scene privately for debug/tool use', async () => {
    const scene = await executeReferenceTool('get_scene_context', {
      beforeChars: 500,
      includeOutline: true,
      includeRecentSummary: true,
    }, runtime);

    expect(scene.type).toBe('scene');
    expect(scene.beforeText).toContain('旧档案室');
    expect(scene.currentRequest).toBe(runtime.message);
  });
});
