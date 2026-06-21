import { test, expect } from '@playwright/test';
import {
  applyAiReferenceSummary,
  ensureChapterSummary,
  ensureCharacterSummary,
  ensureWorldBookEntrySummary,
  getCharacterSummary,
  getChapterSummary,
  getWorldBookEntrySummary,
} from '../../src/services/reference-summaries.js';

test.describe('Reference summaries', () => {
  test('does not create local fallback summaries by default', () => {
    const world = ensureWorldBookEntrySummary({
      uid: 1,
      comment: '红岸基地',
      key: ['红岸'],
      content: '红岸基地是一处重要设施。'.repeat(20),
    });
    const character = ensureCharacterSummary({
      spec: 'chara_card_v3',
      data: {
        name: '叶文洁',
        description: '天体物理学家。',
        scenario: '红岸基地。',
      },
    });
    const chapter = ensureChapterSummary({
      id: 'c1',
      title: '第一章',
      content: '叶文洁在红岸基地听见风声。'.repeat(30),
    });

    expect(world.changed).toBe(false);
    expect(character.changed).toBe(false);
    expect(chapter.changed).toBe(false);
    expect(getWorldBookEntrySummary(world.entry)).toBe('');
    expect(getCharacterSummary(character.character)).toBe('');
    expect(getChapterSummary(chapter.chapter)).toBe('');
  });

  test('stores and reads AI summaries through the unified summary layer', () => {
    const world = applyAiReferenceSummary('worldBook', {
      uid: 1,
      comment: '红岸基地',
      key: ['红岸'],
      content: '红岸基地是一处重要设施。'.repeat(20),
    }, { brief: '红岸基地用于执行重要观测和通信任务。' });

    const character = applyAiReferenceSummary('character', {
      name: '叶文洁',
      description: '天体物理学家。',
      scenario: '红岸基地。',
    }, { brief: '叶文洁是曾在红岸基地工作的天体物理学家。' });

    const chapter = applyAiReferenceSummary('chapter', {
      id: 'c1',
      title: '第一章',
      content: '叶文洁在红岸基地听见风声。'.repeat(30),
    }, {
      brief: '叶文洁在红岸基地活动，相关经历成为后续剧情记忆点。',
      keyEvents: ['叶文洁出场'],
      characters: ['叶文洁'],
    });

    expect(world.changed).toBe(true);
    expect(character.changed).toBe(true);
    expect(chapter.changed).toBe(true);
    expect(world.item.summaryGenerator).toBe('ai-v1');
    expect(character.item.extensions.cuigengji.summaryGenerator).toBe('ai-v1');
    expect(chapter.item.summaryGenerator).toBe('ai-v1');
    expect(getWorldBookEntrySummary(world.item)).toContain('红岸基地');
    expect(getCharacterSummary(character.item)).toContain('叶文洁');
    expect(getChapterSummary(chapter.item)).toContain('红岸基地');
  });
});
