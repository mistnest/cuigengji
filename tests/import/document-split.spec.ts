import { expect, test } from '@playwright/test';
import { splitTextIntoChapters } from '../../src/endpoints/import.js';
import { ensureChapterSummary } from '../../src/services/reference-summaries.js';

test('document splitter only treats standalone chapter headings as chapters', () => {
  const text = [
    '第一章 火车站',
    '他抬头看见站牌。',
    '第一章的讲义用邮件形式发到各位的电子信箱，诺玛的声音回荡在餐厅中。',
    '这句话不是章节标题。',
    '',
    '第二章 风雨夜',
    '雨声压过了脚步声。',
  ].join('\n');

  const chapters = splitTextIntoChapters(text);
  expect(chapters.map(chapter => chapter.title)).toEqual(['第一章 火车站', '第二章 风雨夜']);
  expect(chapters[0].content).toContain('第一章的讲义');
});

test('chapter summary removes common imported download-site noise', () => {
  const chapter = ensureChapterSummary({
    title: '第一章',
    content: [
      '==========================================================',
      '更多精校小说尽在知轩藏书下载：http://www.zxcs8.com/',
      '路明非走进雨里。',
      '==========================================================',
    ].join('\n'),
  }).chapter;

  expect(chapter.summary).toContain('路明非走进雨里');
  expect(chapter.summary).not.toContain('知轩藏书');
  expect(chapter.summary).not.toContain('zxcs8');
});
