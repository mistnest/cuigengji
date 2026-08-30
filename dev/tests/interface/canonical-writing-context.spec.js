import { expect, test } from '@playwright/test';

import {
    buildWritePromptFromPreset,
    normalizePresetTemplates,
} from '../../../src/legacy/http/services/preset-orchestrator.js';
import { shouldUseCompactReference } from '../../../src/legacy/http/services/context-orchestrator.js';
import { shouldEnableReferenceTools } from '../../../src/legacy/http/services/reference-tool-policy.js';

test('@interface writing automation uses one fixed context envelope', () => {
    const templates = [
        {
            identifier: 'worldInfoBefore',
            role: 'system',
            isMarker: true,
            content: '旧前置 marker 不得执行。',
        },
        {
            identifier: 'voice',
            name: '叙事声音',
            role: 'user',
            content: '依据 {{description}} 写作，并服务 {{user}}。',
        },
        {
            identifier: 'cgj-import-characterState',
            role: 'system',
            isMarker: true,
            content: '旧角色插槽不得执行。',
        },
    ];
    const normalized = normalizePresetTemplates(templates, [
        'worldInfoBefore', 'voice', 'cgj-import-characterState',
    ]);
    expect(normalized.map(item => item.identifier)).toEqual(['voice']);

    const result = buildWritePromptFromPreset({
        templates,
        promptOrder: ['worldInfoBefore', 'voice', 'cgj-import-characterState'],
        platformPrompt: '平台规则',
        imports: {
            worldSetting: { content: '统一世界规则' },
            characterState: { content: '统一人物状态' },
            plotHistory: { content: '统一远期前情' },
            recentPlot: { content: '统一近期正文' },
            worldInfoBefore: { content: '旧全文世界书不得进入' },
            charDescription: { content: '旧角色全文不得进入' },
        },
        currentMessage: '继续写。',
    });
    expect(result.debug).toMatchObject({
        injectionPolicy: 'cuigenji-canonical-v1',
        importedSlots: ['worldSetting', 'characterState', 'plotHistory', 'recentPlot'],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('旧前置 marker');
    expect(serialized).not.toContain('旧角色插槽');
    expect(serialized).not.toContain('旧全文世界书');
    expect(serialized).not.toContain('旧角色全文');
    expect(serialized).not.toContain('{{description}}');
    expect(serialized).toContain('[description 由催更姬统一上下文提供]');
    expect(serialized).toContain('作者');

    const messages = result.messages.map(item => item.content).join('\n');
    expect(messages.indexOf('统一世界规则')).toBeLessThan(messages.indexOf('叙事声音'));
    expect(messages.indexOf('统一人物状态')).toBeLessThan(messages.indexOf('叙事声音'));
    expect(messages.indexOf('叙事声音')).toBeLessThan(messages.indexOf('统一远期前情'));
    expect(messages.indexOf('统一远期前情')).toBeLessThan(messages.indexOf('统一近期正文'));
    expect(messages.indexOf('统一近期正文')).toBeLessThan(messages.indexOf('继续写'));
});

test('@interface legacy injection flags cannot select another runtime path', () => {
    expect(shouldUseCompactReference({ compactReference: false }, {
        referenceMode: 'sillytavern',
    })).toBe(true);
    expect(shouldEnableReferenceTools({
        provider: 'deepseek',
        referenceTools: false,
        enableReferenceTools: false,
    })).toBe(true);
    expect(shouldEnableReferenceTools({ provider: 'google' })).toBe(false);
});
