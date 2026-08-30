const TOOL_LABELS = Object.freeze({
    search_project_knowledge: '搜索项目资料',
    get_project_knowledge: '读取项目资料',
    skill: '加载创作方法',
    web_search: '搜索网络资料',
    safe_web_fetch: '读取网页资料',
    propose_outline_patch: '整理大纲修改提案',
});
const OUTLINE_PROPOSAL_MARKER = 'CUIGENGJI_OUTLINE_PROPOSAL_V1:';

export function mapDshEvent({ projectId, sessionId, generation, event, toolName = '' }) {
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
            if (!data.error) {
                const proposal = toolName === 'propose_outline_patch'
                    ? outlineProposalFromToolResult(data.message)
                    : null;
                if (proposal) {
                    return {
                        ...base,
                        type: 'proposal.outline',
                        data: {
                            turn: data.turn,
                            step: data.step,
                            callId: toolResultCallId(data.message),
                            proposal,
                        },
                    };
                }
            }
            return {
                ...base,
                type: 'tool.completed',
                data: {
                    turn: data.turn,
                    step: data.step,
                    callId: toolResultCallId(data.message),
                    status: data.error ? 'error' : 'success',
                    summary: data.error ? '操作失败，请稍后重试' : '',
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
        if (name === 'skill') return '按需加载创作分析方法';
        if (name === 'web_search') {
            const query = safeString(args.query, 120);
            return query ? `搜索“${query}”` : '搜索网络资料';
        }
        if (name === 'safe_web_fetch') {
            const target = safeUrlSummary(args.url);
            return target ? `读取 ${target}` : '读取网页资料';
        }
        if (name === 'propose_outline_patch') {
            const count = Array.isArray(args.operations) ? Math.min(args.operations.length, 99) : 0;
            return count ? `整理 ${count} 项大纲修改` : '整理大纲修改提案';
        }
    } catch {
        // Fall through to a generic summary without exposing raw arguments.
    }
    return '调用 Agent 工具';
}

function safeUrlSummary(value) {
    try {
        const url = new URL(String(value || ''));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
        const path = url.pathname === '/' ? '' : safeString(url.pathname, 80);
        return safeString(`${url.hostname}${path}`, 120);
    } catch {
        return '';
    }
}

function outlineProposalFromToolResult(message) {
    const text = toolResultText(message);
    const markerIndex = text.indexOf(OUTLINE_PROPOSAL_MARKER);
    if (markerIndex < 0) return null;
    const payload = text.slice(markerIndex + OUTLINE_PROPOSAL_MARKER.length).trim();
    if (!payload || payload.length > 100_000) return null;
    try {
        return sanitizeOutlineProposal(JSON.parse(payload));
    } catch {
        return null;
    }
}

function toolResultText(message) {
    const result = [];
    const visit = value => {
        if (!value) return;
        if (typeof value === 'string') {
            result.push(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (typeof value === 'object') {
            if (value.type === 'text' && typeof value.text === 'string') result.push(value.text);
            else if (value.type === 'tool-result') visit(value.content);
        }
    };
    visit(message?.content);
    return result.join('\n');
}

function sanitizeOutlineProposal(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid proposal');
    const proposalId = safeString(value.proposalId, 100);
    const baseRevision = Number(value.baseRevision);
    const summary = safeString(value.summary, 500).trim();
    const reason = safeString(value.reason, 2_000).trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(proposalId)
        || !Number.isInteger(baseRevision) || baseRevision < 0 || !summary || !reason) {
        throw new Error('invalid proposal header');
    }
    if (!Array.isArray(value.operations)
        || value.operations.length === 0
        || value.operations.length > 40) {
        throw new Error('invalid proposal operations');
    }
    const operations = value.operations.map(sanitizeProposalOperation);
    const impact = sanitizeProposalList(value.impact);
    const assumptions = sanitizeProposalList(value.assumptions);
    return {
        proposalId,
        baseRevision,
        summary,
        reason,
        operations,
        impact,
        assumptions,
        hasDelete: operations.some(operation => operation.kind === 'delete'),
    };
}

function sanitizeProposalOperation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid operation');
    const kind = safeString(value.kind, 20);
    if (!['create', 'update', 'reorder', 'delete'].includes(kind)) throw new Error('invalid operation kind');
    const result = { kind };
    for (const field of [
        'ref', 'nodeId', 'nodeRef', 'parentId', 'parentRef',
        'beforeNodeId', 'beforeRef', 'afterNodeId', 'afterRef',
        'title', 'description', 'type', 'chapterId',
    ]) {
        if (value[field] !== undefined) {
            const limit = field === 'description' ? 10_000 : 500;
            result[field] = safeString(value[field], limit);
        }
    }
    if (value.completed !== undefined) {
        if (typeof value.completed !== 'boolean') throw new Error('invalid completed value');
        result.completed = value.completed;
    }
    if (value.patch !== undefined) result.patch = sanitizeProposalPatch(value.patch);
    return result;
}

function sanitizeProposalPatch(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid patch');
    const result = {};
    for (const field of ['title', 'description', 'type', 'parentId', 'parentRef', 'chapterId']) {
        if (value[field] !== undefined) {
            result[field] = safeString(value[field], field === 'description' ? 10_000 : 500);
        }
    }
    if (value.completed !== undefined) {
        if (typeof value.completed !== 'boolean') throw new Error('invalid completed value');
        result.completed = value.completed;
    }
    return result;
}

function sanitizeProposalList(value) {
    if (!Array.isArray(value) || value.length > 12) throw new Error('invalid proposal list');
    return value.map(item => safeString(item, 1_000).trim()).filter(Boolean);
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
