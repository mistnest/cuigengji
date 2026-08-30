import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic';
import {
    BlockAssembler,
    LlmError,
    contentHasImage,
    createUserMessage,
} from '@deepseek-ai/dsh-llm';

const COMPACTION_INSTRUCTION = [
    '你现在是小说创作 Agent 的会话压缩器。请把上方较早的对话压缩成一份只服务于当前 DSH session 的中文检查点，使同一会话恢复后不必重读原对话也能准确继续。',
    '',
    '只输出以下 Markdown 结构，保留全部标题并使用简短条目；没有内容时写“（无）”。',
    '',
    '## 当前任务',
    '- 用户此刻要完成的单一创作或讨论任务，以及本轮最关键的不确定性',
    '',
    '## 项目已存在事实',
    '- 只记录来自项目热上下文、世界书、角色卡、大纲或章节的实际事实；不要把会话决定写进这里',
    '',
    '## 本会话用户确认',
    '- 用户在当前 session 中明确认可但尚未应用到项目的方向或决定；必须注明“尚未写入项目”',
    '',
    '## 本会话偏好与否决',
    '- 当前 session 中用户表现出的偏好、证据、置信边界和明确否决；不得描述成跨会话作者画像',
    '',
    '## 当前章节状态',
    '- 当前章节、视角、时间地点、正在发生的事件、已写到的位置',
    '',
    '## 文风与写作约束',
    '- 叙事人称、语言风格、节奏、篇幅、禁忌和格式要求',
    '',
    '## 伏笔与连续性',
    '- 已埋伏笔、待回收线索、人物动机、悬而未决的冲突和必须避免的矛盾',
    '',
    '## 外部资料',
    '- Web Search 或 Fetch 得到的相关结论与来源 URL；明确标记为外部参考，不复制长篇网页正文',
    '',
    '## 推断、假设与待确认方案',
    '- 模型建议、合理推断、临时假设、备选方案和仍需用户选择的内容；不得升级为项目事实或用户确认',
    '',
    '## 大纲修改提案',
    '- 尚未应用的 proposal、base revision、主要操作与风险；记录已应用、已拒绝或因 revision 变化而过期的状态',
    '',
    '## 最近决定与纠正',
    '- 用户最近确认、修改或纠正的内容，尤其是对先前回答的否定',
    '',
    '## 下一步',
    '- 下一条回复应直接完成的单一动作',
    '',
    '规则：',
    '- 使用简洁中文，准确保留专名、称谓、数值、章节名和用户原话中不可改写的短句。',
    '- 明确区分“项目事实”“本会话确认”“外部参考”“推断”“建议”，信息不足时不要补全。',
    '- 本摘要只能延续当前 session；不得生成或暗示跨 session 的永久偏好、作者心理画像或项目级 Agent 记忆。',
    '- 用户在聊天中认可某个方向，不等于已经修改项目；只有明确的应用结果才能改变项目事实。',
    '- 项目热上下文和只读资料工具会在后续请求重新提供；不要大段复制世界书、角色卡或章节正文。',
    '- 不要复制网页正文，只保留继续讨论所必需的结论、来源 URL 和不确定性。',
    '- 不要使用编程项目的 Files、Code、Errors、Jobs 等模板。',
    '- 不要提及本次压缩请求，也不要调用工具。',
    '- 如果对话中已有 <compacted-summary>，合并仍然有效的信息、删除过时信息，不要原样重复旧检查点。',
].join('\n');

export default class CuigenjiNovelCompaction extends BasicCompactionEngine {
    async summarize(input, agent, signal) {
        const latest = agent.session.requestHeader()?.config;
        const configured = this.config.summarizationProvider.length > 0
            ? {
                provider: this.config.summarizationProvider,
                model: this.config.summarizationModel,
            }
            : undefined;
        const agentTarget = agent.options.provider && agent.options.model
            ? { provider: agent.options.provider, model: agent.options.model }
            : undefined;
        const target = configured || latest || agentTarget;
        if (!target) {
            throw new Error('no provider/model available for novel conversation compaction');
        }

        const assembler = new BlockAssembler();
        const messages = [...input.messages, createUserMessage({
            content: [{ type: 'text', text: COMPACTION_INSTRUCTION }],
            source: { kind: 'plugin', plugin: 'cuigenji-novel-compaction' },
        })];
        const options = {
            provider: target.provider,
            model: target.model,
            messages,
            ...(input.system === undefined ? {} : { system: input.system }),
            ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
            maxTokens: this.config.maxTokens,
            sessionId: agent.session.id,
            purpose: 'compaction',
            ...(signal === undefined ? {} : { signal }),
        };
        for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk);
        const error = finishError(assembler.finish);
        if (error) throw error;
        const rawOutput = assembler.blocks();
        if (contentHasImage(rawOutput)) {
            throw new LlmError('novel compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT');
        }
        const summary = rawOutput.filter(block => block.type === 'text');
        if (!summary.some(block => block.text.trim().length > 0)) {
            throw new Error('novel compaction produced no text summary content');
        }
        return {
            summary,
            rawOutput,
            llmStreamCall: true,
            provider: options.provider,
            model: options.model,
            maxTokens: this.config.maxTokens,
            ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
        };
    }
}

function finishError(finish) {
    if (finish.kind === 'error' || finish.kind === 'aborted') {
        const error = new Error(finish.failure.message);
        error.code = finish.failure.code;
        return error;
    }
    if (finish.kind === 'max-tokens') {
        const error = new Error('novel compaction truncated at the token cap');
        error.code = 'MAX_TOKENS';
        return error;
    }
    return undefined;
}
