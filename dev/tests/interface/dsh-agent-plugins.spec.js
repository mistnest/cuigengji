import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
    BUNDLED_SKILL_NAMES,
    buildDshAgentPluginEntries,
    LOCAL_DSH_PLUGIN_FILES,
} from '../../../electron/intelligence/agent/dsh/dsh-plugin-bundle.js';
import CuigenjiNovelCompaction from '../../../electron/intelligence/agent/dsh/plugins/cuigenji-novel-compaction.mjs';
import {
    apply as applyOutlineProposal,
    normalizeOutlineProposal,
    OUTLINE_PROPOSAL_MARKER,
} from '../../../electron/intelligence/agent/dsh/plugins/cuigenji-outline-proposal.mjs';
import { apply as applyKnowledgeTools } from '../../../electron/intelligence/agent/dsh/plugins/cuigenji-project-knowledge.mjs';
import { applyToolPolicy } from '../../../electron/intelligence/agent/dsh/plugins/cuigenji-tool-policy.mjs';
import {
    buildWritingContextPrompt,
} from '../../../electron/intelligence/agent/dsh/plugins/cuigenji-writing-context.mjs';

test('@interface DSH Agent has one canonical writing-context plugin boundary', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigenji-dsh-context-plugin-'));
    const contextFile = path.join(root, 'context.json');
    const previous = process.env.CUIGENGJI_DSH_CONTEXT_FILE;
    await fs.writeFile(contextFile, JSON.stringify({
        schemaVersion: 3,
        contextPolicy: {
            mode: 'canonical-writing-context',
            injection: 'cuigenji-canonical-v1',
        },
        promptText: '# 催更姬项目上下文\n作者预设、世界书和人物卡已归一化。',
    }), 'utf8');
    process.env.CUIGENGJI_DSH_CONTEXT_FILE = contextFile;
    try {
        const prompt = buildWritingContextPrompt({ webSearchMode: 'official-deepseek' });
        expect(prompt).toContain('# 催更姬小说创作 Agent');
        expect(prompt).toContain('# 催更姬项目上下文');
        expect(prompt).toContain('作者预设、世界书和人物卡已归一化');
        expect(prompt).toContain('可使用 web_search');
        expect(prompt.match(/# 催更姬项目上下文/gu)).toHaveLength(1);

        const entries = buildDshAgentPluginEntries({
            skillRoot: 'C:\\skills',
            webSearchEnabled: true,
            allowedToolNames: ['skill', 'web_search'],
        });
        expect(entries[0]).toMatchObject({
            id: 'cuigenji-writing-context',
            name: './cuigenji-writing-context.mjs',
            config: { webSearchMode: 'official-deepseek' },
        });
        expect(entries.some(entry => entry.id === 'persona')).toBe(false);
        expect(entries.some(entry => entry.id === 'tool-web')).toBe(true);
        expect(LOCAL_DSH_PLUGIN_FILES).toContain('cuigenji-writing-context.mjs');
        expect(LOCAL_DSH_PLUGIN_FILES).not.toContain('cuigenji-project-context.mjs');
        expect(BUNDLED_SKILL_NAMES).toContain('writing-single-agent');
    } finally {
        if (previous === undefined) delete process.env.CUIGENGJI_DSH_CONTEXT_FILE;
        else process.env.CUIGENGJI_DSH_CONTEXT_FILE = previous;
        await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});

test('@interface DSH can mount the local Novel Graph MCP over stdio', () => {
    const entries = buildDshAgentPluginEntries({
        skillRoot: '/tmp/cuigenji-skills',
        novelGraph: {
            enabled: true,
            command: process.execPath,
            args: ['/tmp/novel-graph/lib/bin.js'],
            cwd: '/tmp/novel-graph',
            env: { WRITING_NOVEL_GRAPH_DB: '/tmp/novel-graphs' },
        },
        allowedToolNames: [
            'mcp__novel_graph__search_nodes',
            'mcp__novel_graph__get_node',
            'mcp__novel_graph__list_edges',
            'mcp__novel_graph__get_edge',
            'mcp__novel_graph__commit_changes',
        ],
    });
    expect(entries).toContainEqual(expect.objectContaining({
        id: 'mcp-novel-graph',
        name: '@deepseek-ai/dsh-mcp-client',
        config: expect.objectContaining({
            serverName: 'novel_graph',
            transport: 'stdio',
            failOnStartupError: true,
        }),
    }));
});

test('@interface DSH can mount the authenticated writing project MCP namespace', () => {
    const entries = buildDshAgentPluginEntries({
        skillRoot: '/tmp/cuigenji-skills',
        writingProject: {
            enabled: true,
            command: process.execPath,
            args: ['/tmp/writing-project-mcp/src/bin.js'],
            cwd: '/tmp/writing-project-mcp',
            env: { WRITING_PROJECT_BRIDGE_URL: 'http://127.0.0.1:1234', WRITING_PROJECT_BRIDGE_TOKEN: 'test' },
        },
        allowedToolNames: ['search_project_knowledge', 'get_project_knowledge'],
    });
    expect(entries).toContainEqual(expect.objectContaining({
        id: 'mcp-writing-project',
        name: '@deepseek-ai/dsh-mcp-client',
        config: expect.objectContaining({ serverName: 'writing_project', transport: 'stdio' }),
    }));
    expect(entries.find(entry => entry.id === 'cuigenji-tool-policy').config.allowedToolPrefixes)
        .toContain('mcp__writing_project__');
});

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

test('@interface DSH tool policy accepts an exact configured skill surface', () => {
    const definitions = new Map([
        ['search_project_knowledge', { name: 'search_project_knowledge' }],
        ['get_project_knowledge', { name: 'get_project_knowledge' }],
        ['skill', { name: 'skill' }],
    ]);
    let guard;
    const ctx = {
        tools: {
            schemas: () => [...definitions.values()],
            guard: value => {
                guard = value;
                return () => {};
            },
        },
    };

    applyToolPolicy(ctx, { kind: 'test-agent' }, {
        allowedToolNames: [
            'search_project_knowledge',
            'get_project_knowledge',
            'skill',
        ],
    });

    expect(guard({ name: 'skill' })).toBeUndefined();
    expect(guard({ name: 'pwsh' })).toContain('不允许工具');
});

test('@interface DSH tool policy allows the guarded Novel Graph namespace to arrive asynchronously', () => {
    const definitions = new Map([
        ['search_project_knowledge', { name: 'search_project_knowledge' }],
        ['get_project_knowledge', { name: 'get_project_knowledge' }],
    ]);
    let guard;
    const ctx = {
        tools: {
            schemas: () => [...definitions.values()],
            guard: value => {
                guard = value;
                return () => {};
            },
        },
    };
    applyToolPolicy(ctx, { kind: 'test-agent' }, {
        allowedToolNames: ['search_project_knowledge', 'get_project_knowledge'],
        allowedToolPrefixes: ['mcp__novel_graph__'],
    });
    expect(guard({ name: 'mcp__novel_graph__commit_changes' })).toBeUndefined();
    expect(guard({ name: 'mcp__other__search' })).toContain('不允许工具');
});

test('@interface outline proposal tool validates and renders a side-effect-free proposal', async () => {
    const definitions = new Map();
    applyOutlineProposal({
        tools: {
            register(definition) {
                definitions.set(definition.name, definition);
                return () => definitions.delete(definition.name);
            },
        },
    });
    const definition = definitions.get('propose_outline_patch');
    const proposal = await definition.execute({
        baseRevision: 7,
        summary: '补上第一次阶段兑现',
        reason: '当前压力连续累积，缺少阶段回报。',
        operations: [
            { kind: 'create', ref: 'first_payoff', title: '第一次阶段兑现', type: 'plot' },
            { kind: 'delete', nodeId: 'obsolete-node' },
        ],
        impact: ['主角获得一次明确成果'],
        assumptions: ['兑现方式仍需用户确认'],
    });
    expect(proposal).toMatchObject({
        baseRevision: 7,
        summary: '补上第一次阶段兑现',
        hasDelete: true,
    });
    expect(proposal.proposalId).toMatch(/^[0-9a-f-]{36}$/u);
    const rendered = definition.output.render({}, proposal);
    expect(rendered[0].text).toContain(OUTLINE_PROPOSAL_MARKER);
    expect(rendered[0].text).toContain(proposal.proposalId);

    expect(() => normalizeOutlineProposal({
        baseRevision: 7,
        summary: '无效提案',
        reason: '缺少必要字段。',
        operations: [{ kind: 'create', ref: 'missing_title' }],
        impact: [],
        assumptions: [],
    })).toThrow(/title/u);
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
    expect(instruction).toContain('项目已存在事实');
    expect(instruction).toContain('本会话用户确认');
    expect(instruction).toContain('本会话偏好与否决');
    expect(instruction).toContain('外部资料');
    expect(instruction).toContain('大纲修改提案');
    expect(instruction).toContain('只能延续当前 session');
    expect(instruction).toContain('不等于已经修改项目');
    expect(instruction).not.toContain('AI coding assistant');
    expect(result.summary[0].text).toContain('续写第一章');
    expect(result).toMatchObject({ llmStreamCall: true, provider: 'deepseek-official' });
});
