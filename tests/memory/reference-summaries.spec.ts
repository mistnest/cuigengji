import { test, expect } from '@playwright/test';
import {
  ensureChapterSummary,
  ensureCharacterSummary,
  ensureWorldBookEntrySummary,
  getCharacterSummary,
  getChapterSummary,
  getWorldBookEntrySummary,
} from '../../src/services/reference-summaries.js';

test.describe('Reference summaries', () => {
  test('generates and reuses world book entry summaries', () => {
    const first = ensureWorldBookEntrySummary({
      uid: 1,
      comment: '红岸基地',
      key: ['红岸'],
      content: '红岸基地是一个用于向宇宙发送信号的重要设施。'.repeat(20),
    });
    expect(first.changed).toBe(true);
    expect(first.entry.summary.length).toBeGreaterThan(0);
    expect(first.entry.summary.length).toBeLessThanOrEqual(263);

    const second = ensureWorldBookEntrySummary(first.entry);
    expect(second.changed).toBe(false);
    expect(getWorldBookEntrySummary(second.entry)).toBe(first.entry.summary);
  });

  test('updates character summary when source fields change', () => {
    const first = ensureCharacterSummary({
      spec: 'chara_card_v3',
      data: {
        name: '叶文洁',
        description: '天体物理学家。',
        personality: '冷静、克制。',
        scenario: '红岸基地。',
      },
    });
    const updated = ensureCharacterSummary({
      ...first.character,
      data: {
        ...first.character.data,
        description: '天体物理学家，曾在红岸基地工作。',
      },
    });

    expect(first.changed).toBe(true);
    expect(updated.changed).toBe(true);
    expect(getCharacterSummary(updated.character)).toContain('红岸基地');
  });

  test('generates chapter summary for distant chapter memory', () => {
    const first = ensureChapterSummary({
      id: 'c1',
      title: '第一章',
      content: '叶文洁在红岸基地听见风声，回想起漫长的过去。'.repeat(30),
      notes: '交代红岸基地。',
      plotPoints: ['叶文洁登场'],
    });

    expect(first.changed).toBe(true);
    expect(first.chapter.summary).toContain('第一章');
    expect(getChapterSummary(first.chapter)).toBe(first.chapter.summary);
  });
});
