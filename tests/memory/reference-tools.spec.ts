import { test, expect } from '@playwright/test';
import { executeReferenceTool, getReferenceToolDefinitions } from '../../src/services/ai-tools/reference/index.js';

const runtime = {
  message: '请续写下一段',
  context: {
    novelId: '三体',
    chapterTitle: '第1章',
    currentText: '红岸基地里，叶文洁望着远方。',
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
      query: '红岸 基地',
      limit: 5,
    }, runtime);

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]).toHaveProperty('id');
    expect(result.results[0]).toHaveProperty('summary');
  });

  test('get_reference_detail reads details by id', async () => {
    const search = await executeReferenceTool('search_reference', {
      query: '红岸 基地',
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
    expect(scene.beforeText).toContain('红岸基地');
    expect(scene.currentRequest).toBe(runtime.message);
  });
});
