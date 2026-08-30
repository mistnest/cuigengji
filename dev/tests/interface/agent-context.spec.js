import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
    buildAgentProjectContextArtifacts,
} from '../../../src/backend/intelligence/agent/context/project-context-service.js';
import {
    createChapter,
    createProject,
    saveWorkspace,
} from '../../../src/backend/domains/project/index.js';

test('@interface Agent context injects the active preset and bounded references', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigenji-agent-context-'));
    globalThis.DATA_ROOT = dataRoot;
    try {
        const project = await createProject({ title: '上下文边界' });
        const chapter = await createChapter(project.id, {
            title: '星港夜班',
            content: '林冬在星港北门值守。',
        });
        await saveWorkspace(project.id, {
            presetName: '网文风格',
            promptTemplates: [
                {
                    identifier: 'voice',
                    name: '叙事声音',
                    role: 'system',
                    content: '用 {{char}} 的克制视角写作，模型是 {{model}}。',
                },
                {
                    identifier: 'disabled',
                    role: 'system',
                    enabled: false,
                    content: '不应进入活动规则。',
                },
                {
                    identifier: 'format',
                    role: 'user',
                    content: '每段保持短句。',
                },
            ],
            promptOrder: ['format', 'voice', 'disabled'],
            enabledTemplates: { format: true, voice: true, disabled: false },
            specialPrompts: { continueNudge: '继续推进冲突。' },
            formatStrings: { chapter: '章节正文' },
            aiConfig: { provider: 'openai', model: 'gpt-test', apiKey: 'should-not-leak' },
            worldBook: {
                entries: {
                    active: {
                        key: ['星港'],
                        comment: '星港规则',
                        content: '北门夜间宵禁。',
                        apiKey: 'reference-secret-should-not-leak',
                    },
                    disabled: { key: ['星港'], comment: '禁用规则', content: '不应注入。', disabled: true },
                },
            },
            characters: [
                {
                    data: {
                        name: '林冬',
                        description: '北门守卫。',
                        privateKey: 'character-secret-should-not-leak',
                    },
                },
                { data: { name: '未出场者', description: '不应热注入。' } },
            ],
            writingReference: {
                worldbookMode: 'all',
                characterMode: 'auto',
            },
        });

        const { context, knowledge } = await buildAgentProjectContextArtifacts({
            projectId: project.id,
            chapterId: chapter.id,
        });
        expect(context.writingPreset).toMatchObject({
            name: '网文风格',
            promptOrder: ['format', 'voice', 'disabled'],
        });
        expect(context.writingPreset.promptText).toContain('林冬');
        expect(context.writingPreset.promptText).toContain('每段保持短句');
        expect(context.writingPreset.promptText).not.toContain('不应进入活动规则');
        expect(context.writingPreset.promptText).not.toContain('should-not-leak');
        expect(context.relevantReferences.map(item => item.name)).toEqual(
            expect.arrayContaining(['星港规则', '林冬']),
        );
        expect(context.relevantReferences.map(item => item.name)).not.toContain('禁用规则');
        expect(context.knowledgeCatalog.map(item => item.name)).not.toContain('禁用规则');
        expect(JSON.stringify({ context, knowledge })).not.toContain('should-not-leak');
        expect(JSON.stringify({ context, knowledge })).not.toContain('reference-secret-should-not-leak');
        expect(JSON.stringify({ context, knowledge })).not.toContain('character-secret-should-not-leak');
        expect(context.collaboration.projectChangeSeq).toBeGreaterThan(0);
        expect(context.snapshotId).toMatch(/^[0-9a-f]{64}$/u);
    } finally {
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test('@interface Agent context honors explicit reference off/selected modes', async () => {
    const previousDataRoot = globalThis.DATA_ROOT;
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigenji-agent-reference-'));
    globalThis.DATA_ROOT = dataRoot;
    try {
        const project = await createProject({ title: '资料选择' });
        const chapter = await createChapter(project.id, {
            title: '开场', content: '甲在城中。',
        });
        await saveWorkspace(project.id, {
            worldBook: { entries: { one: { key: ['城'], comment: '城规', content: '城规内容。' } } },
            characters: [
                { data: { name: '甲', description: '已选角色。' } },
                { data: { name: '乙', description: '未选角色。' } },
            ],
            writingReference: {
                worldbookMode: 'off',
                characterMode: 'selected',
                selectedCharacters: ['乙'],
            },
        });
        const { context } = await buildAgentProjectContextArtifacts({
            projectId: project.id, chapterId: chapter.id,
        });
        expect(context.relevantReferences).toEqual([]);
        expect(context.knowledgeCatalog).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: '城规', active: false }),
            expect.objectContaining({ name: '甲', active: false }),
            expect.objectContaining({ name: '乙', active: true }),
        ]));
    } finally {
        globalThis.DATA_ROOT = previousDataRoot;
        await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
