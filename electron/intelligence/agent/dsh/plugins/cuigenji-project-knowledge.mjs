import fs from 'node:fs';

import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'cuigenji-project-knowledge';
export const inject = ['tools'];

const SEARCH_RESULT_LIMIT = 8;
const SEARCH_PREVIEW_CHARS = 1_200;
const DETAIL_CHARS = 32_000;

export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'search_project_knowledge',
        description: '在当前小说的热资料索引中搜索世界书和角色卡。Novel Graph 是完整资料的权威源；先搜索，再按需使用图谱工具读取详情。不得把未命中的内容当作项目事实。',
        parameters: {
            query: {
                type: 'string',
                required: true,
                description: '人物名、地点、组织、物件、设定词或要核对的短语。',
            },
            kind: {
                type: 'string',
                required: true,
                enum: ['all', 'worldbook', 'character'],
                description: '资料类型；不确定时使用 all。',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    query: { type: 'string', required: true },
                    results: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                id: { type: 'string', required: true },
                                kind: { type: 'string', required: true },
                                name: { type: 'string', required: true },
                                source: { type: 'string', required: true },
                                preview: { type: 'string', required: true },
                            },
                        },
                    },
                    omitted: { type: 'integer', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: JSON.stringify(value, null, 2),
            }],
        },
        async execute(args) {
            const query = String(args.query || '').trim().slice(0, 240);
            if (!query) throw new Error('query must be a non-empty string');
            const kind = ['all', 'worldbook', 'character'].includes(args.kind)
                ? args.kind
                : 'all';
            const entries = readKnowledge().entries.filter(entry => kind === 'all' || entry.kind === kind);
            const ranked = entries
                .map((entry, index) => ({ entry, index, score: scoreEntry(entry, query) }))
                .filter(item => item.score > 0)
                .sort((left, right) => right.score - left.score || left.index - right.index);
            const results = ranked.slice(0, SEARCH_RESULT_LIMIT).map(({ entry }) => ({
                id: entry.id,
                kind: entry.kind,
                name: entry.name,
                source: entry.source,
                preview: previewEntry(entry),
            }));
            return {
                query,
                results,
                omitted: Math.max(0, ranked.length - results.length),
            };
        },
        isConcurrencySafe: () => true,
    }));

    ctx.tools.register(defineTool({
        name: 'get_project_knowledge',
        description: '按 search_project_knowledge 返回的 id 读取热资料快照中的一条世界书或角色卡详情。需要完整正文或关系时使用 Novel Graph MCP；此工具只读。',
        parameters: {
            id: {
                type: 'string',
                required: true,
                description: 'search_project_knowledge 返回的精确资料 id。',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    found: { type: 'boolean', required: true },
                    id: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    name: { type: 'string', required: true },
                    source: { type: 'string', required: true },
                    content: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: value.found
                    ? `${value.kind}: ${value.name}\n来源: ${value.source}\n${value.content}`
                    : `未找到资料 id: ${value.id}`,
            }],
        },
        async execute(args) {
            const id = String(args.id || '').trim().slice(0, 240);
            if (!id) throw new Error('id must be a non-empty string');
            const entry = readKnowledge().entries.find(item => item.id === id);
            if (!entry) return {
                found: false,
                id,
                kind: '',
                name: '',
                source: '',
                content: '',
            };
            return {
                found: true,
                id: entry.id,
                kind: entry.kind,
                name: entry.name,
                source: entry.source,
                content: truncate(JSON.stringify(entry.data, null, 2), DETAIL_CHARS),
            };
        },
        isConcurrencySafe: () => true,
    }));

}

function readKnowledge() {
    const file = process.env.CUIGENGJI_DSH_KNOWLEDGE_FILE;
    if (!file) return { entries: [] };
    try {
        const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(snapshot.entries) ? snapshot : { entries: [] };
    } catch {
        return { entries: [] };
    }
}

function scoreEntry(entry, query) {
    const normalized = query.toLocaleLowerCase();
    const tokens = [...new Set(normalized.split(/\s+/u).filter(Boolean))];
    const name = String(entry.name || '').toLocaleLowerCase();
    const keywords = (entry.keywords || []).map(value => String(value).toLocaleLowerCase());
    const summary = String(entry.summary || '').toLocaleLowerCase();
    const serialized = JSON.stringify(entry.data || '').toLocaleLowerCase();
    let score = name.includes(normalized) ? 120 : 0;
    if (keywords.some(keyword => keyword.includes(normalized) || normalized.includes(keyword))) score += 80;
    if (summary.includes(normalized)) score += 40;
    if (serialized.includes(normalized)) score += 10;
    for (const token of tokens) {
        if (token.length < 2) continue;
        if (name.includes(token)) score += 30;
        if (keywords.some(keyword => keyword.includes(token))) score += 20;
        if (summary.includes(token)) score += 10;
    }
    return score;
}

function previewEntry(entry) {
    const summary = String(entry.summary || '').trim();
    if (summary) return truncate(summary, SEARCH_PREVIEW_CHARS);
    return truncate(JSON.stringify(entry.data), SEARCH_PREVIEW_CHARS);
}

function truncate(value, maxChars) {
    const text = String(value || '');
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n…（资料已截断）`;
}
