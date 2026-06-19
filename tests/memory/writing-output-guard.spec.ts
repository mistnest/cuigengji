import { test, expect } from '@playwright/test';
import { applyWritingOutputGuard, collectForbiddenTerms } from '../../src/services/writing-output-guard.js';

test('writing output guard removes forbidden-word self-correction leaked into prose', () => {
  const raw = [
    '<content>',
    '左晨看了一眼她被烫红的掌心，不易察觉地——不对，这个禁词不能用的。左晨看了她被烫红的掌心，没说话，从自己口袋里摸出一卷灰色的医用胶带扔过去。',
    '</content>',
  ].join('\n');

  const result = applyWritingOutputGuard(raw);

  expect(result.reply).not.toContain('不易察觉');
  expect(result.reply).not.toContain('禁词不能用');
  expect(result.reply).toContain('左晨看了她被烫红的掌心，没说话');
  expect(result.debug.changed).toBe(true);
  expect(result.debug.removedSelfCorrections).toBe(1);
});

test('writing output guard extracts forbidden terms from imported preset templates', () => {
  const terms = collectForbiddenTerms([{
    identifier: 'cgj-style-banned',
    name: '禁词表',
    content: [
      '下面这些词和句式，看见了就毙了喵，别用：',
      '- 不易察觉 / 难以察觉',
      '- 指节发白 / 睫毛颤动（用别的办法写紧张喵）',
    ].join('\n'),
  }]);

  expect(terms).toEqual(expect.arrayContaining(['不易察觉', '难以察觉', '指节发白', '睫毛颤动']));
});
