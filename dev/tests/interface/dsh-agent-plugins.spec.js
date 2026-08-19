import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import CuigenjiNovelCompaction from '../../../electron/intelligence/agent/dsh/plugins/cuigenji-novel-compaction.mjs';
import { apply as applyKnowledgeTools } from '../../../electron/intelligence/agent/dsh/plugins/cuigenji-project-knowledge.mjs';
import { applyToolPolicy } from '../../../electron/intelligence/agent/dsh/plugins/cuigenji-tool-policy.mjs';

test('@interface DSH writing preset exposes only guarded read-only knowledge tools', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigenji-dsh-tools-'));
    const knowledgeFile = path.join(root, 'knowledge.json');
    const previousFile = process.env.CUIGENGJI_DSH_KNOWLEDGE_FILE;
    await fs.writeFile(knowledgeFile, JSON.stringify({
        entries: [
            {
                id: 'worldbook:star-port',
                kind: 'worldbook',
                name: '星港',
                source: 'workspace',
                summary: '实行永久宵禁。',
                keywords: ['宵禁'],
                data: { content: '钟声响起后不得离开室内。' },
            },
            {
                id: 'character:lin-dong',
                kind: 'character',
                name: '林冬',
                source: 'workspace',
                summary: '星港北门守卫。',
                keywords: ['守卫'],
                data: { description: '负责守卫星港北门。' },
            },
        ],
    }), 'utf8');
    process.env.CUIGENGJI_DSH_KNOWLEDGE_FILE = knowledgeFile;

    const definitions = new Map();
    let guard;
    const ctx = {
        effect: factory => factory(),
        tools: {
            register: definition => {
                definitions.set(definition.name, definition);
                return () => definitions.delete(definition.name);
            },
            guard: value => {
                guard = value;
                return () => {};
            },
            schemas: () => [...definitions.values()].map(definition => ({
                name: definition.name,
                description: definition.description,
                parameters: definition.parameters,
            })),
        },
    };

    try {
        applyKnowledgeTools(ctx);
        applyToolPolicy(ctx, { kind: 'test-agent' });
        expect([...definitions.keys()]).toEqual([
            'search_project_knowledge',
            'get_project_knowledge',
        ]);
        expect(guard({ name: 'search_project_knowledge' })).toBeUndefined();
        expect(guard({ name: 'pwsh' })).toContain('不允许工具');

        const search = await definitions.get('search_project_knowledge').execute({
            query: '星港',
            kind: 'all',
        });
        expect(search.results.map(item => item.name)).toEqual(expect.arrayContaining(['星港', '林冬']));
        const detail = await definitions.get('get_project_knowledge').execute({
            id: 'worldbook:star-port',
        });
        expect(detail).toMatchObject({ found: true, name: '星港' });
        expect(detail.content).toContain('钟声响起后不得离开室内');
        expect(JSON.stringify({ search, detail })).not.toContain(knowledgeFile);
    } finally {
        if (previousFile === undefined) delete process.env.CUIGENGJI_DSH_KNOWLEDGE_FILE;
        else process.env.CUIGENGJI_DSH_KNOWLEDGE_FILE = previousFile;
        await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test('@interface DSH tool policy fails closed when an unexpected tool is visible', () => {
    const definitions = new Map([
        ['search_project_knowledge', { name: 'search_project_knowledge' }],
        ['get_project_knowledge', { name: 'get_project_knowledge' }],
        ['pwsh', { name: 'pwsh' }],
    ]);
    const ctx = {
        tools: {
            schemas: () => [...definitions.values()],
            guard: () => {
                throw new Error('guard must not mount after a failed surface audit');
            },
        },
    };

    expect(() => applyToolPolicy(ctx, { kind: 'test-agent' })).toThrow(/pwsh/u);
});

test('@interface DSH compaction keeps the upstream mechanism and uses novel semantics', async () => {
    let request;
    const runtime = {
        config: {
            summarizationProvider: '',
            summarizationModel: '',
            maxTokens: 4_096,
        },
        ctx: {
            llm: {
                async *stream(options) {
                    request = options;
                    yield {
                        type: 'text-delta',
                        index: 0,
                        text: '## 用户当前意图\n- 续写第一章\n\n## 已确认的作品事实\n- 林冬是守卫',
                    };
                    yield { type: 'finish', reason: { kind: 'stop' } };
                },
            },
        },
    };
    const agent = {
        options: {},
        session: {
            id: 'session-1',
            requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-chat' } }),
        },
    };

    const result = await CuigenjiNovelCompaction.prototype.summarize.call(
        runtime,
        { system: 'system', tools: [], messages: [] },
        agent,
    );

    expect(request).toMatchObject({
        provider: 'deepseek-official',
        model: 'deepseek-chat',
        purpose: 'compaction',
        maxTokens: 4_096,
    });
    const instruction = request.messages.at(-1).content[0].text;
    expect(instruction).toContain('已确认的作品事实');
    expect(instruction).toContain('已讨论但未确认');
    expect(instruction).not.toContain('AI coding assistant');
    expect(result.summary[0].text).toContain('续写第一章');
    expect(result).toMatchObject({ llmStreamCall: true, provider: 'deepseek-official' });
});
