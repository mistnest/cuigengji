import { randomUUID } from 'node:crypto';

import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'cuigenji-outline-proposal';
export const inject = ['tools'];
export const OUTLINE_PROPOSAL_MARKER = 'CUIGENGJI_OUTLINE_PROPOSAL_V1:';

const MAX_OPERATIONS = 40;
const MAX_LIST_ITEMS = 12;

const PROPOSAL_PATCH_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string' },
        completed: { type: 'boolean' },
        parentId: { type: 'string' },
        parentRef: { type: 'string' },
        chapterId: { type: 'string' },
    },
};

const PROPOSAL_OPERATION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        kind: {
            type: 'string',
            required: true,
            enum: ['create', 'update', 'reorder', 'delete'],
        },
        ref: { type: 'string' },
        nodeId: { type: 'string' },
        nodeRef: { type: 'string' },
        parentId: { type: 'string' },
        parentRef: { type: 'string' },
        beforeNodeId: { type: 'string' },
        beforeRef: { type: 'string' },
        afterNodeId: { type: 'string' },
        afterRef: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string' },
        chapterId: { type: 'string' },
        completed: { type: 'boolean' },
        patch: PROPOSAL_PATCH_SCHEMA,
    },
};

export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'propose_outline_patch',
        description: '把已经讨论清楚的大纲修改整理为结构化提案。此工具只生成提案卡片，不修改项目；baseRevision 必须来自当前项目上下文。',
        parameters: {
            baseRevision: {
                type: 'integer',
                required: true,
                description: '当前项目上下文中的 outline.revision。',
            },
            summary: {
                type: 'string',
                required: true,
                description: '一句话概括准备怎样修改大纲。',
            },
            reason: {
                type: 'string',
                required: true,
                description: '为什么要进行这组修改。',
            },
            operations: {
                type: 'array',
                required: true,
                description: '按顺序执行的 create、update、reorder 或 delete 操作。create 的 ref 可供后续操作通过 nodeRef/parentRef 引用。',
                items: PROPOSAL_OPERATION_SCHEMA,
            },
            impact: {
                type: 'array',
                required: true,
                description: '该修改对后续剧情、人物或节奏的主要影响。',
                items: { type: 'string' },
            },
            assumptions: {
                type: 'array',
                required: true,
                description: '尚未成为项目事实、应用前需要用户留意的假设。没有时传空数组。',
                items: { type: 'string' },
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    proposalId: { type: 'string', required: true },
                    baseRevision: { type: 'integer', required: true },
                    summary: { type: 'string', required: true },
                    reason: { type: 'string', required: true },
                    operations: { type: 'array', required: true, items: PROPOSAL_OPERATION_SCHEMA },
                    impact: { type: 'array', required: true, items: { type: 'string' } },
                    assumptions: { type: 'array', required: true, items: { type: 'string' } },
                    hasDelete: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: `${OUTLINE_PROPOSAL_MARKER}${JSON.stringify(value)}`,
            }],
        },
        isConcurrencySafe: () => true,
        async execute(args) {
            return normalizeOutlineProposal(args);
        },
    }));
}

export function normalizeOutlineProposal(value, proposalId = randomUUID()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw proposalError('大纲提案格式无效。');
    }
    const baseRevision = Number(value.baseRevision);
    if (!Number.isInteger(baseRevision) || baseRevision < 0) {
        throw proposalError('baseRevision 必须是当前大纲的非负整数 revision。');
    }
    if (!Array.isArray(value.operations)
        || value.operations.length === 0
        || value.operations.length > MAX_OPERATIONS) {
        throw proposalError(`大纲提案必须包含 1～${MAX_OPERATIONS} 个操作。`);
    }
    const operations = value.operations.map((operation, index) => (
        normalizeProposalOperation(operation, index)
    ));
    return {
        proposalId: boundedText(proposalId, 'proposalId', 100, true),
        baseRevision,
        summary: boundedText(value.summary, 'summary', 500, true),
        reason: boundedText(value.reason, 'reason', 2_000, true),
        operations,
        impact: normalizeTextList(value.impact, 'impact'),
        assumptions: normalizeTextList(value.assumptions, 'assumptions'),
        hasDelete: operations.some(operation => operation.kind === 'delete'),
    };
}

function normalizeProposalOperation(value, index) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw proposalError(`第 ${index + 1} 个大纲操作格式无效。`);
    }
    const kind = String(value.kind || '');
    if (!['create', 'update', 'reorder', 'delete'].includes(kind)) {
        throw proposalError(`第 ${index + 1} 个大纲操作类型无效。`);
    }
    if (kind === 'create') {
        assertAllowedKeys(value, [
            'kind', 'ref', 'parentId', 'parentRef', 'title', 'description',
            'type', 'chapterId', 'completed',
        ]);
        const ref = localRef(value.ref, 'ref');
        const parent = normalizeProposalParent(value);
        return {
            kind,
            ref,
            ...parent,
            title: boundedText(value.title, 'title', 500, true),
            description: optionalText(value.description, 'description', 10_000),
            type: optionalText(value.type, 'type', 50) || 'plot',
            chapterId: optionalText(value.chapterId, 'chapterId', 120),
            completed: value.completed === true,
        };
    }
    if (kind === 'update') {
        assertAllowedKeys(value, ['kind', 'nodeId', 'nodeRef', 'patch']);
        return {
            kind,
            ...normalizeProposalTarget(value),
            patch: normalizeProposalPatch(value.patch),
        };
    }
    if (kind === 'reorder') {
        assertAllowedKeys(value, [
            'kind', 'nodeId', 'nodeRef', 'beforeNodeId', 'beforeRef', 'afterNodeId', 'afterRef',
        ]);
        const target = normalizeProposalTarget(value);
        const before = normalizeOptionalProposalTarget(value, 'beforeNodeId', 'beforeRef');
        const after = normalizeOptionalProposalTarget(value, 'afterNodeId', 'afterRef');
        if (Boolean(before) === Boolean(after)) {
            throw proposalError('reorder 操作必须且只能指定 before 或 after 目标。');
        }
        return {
            kind,
            ...target,
            ...(before
                ? before.nodeId ? { beforeNodeId: before.nodeId } : { beforeRef: before.nodeRef }
                : after.nodeId ? { afterNodeId: after.nodeId } : { afterRef: after.nodeRef }),
        };
    }
    assertAllowedKeys(value, ['kind', 'nodeId', 'nodeRef']);
    return { kind, ...normalizeProposalTarget(value) };
}

function normalizeProposalPatch(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw proposalError('update patch 格式无效。');
    }
    assertAllowedKeys(value, [
        'title', 'description', 'type', 'completed', 'parentId', 'parentRef', 'chapterId',
    ]);
    const result = {};
    for (const field of ['title', 'description', 'type', 'parentId', 'parentRef', 'chapterId']) {
        if (value[field] !== undefined) {
            result[field] = field === 'title' || field === 'type'
                ? boundedText(value[field], field, field === 'title' ? 500 : 50, true)
                : optionalText(value[field], field, field === 'description' ? 10_000 : 120);
        }
    }
    if (value.completed !== undefined) {
        if (typeof value.completed !== 'boolean') {
            throw proposalError('completed 必须是布尔值。');
        }
        result.completed = value.completed;
    }
    if (value.parentId !== undefined || value.parentRef !== undefined) {
        delete result.parentId;
        delete result.parentRef;
        Object.assign(result, normalizeProposalParent(value));
    }
    if (Object.keys(result).length === 0) throw proposalError('update patch 不能为空。');
    return result;
}

function normalizeProposalTarget(value) {
    const target = normalizeOptionalProposalTarget(value, 'nodeId', 'nodeRef');
    if (!target) throw proposalError('操作必须指定 nodeId 或 nodeRef。');
    return target;
}

function normalizeOptionalProposalTarget(value, idField, refField) {
    const hasId = value[idField] !== undefined && value[idField] !== '';
    const hasRef = value[refField] !== undefined && value[refField] !== '';
    if (hasId && hasRef) throw proposalError(`${idField} 与 ${refField} 不能同时使用。`);
    if (hasId) return { nodeId: boundedText(value[idField], idField, 120, true) };
    if (hasRef) return { nodeRef: localRef(value[refField], refField) };
    return null;
}

function normalizeProposalParent(value) {
    const hasId = value.parentId !== undefined;
    const hasRef = value.parentRef !== undefined && value.parentRef !== '';
    if (hasId && hasRef) throw proposalError('parentId 与 parentRef 不能同时使用。');
    if (hasRef) return { parentRef: localRef(value.parentRef, 'parentRef') };
    return { parentId: optionalText(value.parentId, 'parentId', 120) };
}

function normalizeTextList(value, field) {
    if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
        throw proposalError(`${field} 必须是最多 ${MAX_LIST_ITEMS} 项的字符串数组。`);
    }
    return value.map(item => boundedText(item, field, 1_000, true));
}

function boundedText(value, field, maxLength, required = false) {
    if (typeof value !== 'string' || value.includes('\0') || [...value].length > maxLength) {
        throw proposalError(`${field} 格式无效或过长。`);
    }
    const result = value.trim();
    if (required && !result) throw proposalError(`${field} 不能为空。`);
    return result;
}

function optionalText(value, field, maxLength) {
    if (value === undefined || value === null) return '';
    return boundedText(value, field, maxLength);
}

function localRef(value, field) {
    const ref = boundedText(value, field, 80, true);
    if (!/^[a-z][a-z0-9_-]*$/u.test(ref)) throw proposalError(`${field} 必须是小写局部引用。`);
    return ref;
}

function assertAllowedKeys(value, allowed) {
    const unexpected = Object.keys(value).find(key => !allowed.includes(key));
    if (unexpected) throw proposalError(`大纲操作包含未知字段：${unexpected}`);
}

function proposalError(message) {
    const error = new Error(message);
    error.code = 'OUTLINE_PROPOSAL_INVALID';
    return error;
}
