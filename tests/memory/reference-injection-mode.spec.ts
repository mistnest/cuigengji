import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { buildWritingContext } from '../../src/services/context-orchestrator.js';
import { createMemoryManager } from '../../src/services/memory-manager.js';

const TEST_DATA_ROOT = path.resolve('data', 'novels');

const longWorldContent = 'FULL WORLD ENTRY DETAIL. '.repeat(40);
const longCharacterDescription = 'FULL CHARACTER DESCRIPTION. '.repeat(40);

function retrieveWorldContent(compactReference = false) {
  const memory = createMemoryManager({
    worldBook: {
      entries: {
        1: {
          uid: 1,
          comment: 'Cache Beacon',
          key: ['Beacon'],
          content: longWorldContent,
          constant: true,
          disable: false,
        },
      },
    },
    compactReference,
  });
  return memory.retrieve('Beacon')[0]?.content || '';
}

function retrieveCharacterContent(compactReference = false) {
  const memory = createMemoryManager({
    characters: [{
      data: {
        name: 'Ada',
        description: longCharacterDescription,
        personality: 'Precise',
      },
    }],
    compactReference,
  });
  return memory.retrieve('Ada enters the room.')[0]?.content || '';
}

function setupChapterProject(novelId: string, count = 10) {
  const root = path.join(TEST_DATA_ROOT, novelId);
  const chaptersDir = path.join(root, 'chapters');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(chaptersDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'novel.json'), JSON.stringify({ id: novelId, title: novelId }, null, 2));
  for (let i = 1; i <= count; i++) {
    fs.writeFileSync(path.join(chaptersDir, `chapter-${String(i).padStart(3, '0')}.json`), JSON.stringify({
      id: `ch-${i}`,
      title: `第${i}章`,
      order: i,
      type: 'chapter',
      content: `第${i}章全文内容。Anchor flow chapter ${i}.`,
      summary: `第${i}章摘要。`,
    }, null, 2));
  }
  return root;
}

test.describe('Reference injection mode', () => {
  test('keeps full reference text by default for imported presets', () => {
    expect(retrieveWorldContent()).toBe(longWorldContent);
    expect(retrieveCharacterContent()).toContain(longCharacterDescription);
  });

  test('uses compact summaries only when compactReference is enabled', () => {
    const worldContent = retrieveWorldContent(true);
    const characterContent = retrieveCharacterContent(true);

    expect(worldContent.length).toBeLessThan(longWorldContent.length);
    expect(worldContent).toContain('FULL WORLD ENTRY DETAIL');
    expect(characterContent.length).toBeLessThan(longCharacterDescription.length + 30);
    expect(characterContent).toContain('summary:');
  });

  test('does not inject disabled characters into writing context', async () => {
    const prompt = await buildWritingContext({
      message: 'Continue.',
      context: {
        novelId: 'disabled-character-context-test',
        currentText: 'Ada speaks. Bert speaks.',
        characters: [
          { data: { name: 'Ada', description: 'Visible character.' } },
          { data: { name: 'Bert', description: 'Disabled character.', enabled: false } },
        ],
      },
      config: { model: 'gpt-4o', maxTokens: 512 },
      promptTemplates: [],
      promptOrder: [],
    });

    expect(prompt.debug.referencedCounts.characters).toBe(1);
    const charContent = prompt.debug.layers.characterState.content;
    expect(charContent).toContain('Ada');
    // Bert's role card is disabled, but this should not imply the story entity cannot appear.
    expect(charContent).toContain('## 已禁用的角色卡');
    expect(charContent).toContain('Bert');
  });

  test('compact reference mode uses native character-state import and keeps role card examples out', async () => {
    const prompt = await buildWritingContext({
      message: 'Ada enters the archive.',
      context: {
        novelId: 'compact-reference-marker-test',
        compactReference: true,
        currentText: 'Ada enters the archive.',
        characters: [{
          data: {
            name: 'Ada',
            description: 'Ada is a precise archivist with a silver lantern.',
            first_mes: 'This is a long role-card opening message that should not be injected.',
            mes_example: 'This is a role-card dialogue example that should not be injected.',
          },
        }],
      },
      config: { model: 'gpt-4o', maxTokens: 512, compactReference: true },
      promptTemplates: [
        { identifier: 'charDescription', isMarker: true, markerId: 'charDescription' },
        { identifier: 'dialogueExamples', isMarker: true, markerId: 'dialogueExamples' },
      ],
      promptOrder: [],
    });

    const serialized = JSON.stringify(prompt.messages);
    expect(serialized).toContain('character_state_import');
    expect(serialized).not.toContain('char_description_import');
    expect(serialized).not.toContain('dialogue_examples_import');
    expect(serialized).not.toContain('role-card opening message');
    expect(serialized).toContain('Ada');
  });

  test('prompt history drops transient API errors and duplicate disconnected retries', async () => {
    const prompt = await buildWritingContext({
      message: 'Continue.',
      history: [
        { role: 'user', content: 'Ada goes to the door.' },
        { role: 'assistant', content: '❌ API key required' },
        { role: 'user', content: 'Ada goes to the door.' },
        { role: 'assistant', content: 'Valid reply.' },
      ],
      context: {
        novelId: 'history-cleanup-test',
        currentText: 'Ada waits.',
      },
      config: { model: 'gpt-4o', maxTokens: 512 },
      promptTemplates: [],
      promptOrder: [],
    });

    const historyMessages = prompt.messages.filter(message => ['user', 'assistant'].includes(message.role));
    const serialized = JSON.stringify(historyMessages);
    expect(serialized).not.toContain('API key required');
    expect(serialized.match(/Ada goes to the door/g)).toHaveLength(1);
    expect(serialized).toContain('Valid reply.');
  });

  test('native writing prompt orders preset after world and character reference layers', async () => {
    const novelId = 'native-prompt-order-test';
    const root = setupChapterProject(novelId, 6);
    fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify({
      worldBook: {
        entries: {
          beacon: {
            uid: 1,
            comment: 'Beacon',
            key: ['Beacon'],
            content: 'Beacon world summary with enough detail for injection.',
            constant: true,
            disable: false,
          },
        },
      },
      characters: [{
        data: {
          name: 'Ada',
          description: 'Ada character summary with enough detail for injection.',
        },
      }],
    }, null, 2));
    try {
      const prompt = await buildWritingContext({
        message: 'Continue.',
        context: {
          novelId,
          referenceMode: 'native',
          compactReference: true,
          currentText: 'Ada sees the Beacon.',
          chapterTitle: '第6章',
          chapterWindowAnchor: { title: '第3章', order: 3 },
          characters: [{ data: { name: 'Ada', description: 'Ada character summary with enough detail for injection.' } }],
        },
        config: { model: 'gpt-4o', maxTokens: 512, referenceMode: 'native', compactReference: true },
        promptTemplates: [
          { identifier: 'preset-user', name: 'Official preset body', role: 'user', content: 'OFFICIAL PRESET BODY' },
          { identifier: 'cgj-import-worldSetting', isMarker: true },
          { identifier: 'cgj-import-characterState', isMarker: true },
          { identifier: 'cgj-import-plotHistory', isMarker: true },
          { identifier: 'cgj-import-recentPlot', isMarker: true },
        ],
        promptOrder: [],
      });

      const names = prompt.messages.map(message => message.name || (String(message.content || '').includes('OFFICIAL PRESET BODY') ? 'preset_reference' : ''));
      expect(names.indexOf('world_setting_import')).toBeLessThan(names.indexOf('preset_reference'));
      expect(names.indexOf('character_state_import')).toBeLessThan(names.indexOf('preset_reference'));
      expect(names.indexOf('preset_reference')).toBeLessThan(names.indexOf('plot_history_import'));
      expect(names.filter(Boolean)).toEqual([
        'world_setting_import',
        'character_state_import',
        'preset_reference',
        'plot_history_import',
        'recent_plot_import',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('sillytavern markers stay on ST imports and do not fallback to native layers', async () => {
    const novelId = 'st-compatible-marker-test';
    const root = setupChapterProject(novelId, 1);
    fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify({
      worldBook: {
        entries: {
          beacon: {
            uid: 1,
            comment: 'Beacon',
            key: ['Beacon'],
            content: 'Beacon world info content with enough detail.',
            position: 0,
            constant: true,
            disable: false,
          },
        },
      },
    }, null, 2));
    try {
      const prompt = await buildWritingContext({
        message: 'Continue.',
        history: [
          { role: 'user', content: 'Previous user turn.' },
          { role: 'assistant', content: 'Previous assistant turn.' },
        ],
        context: {
          novelId,
          referenceMode: 'sillytavern',
          compactReference: false,
          currentText: 'Ada sees the Beacon.',
          characters: [{
            data: {
              name: 'Ada',
              description: 'Ada character description with enough detail.',
              personality: 'Precise and calm.',
              scenario: 'Ada is investigating the Beacon.',
              mes_example: '<START>\nAda: I will check the archive.',
            },
          }],
        },
        config: { model: 'gpt-4o', maxTokens: 512, referenceMode: 'sillytavern', compactReference: false },
        promptTemplates: [
          { identifier: 'worldInfoBefore' },
          { identifier: 'charDescription' },
          { identifier: 'charPersonality' },
          { identifier: 'scenario' },
          { identifier: 'dialogueExamples' },
          { identifier: 'chatHistory' },
        ],
        promptOrder: [],
      });

      const names = prompt.messages.map(message => message.name || '');
      expect(names).toContain('world_info_before_import');
      expect(names).toContain('char_description_import');
      expect(names).toContain('char_personality_import');
      expect(names).toContain('scenario_import');
      expect(names).toContain('dialogue_examples_import');
      expect(names).not.toContain('world_setting_import');
      expect(names).not.toContain('character_state_import');
      expect(names).not.toContain('plot_history_import');
      expect(names).not.toContain('recent_plot_import');

      const serialized = JSON.stringify(prompt.messages);
      expect(serialized).toContain('Previous user turn.');
      expect(serialized).toContain('Previous assistant turn.');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('chapter anchor splits distant summaries and recent full chapters', async () => {
    const novelId = 'chapter-anchor-split-test';
    const root = setupChapterProject(novelId, 10);
    try {
      const prompt = await buildWritingContext({
        message: 'Continue.',
        context: {
          novelId,
          referenceMode: 'native',
          compactReference: true,
          currentText: '当前正文结尾。',
          chapterTitle: '第10章',
          chapterWindowAnchor: { title: '第5章', order: 5 },
        },
        config: { model: 'gpt-4o', maxTokens: 512, referenceMode: 'native', compactReference: true },
        promptTemplates: [],
        promptOrder: [],
      });

      expect(prompt.debug.chapterScope.anchor?.title).toBe('第5章');
      expect(prompt.debug.chapterScope.current?.title).toBe('第10章');
      expect(prompt.debug.chapterScope.distant.map(item => item.title)).toEqual(['第1章', '第2章', '第3章', '第4章']);
      expect(prompt.debug.chapterScope.recent.map(item => item.title)).toEqual(['第5章', '第6章', '第7章', '第8章', '第9章', '第10章']);
      expect(prompt.debug.layers.plotHistory.content).toContain('第4章');
      expect(prompt.debug.layers.plotHistory.content).not.toContain('第5章');
      expect(prompt.debug.layers.recentPlot.content).toContain('第5章');
      expect(prompt.debug.layers.recentPlot.content).toContain('第9章');
      expect(prompt.debug.layers.recentPlot.content).not.toContain('第10章全文');
      expect(prompt.messages.at(-2)?.content).toContain('当前正文结尾。');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('writing history alternates current text snapshots with user-model interactions', async () => {
    const prompt = await buildWritingContext({
      message: '继续第三版。',
      history: [
        { role: 'user', content: '把气氛写冷一点。', currentTextSnapshot: '正文第一版。', chapterTitle: '第一章' },
        { role: 'assistant', content: '第一轮回复。' },
        { role: 'user', content: '我改了前半段，再加强冲突。', currentTextSnapshot: '正文第二版。', chapterTitle: '第一章' },
        { role: 'assistant', content: '第二轮回复。' },
      ],
      context: {
        novelId: 'history-snapshot-order-test',
        currentText: '正文第三版。',
        chapterTitle: '第一章',
      },
      config: { model: 'gpt-4o', maxTokens: 512 },
      promptTemplates: [],
      promptOrder: [],
    });

    const tail = prompt.messages.slice(-8).map(message => message.content);
    expect(tail[0]).toContain('正文第一版');
    expect(tail[1]).toContain('把气氛写冷一点');
    expect(tail[2]).toContain('第一轮回复');
    expect(tail[3]).toContain('正文第二版');
    expect(tail[4]).toContain('我改了前半段');
    expect(tail[5]).toContain('第二轮回复');
    expect(tail[6]).toContain('正文第三版');
    expect(tail[7]).toContain('继续第三版');
  });
});
