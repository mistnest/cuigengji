import fs from 'node:fs/promises';
import path from 'node:path';

export const BUNDLED_SKILL_NAMES = Object.freeze([
    'writing-single-agent',
    'story-direction-probe',
    'character-motivation-review',
    'conflict-suspense-review',
    'pacing-payoff-review',
    'commercial-web-fiction-review',
    'author-feedback-interpretation',
]);

export const LOCAL_DSH_PLUGIN_FILES = Object.freeze([
    'cuigenji-writing-context.mjs',
    'cuigenji-project-knowledge.mjs',
    'cuigenji-safe-web-fetch.mjs',
    'cuigenji-outline-proposal.mjs',
    'cuigenji-tool-policy.mjs',
    'cuigenji-novel-compaction.mjs',
]);

/**
 * Compose the complete Agent feature set as DSH plugins.  The supervisor owns
 * process lifecycle only; adding/removing an Agent capability happens here.
 */
export function buildDshAgentPluginEntries({
    skillRoot,
    webSearchEnabled = false,
    allowedToolNames = [],
    novelGraph,
    writingProject,
} = {}) {
    const entries = [
        {
            id: 'cuigenji-writing-context',
            name: './cuigenji-writing-context.mjs',
            config: {
                webSearchMode: webSearchEnabled ? 'official-deepseek' : 'fetch-only',
            },
        },
        {
            id: 'cuigenji-project-knowledge',
            name: './cuigenji-project-knowledge.mjs',
        },
        ...(novelGraph?.enabled ? [{
            id: 'mcp-novel-graph',
            name: '@deepseek-ai/dsh-mcp-client',
            config: {
                serverName: 'novel_graph',
                transport: 'stdio',
                command: novelGraph.command,
                args: novelGraph.args,
                cwd: novelGraph.cwd,
                env: novelGraph.env,
                failOnStartupError: true,
            },
        }] : []),
        ...(writingProject?.enabled ? [{
            id: 'mcp-writing-project',
            name: '@deepseek-ai/dsh-mcp-client',
            config: {
                serverName: 'writing_project',
                transport: 'stdio',
                command: writingProject.command,
                args: writingProject.args,
                cwd: writingProject.cwd,
                env: writingProject.env,
                failOnStartupError: true,
            },
        }] : []),
        {
            id: 'skill-filesystem',
            name: '@deepseek-ai/dsh-skill-filesystem',
            config: {
                providerName: 'cuigenji-bundled',
                includeDefaultRoots: false,
                customSkillDirs: [skillRoot],
                watch: false,
            },
        },
        {
            id: 'tool-skill',
            name: '@deepseek-ai/dsh-tool-skill',
            config: {
                catalogDescriptionMaxLength: 240,
            },
        },
        ...(webSearchEnabled ? [{
            id: 'tool-web',
            name: '@deepseek-ai/dsh-tool-web',
            config: {
                search: true,
                fetch: false,
                searchMaxResults: 6,
                searchTimeoutMs: 60_000,
            },
        }] : []),
        {
            id: 'cuigenji-safe-web-fetch',
            name: './cuigenji-safe-web-fetch.mjs',
        },
        {
            id: 'cuigenji-outline-proposal',
            name: './cuigenji-outline-proposal.mjs',
        },
        {
            id: 'cuigenji-tool-policy',
            name: './cuigenji-tool-policy.mjs',
            config: {
                allowedToolNames,
                allowedToolPrefixes: [
                    ...(novelGraph?.enabled ? ['mcp__novel_graph__'] : []),
                    ...(writingProject?.enabled ? ['mcp__writing_project__'] : []),
                ],
            },
        },
        {
            id: 'compaction',
            name: 'cordis:group',
            group: true,
            isolate: {
                compaction: true,
                toolResultPruner: true,
            },
            config: [
                {
                    id: 'cuigenji-novel-compaction',
                    name: './cuigenji-novel-compaction.mjs',
                },
                {
                    id: 'command-compact',
                    name: '@deepseek-ai/dsh-command-compact',
                },
                {
                    id: 'tool-result-pruner',
                    name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
                    config: {
                        thresholdChars: 8_192,
                        headChars: 4_096,
                        tailChars: 1_024,
                    },
                },
            ],
        },
    ];
    return entries;
}

export async function readBundledDshPluginSources({ pluginRoot, moduleUrl }) {
    const sources = await Promise.all(LOCAL_DSH_PLUGIN_FILES.map(async file => [
        file,
        await fs.readFile(path.join(pluginRoot, file), 'utf8'),
    ]));
    const result = Object.fromEntries(sources);
    result['cuigenji-project-knowledge.mjs'] = result['cuigenji-project-knowledge.mjs']
        .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-tools')));
    result['cuigenji-safe-web-fetch.mjs'] = result['cuigenji-safe-web-fetch.mjs']
        .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-tools')))
        .replace("'iconv-lite'", JSON.stringify(moduleUrl('iconv-lite')))
        .replace("'ipaddr.js'", JSON.stringify(moduleUrl('ipaddr.js')))
        .replace("'jschardet'", JSON.stringify(moduleUrl('jschardet')))
        .replace("'turndown'", JSON.stringify(moduleUrl('turndown')));
    result['cuigenji-outline-proposal.mjs'] = result['cuigenji-outline-proposal.mjs']
        .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-tools')));
    result['cuigenji-tool-policy.mjs'] = result['cuigenji-tool-policy.mjs']
        .replace("'@deepseek-ai/dsh-scope'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-scope')));
    result['cuigenji-novel-compaction.mjs'] = result['cuigenji-novel-compaction.mjs']
        .replace("'@deepseek-ai/dsh-compaction-basic'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-compaction-basic')))
        .replace("'@deepseek-ai/dsh-llm'", JSON.stringify(moduleUrl('@deepseek-ai/dsh-llm')));
    return result;
}

export async function readBundledDshSkillSources({ skillSourceRoot }) {
    const entries = await Promise.all(BUNDLED_SKILL_NAMES.map(async skillName => [
        skillName,
        await fs.readFile(path.join(skillSourceRoot, skillName, 'SKILL.md'), 'utf8'),
    ]));
    return Object.fromEntries(entries);
}
