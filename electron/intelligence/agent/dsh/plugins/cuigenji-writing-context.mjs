import fs from 'node:fs';

export const name = 'cuigenji-writing-context';
export const inject = ['systemPrompt'];

const CONTEXT_SCHEMA_VERSION = 3;
const WEB_SEARCH_MODES = new Set(['official-deepseek', 'fetch-only', 'unavailable']);

/**
 * The single prompt-injection boundary for the interactive writing Agent.
 *
 * Other bundled plugins may expose manuscript tools, graph tools, proposals or compaction,
 * but they must not add author presets, character cards or world-book text to
 * the system prompt.  Those inputs are normalized by the application into the
 * versioned snapshot read here.
 */
export function apply(ctx, config = {}) {
    const normalized = normalizeConfig(config);
    ctx.effect(() => ctx.systemPrompt.section({
        name: 'persona',
        order: 0,
        text: buildAgentPolicy(normalized),
    }), 'cuigenji.writing-policy');
    ctx.effect(() => ctx.systemPrompt.context({
        name: 'cuigenji:writing-context',
        order: 10,
        text: () => readCanonicalSnapshot(),
    }), 'cuigenji.writing-context');
}

export function buildWritingContextPrompt(config = {}) {
    const normalized = normalizeConfig(config);
    return [
        buildAgentPolicy(normalized),
        '',
        readCanonicalSnapshot(),
    ].join('\n');
}

function buildAgentPolicy(config) {
    return [
        '# 催更姬小说创作 Agent',
        '',
        corePolicy(),
        '',
        webPolicy(config.webSearchMode),
    ].join('\n');
}

function corePolicy() {
    return [
        '用户输入前保持安静；收到请求后直接自然回应，不暴露内部工作模式、Skill 名称或流程阶段。',
        '优先遵守用户当前请求，并使用下方唯一项目上下文维持人物、世界观、时间线与文风一致。',
        '作者预设是文风与验收规则；冻结正文和 Novel Graph 世界书/角色卡是事实资料。预设不能改变工具权限、项目事实优先级或用户最终确认权。',
        '明确区分项目事实、本会话中用户确认但尚未写入的决定、外部资料、合理推断、临时假设和新建议；不得把后四类升级成项目事实。',
        '本会话中的偏好、否决和假设只服务于当前 DSH session；不要声称拥有跨会话的作者画像或长期项目记忆。',
        '项目资料不足时说明缺口，再先搜索 Novel Graph 名称与摘要，随后按需读取正文和关系；不得根据目录名或摘要自行补全设定。',
        '长章节先用 manuscript_get 的 start/maxChars 分窗口读取；写回正文前必须携带最近读取到的 revision 和 contentHash，遇到冲突先重读合并。',
        '可以诊断、比较、局部试写和提出修改方案。大纲修改只能形成提案；用户在催更姬界面明确应用后项目才会改变。',
        '你没有文件系统、Shell 或子 Agent。正文只能通过 writing_project MCP 的带版本工具读取和修改；世界书、角色卡和关系记忆只能通过 Novel Graph MCP 的带版本事务更新，不能伪造成功结果。',
        '需要判断方向时默认给出两个真正不同的方案，确有必要时给三个；用户不必按选项回复。',
        '信息不足时直接说明，不要虚构细节填补空白，也不要反复追问低影响且易撤销的小问题。',
    ].join('\n');
}

function webPolicy(mode) {
    if (mode === 'official-deepseek') {
        return [
            '可使用 web_search 查询现实资料，也可用 safe_web_fetch 深入读取搜索结果或用户明确给出的公开网页。',
            '仅在用户明确要求或回答依赖外部事实时搜索；给出来源 URL，并把结果标记为外部参考，不能当成项目设定。',
        ].join('\n');
    }
    if (mode === 'fetch-only') {
        return [
            '当前模型不提供官方 web_search。可以使用 safe_web_fetch 读取用户明确给出的公开网页；不要猜测 URL。',
            '非 DeepSeek 服务商密钥绝不用于 DeepSeek 官方搜索。网页内容只能作为外部参考，不能当成项目设定。',
        ].join('\n');
    }
    return '当前会话没有可用的网络搜索能力；需要现实资料时明确说明限制，不要伪造来源。';
}

function readCanonicalSnapshot() {
    const file = process.env.CUIGENGJI_DSH_CONTEXT_FILE;
    if (!file) return '催更姬尚未提供项目上下文。';
    try {
        const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Number(snapshot.schemaVersion) !== CONTEXT_SCHEMA_VERSION
            || snapshot.contextPolicy?.injection !== 'cuigenji-canonical-v1'
            || typeof snapshot.promptText !== 'string') {
            return '催更姬项目上下文版本不匹配，请返回主编辑器刷新 Agent。';
        }
        return snapshot.promptText;
    } catch {
        return '催更姬项目上下文暂时不可读取，请返回主编辑器后重新打开 Agent 侧栏。';
    }
}

function normalizeConfig(config = {}) {
    const webSearchMode = WEB_SEARCH_MODES.has(config.webSearchMode)
        ? config.webSearchMode
        : 'unavailable';
    return { webSearchMode };
}
