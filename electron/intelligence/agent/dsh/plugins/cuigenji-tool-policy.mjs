import { scopeOf } from '@deepseek-ai/dsh-scope';

export const name = 'cuigenji-tool-policy';
export const inject = ['tools'];

const DEFAULT_ALLOWED_TOOL_NAMES = Object.freeze([
    'search_project_knowledge',
    'get_project_knowledge',
]);

export function applyToolPolicy(ctx, explicitScope, config = {}) {
    const scope = explicitScope ?? scopeOf(ctx);
    if (scope === undefined) throw new Error('催更姬工具策略必须挂载在 Agent scope 内');
    const allowedToolNames = normalizeAllowedToolNames(config.allowedToolNames);
    const allowedTools = new Set(allowedToolNames);
    const visible = ctx.tools.schemas(scope).map(tool => tool.name).sort();
    const expected = [...allowedToolNames].sort();
    if (JSON.stringify(visible) !== JSON.stringify(expected)) {
        throw new Error(`催更姬工具面校验失败：${visible.join(', ') || '没有可用工具'}`);
    }
    ctx.tools.guard(execution => (
        allowedTools.has(execution.name)
            ? undefined
            : `催更姬写作 preset 不允许工具 ${execution.name}`
    ));
}

export function apply(ctx, config = {}) {
    return applyToolPolicy(ctx, undefined, config);
}

function normalizeAllowedToolNames(value) {
    const names = value === undefined ? DEFAULT_ALLOWED_TOOL_NAMES : value;
    if (!Array.isArray(names) || names.length === 0) {
        throw new Error('催更姬工具策略需要非空 allowedToolNames');
    }
    const normalized = names.map(name => String(name || '').trim());
    if (normalized.some(name => !/^[a-z][a-z0-9_]{0,79}$/u.test(name))) {
        throw new Error('催更姬工具策略包含无效工具名');
    }
    if (new Set(normalized).size !== normalized.length) {
        throw new Error('催更姬工具策略包含重复工具名');
    }
    return normalized;
}
