const TOOL_LABELS = Object.freeze({
    search_project_knowledge: '搜索项目资料',
    get_project_knowledge: '读取项目资料',
});

export function mapDshEvent({ projectId, sessionId, generation, event }) {
    if (!event || !Number.isInteger(event.seq) || typeof event.type !== 'string') return null;
    const base = {
        schemaVersion: 1,
        projectId,
        sessionId,
        generation,
        seq: event.seq,
        time: Number(event.time || Date.now()),
    };
    const data = event.data || {};
    switch (event.type) {
        case 'turn/start':
            return { ...base, type: 'turn.started', data: { turn: data.turn } };
        case 'user/message':
            return {
                ...base,
                type: 'message.user',
                data: {
                    messageId: safeString(data.id, 200),
                    text: contentText(data.content),
                    source: data.source?.kind === 'user' ? 'user' : 'runtime',
                },
            };
        case 'assistant/chunk':
            return mapChunk(base, data);
        case 'assistant/message':
            return {
                ...base,
                type: 'assistant.completed',
                data: {
                    turn: data.turn,
                    step: data.step,
                    text: contentText(data.message?.content),
                    usage: safeUsage(data.usage),
                },
            };
        case 'tool/call':
            return {
                ...base,
                type: 'tool.started',
                data: {
                    turn: data.turn,
                    step: data.step,
                    callId: safeString(data.callId, 200),
                    name: safeToolName(data.name),
                    label: TOOL_LABELS[data.name] || '项目资料工具',
                    summary: safeToolCallSummary(data.name, data.arguments),
                },
            };
        case 'tool/result':
            return {
                ...base,
                type: 'tool.completed',
                data: {
                    turn: data.turn,
                    step: data.step,
                    callId: toolResultCallId(data.message),
                    status: data.error ? 'error' : 'success',
                    summary: data.error ? '项目资料读取失败' : '项目资料已返回',
                },
            };
        case 'turn/end': {
            const kind = safeString(data.reason?.kind, 40) || 'unknown';
            return {
                ...base,
                type: kind === 'completed' ? 'turn.completed' : 'turn.failed',
                data: {
                    turn: data.turn,
                    reason: kind,
                    retryable: kind === 'error',
                    message: turnMessage(kind),
                },
            };
        }
        default:
            return null;
    }
}

export function runtimeStateEvent({ projectId = '', generation = 0, status, state, message = '' }) {
    const resolvedState = state || status?.state || 'idle';
    return {
        schemaVersion: 1,
        type: 'runtime.state',
        projectId,
        generation,
        time: Date.now(),
        data: {
            state: resolvedState,
            ready: resolvedState === 'ready',
            hasCredential: Boolean(status?.hasCredential),
            retryable: resolvedState === 'failed' || resolvedState === 'reconnecting',
            message: message || runtimeMessage(resolvedState),
        },
    };
}

export function sessionReadyEvent({ projectId, sessionId, generation, lastSeq = -1 }) {
    return {
        schemaVersion: 1,
        type: 'session.ready',
        projectId,
        sessionId,
        generation,
        time: Date.now(),
        data: { lastSeq },
    };
}

function mapChunk(base, data) {
    const chunk = data.chunk || {};
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        return {
            ...base,
            type: 'assistant.delta',
            data: {
                turn: data.turn,
                step: data.step,
                kind: chunk.type === 'reasoning-delta' ? 'reasoning' : 'text',
                text: safeString(chunk.text, 200_000),
            },
        };
    }
    if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
        return {
            ...base,
            type: 'turn.failed',
            data: {
                turn: data.turn,
                step: data.step,
                reason: 'error',
                retryable: true,
                message: '模型请求失败，请检查连接或密钥后重试。',
            },
        };
    }
    return null;
}

function contentText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n');
}

function safeUsage(value) {
    if (!value || typeof value !== 'object') return undefined;
    const result = {};
    for (const key of ['promptTokens', 'completionTokens', 'totalTokens', 'prompt_tokens', 'completion_tokens', 'total_tokens']) {
        if (Number.isFinite(value[key])) result[key] = Number(value[key]);
    }
    return Object.keys(result).length ? result : undefined;
}

function safeToolName(value) {
    return Object.hasOwn(TOOL_LABELS, value) ? value : 'unknown';
}

function safeToolCallSummary(name, rawArguments) {
    try {
        const args = JSON.parse(String(rawArguments || '{}'));
        if (name === 'search_project_knowledge') {
            const query = safeString(args.query, 120);
            return query ? `搜索“${query}”` : '搜索项目资料';
        }
        if (name === 'get_project_knowledge') {
            const id = safeString(args.id, 120);
            return id ? `读取资料 ${id}` : '读取项目资料';
        }
    } catch {
        // Fall through to a generic summary without exposing raw arguments.
    }
    return '调用项目资料工具';
}

function toolResultCallId(message) {
    const contentCallId = Array.isArray(message?.content)
        ? message.content.find(part => part?.type === 'tool-result')?.toolCallId
        : '';
    return safeString(
        message?.source?.callId || message?.toolCallId || message?.callId || contentCallId,
        200,
    );
}

function safeString(value, limit) {
    return typeof value === 'string' ? [...value].slice(0, limit).join('') : '';
}

function turnMessage(kind) {
    if (kind === 'aborted') return '已停止生成。';
    if (kind === 'error') return '模型请求失败，请重试。';
    if (kind === 'disposed') return 'Agent 会话已结束。';
    return '';
}

function runtimeMessage(state) {
    if (state === 'starting') return '正在启动 Agent…';
    if (state === 'ready') return 'Agent 已就绪。';
    if (state === 'reconnecting') return 'Agent 事件连接正在恢复…';
    if (state === 'failed') return 'Agent Runtime 已停止，请重试。';
    if (state === 'stopped') return 'Agent 已停止。';
    return '';
}
