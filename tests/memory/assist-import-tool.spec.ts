import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from '../../src/config.js';
import { executeTool } from '../../src/services/chat-tools.js';

test.describe('Assist import_data tool', () => {
  const novelId = 'assist-import-tool-test';
  const root = path.join(getDataRoot(), 'novels', novelId);

  test.beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(path.join(root, 'assets'), { recursive: true });
    await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify({}, null, 2), 'utf8');
  });

  test.afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('imports generated character into project assets and workspace', async () => {
    const result = await executeTool('import_data', {
      target: 'character',
      data: {
        name: '测试角色',
        description: '负责验证设定工具落盘。',
        personality: '谨慎但行动快。',
      },
    }, novelId);

    expect(result.success).toBe(true);
    expect(result.target).toBe('character');
    expect(result.character.data.name).toBe('测试角色');

    const asset = JSON.parse(await fs.readFile(path.join(root, 'assets', 'characters', '测试角色.json'), 'utf8'));
    const workspace = JSON.parse(await fs.readFile(path.join(root, 'workspace.json'), 'utf8'));
    expect(asset.data.description).toContain('验证设定工具');
    expect(workspace.characters).toHaveLength(1);
    expect(workspace.characters[0].data.name).toBe('测试角色');
  });

  test('imports generated world book entries into project workspace', async () => {
    const result = await executeTool('import_data', {
      target: 'worldbook',
      data: [
        { comment: '测试地点', key: ['旧车站'], content: '旧车站是故事早期的重要地点。' },
        { comment: '测试组织', key: ['巡夜人'], content: '巡夜人负责处理夜间异常事件。' },
      ],
    }, novelId);

    expect(result.success).toBe(true);
    expect(result.entries_added).toBe(2);

    const workspace = JSON.parse(await fs.readFile(path.join(root, 'workspace.json'), 'utf8'));
    expect(Object.values(workspace.worldBook.entries).map((entry: any) => entry.comment)).toEqual([
      '测试地点',
      '测试组织',
    ]);
  });

  test('imports generated preset into project assets and workspace', async () => {
    const result = await executeTool('import_data', {
      target: 'preset',
      data: {
        name: '测试预设',
        provider: 'deepseek',
        model: 'deepseek-chat',
        temperature: 0.7,
      },
    }, novelId);

    expect(result.success).toBe(true);
    expect(result.preset.name).toBe('测试预设');

    const asset = JSON.parse(await fs.readFile(path.join(root, 'assets', 'presets', '测试预设.json'), 'utf8'));
    const workspace = JSON.parse(await fs.readFile(path.join(root, 'workspace.json'), 'utf8'));
    expect(asset.model).toBe('deepseek-chat');
    expect(workspace.presets['测试预设'].provider).toBe('deepseek');
  });
});
