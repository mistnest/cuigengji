import { scopeOf } from '@deepseek-ai/dsh-scope';

export const name = 'cuigenji-tool-policy';
export const inject = ['tools'];

const ALLOWED_TOOL_NAMES = [
    'search_project_knowledge',
    'get_project_knowledge',
];
const ALLOWED_TOOLS = new Set(ALLOWED_TOOL_NAMES);

export function applyToolPolicy(ctx, explicitScope) {
    const scope = explicitScope ?? scopeOf(ctx);
    if (scope === undefined) throw new Error('催更姬工具策略必须挂载在 Agent scope 内');
    const visible = ctx.tools.schemas(scope).map(tool => tool.name).sort();
    const expected = [...ALLOWED_TOOL_NAMES].sort();
    if (JSON.stringify(visible) !== JSON.stringify(expected)) {
        throw new Error(`催更姬工具面校验失败：${visible.join(', ') || '没有可用工具'}`);
    }
    ctx.tools.guard(execution => (
        ALLOWED_TOOLS.has(execution.name)
            ? undefined
            : `催更姬写作 preset 不允许工具 ${execution.name}`
    ));
}

export const apply = applyToolPolicy;
