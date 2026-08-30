import { v4 as uuidv4 } from 'uuid';

import {
    AppError,
    assertExpectedRevision as assertVersionExpectedRevision,
    expectedContentHashFrom,
    getVersionStamp,
    projectFile,
    publishDomainChange,
    readJson,
    readRevision,
    requireString,
    updateVersionedJson,
    withVersion,
} from '../../../foundation/platform/index.js';

const DEFAULT_OUTLINE = Object.freeze({ schemaVersion: 1, revision: 0, nodes: [] });
const MAX_PATCH_OPERATIONS = 40;
const MAX_OUTLINE_NODES = 5_000;

export async function getOutline(projectId) {
    const outline = await readJson(outlinePath(requireProjectId(projectId)), {
        defaultValue: DEFAULT_OUTLINE,
    });
    const normalized = normalizeOutline(outline);
    return withVersion(normalized, normalized.revision, normalized.updatedAt || 0);
}

export async function createOutlineNode(projectId, input = {}) {
    const id = requireProjectId(projectId);
    const now = Date.now();
    const node = {
        id: uuidv4(),
        novelId: id,
        parentId: input.parentId || '',
        title: input.title || '未命名节点',
        description: input.description || '',
        type: input.type || 'plot',
        chapterId: input.chapterId || '',
        order: 0,
        completed: false,
        children: [],
        created: now,
        updated: now,
    };
    let previous;
    const outline = await updateVersionedJson(outlinePath(id), current => {
        const outline = normalizeOutline(current);
        previous = cloneOutline(outline);
        assertVersionExpectedRevision(outline, input.expectedRevision, `outline:${id}`, {
            includeCurrent: true,
            expectedContentHash: expectedContentHashFrom(input),
        });
        node.order = outline.nodes.length;
        const next = {
            ...outline,
            nodes: [...outline.nodes, node],
        };
        // The single-node endpoint is also a public write boundary.  Keep it
        // subject to the same referential-integrity and cycle checks as the
        // Agent's batch proposal endpoint; otherwise a hand-edited parentId
        // could leave the outline unreadable until the next batch operation.
        assertParentGraph(next.nodes);
        return withVersion(next, outline.revision + 1, now);
    }, {
        defaultValue: DEFAULT_OUTLINE,
        expectedRevision: input.expectedRevision,
        expectedContentHash: expectedContentHashFrom(input),
        resource: `outline:${id}`,
        includeCurrent: true,
    });
    const version = getVersionStamp(outline);
    publishDomainChange({
        projectId: id,
        entityType: 'outline',
        entityId: id,
        operation: previous?.revision ? 'updated' : 'created',
        beforeRevision: readRevision(previous),
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
        changedFields: ['nodes'],
        actor: input.actor,
    });
    return {
        ...node,
        revision: outline.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
    };
}

export async function updateOutlineNode(projectId, nodeId, patch = {}) {
    const id = requireProjectId(projectId);
    const targetId = requireNodeId(nodeId);
    let updatedNode;
    let previous;
    const outline = await updateExistingOutline(id, outline => {
        previous = cloneOutline(outline);
        assertExpectedRevision(outline, patch.expectedRevision, expectedContentHashFrom(patch));
        const node = outline.nodes.find(item => item.id === targetId);
        if (!node) throw notFound();
        for (const field of ['title', 'description', 'type', 'completed', 'parentId', 'order', 'chapterId']) {
            if (patch[field] !== undefined) node[field] = patch[field];
        }
        assertParentGraph(outline.nodes);
        node.updated = Date.now();
        updatedNode = { ...node };
        outline.revision += 1;
        return outline;
    }, {
        expectedRevision: patch.expectedRevision,
        expectedContentHash: expectedContentHashFrom(patch),
    });
    publishOutlineChange(id, previous, outline, patch.actor, ['nodes']);
    return { ...updatedNode, ...outlineVersionResult(outline) };
}

export async function reorderOutline(projectId, input = {}) {
    const id = requireProjectId(projectId);
    if (!Array.isArray(input.nodeIds)) {
        throw new AppError('VALIDATION_ERROR', 'nodeIds must be an array', { status: 400 });
    }
    let previous;
    const outline = await updateExistingOutline(id, current => {
        previous = cloneOutline(current);
        assertExpectedRevision(current, input.expectedRevision, expectedContentHashFrom(input));
        input.nodeIds.forEach((nodeId, index) => {
            const node = current.nodes.find(item => item.id === nodeId);
            if (node) node.order = index;
        });
        current.revision += 1;
        return current;
    }, {
        expectedRevision: input.expectedRevision,
        expectedContentHash: expectedContentHashFrom(input),
    });
    publishOutlineChange(id, previous, outline, input.actor, ['nodes']);
    return { success: true, ...outlineVersionResult(outline) };
}

export async function deleteOutlineNode(projectId, nodeId, options = {}) {
    if (options.confirmed !== true) {
        throw new AppError('DELETE_CONFIRMATION_REQUIRED', 'Outline delete confirmation is required', {
            status: 409,
            publicMessage: '删除大纲节点前需要确认。',
        });
    }
    const id = requireProjectId(projectId);
    const targetId = requireNodeId(nodeId);
    let previous;
    const outline = await updateExistingOutline(id, current => {
        previous = cloneOutline(current);
        assertExpectedRevision(current, options.expectedRevision, expectedContentHashFrom(options));
        const ids = collectDescendantIds(current.nodes, targetId);
        if (!ids.size) throw notFound();
        current.nodes = current.nodes.filter(node => !ids.has(node.id));
        current.revision += 1;
        return current;
    }, {
        expectedRevision: options.expectedRevision,
        expectedContentHash: expectedContentHashFrom(options),
    });
    publishOutlineChange(id, previous, outline, options.actor, ['nodes']);
    return { success: true, ...outlineVersionResult(outline) };
}

export async function applyOutlinePatch(projectId, input = {}) {
    const id = requireProjectId(projectId);
    const expectedRevision = requireRevision(input.expectedRevision);
    const operations = normalizePatchOperations(input.operations);
    const hasDelete = operations.some(operation => operation.kind === 'delete');
    if (hasDelete && input.confirmed !== true) {
        throw new AppError('DELETE_CONFIRMATION_REQUIRED', 'Outline patch delete confirmation is required', {
            status: 409,
            publicMessage: '该提案包含删除操作，应用前需要再次确认。',
        });
    }

    let affectedNodeIds = [];
    let previous;
    const outline = await updateVersionedJson(outlinePath(id), current => {
        const next = cloneOutline(normalizeOutline(current));
        previous = normalizeOutline(current);
        assertExpectedRevision(next, expectedRevision, expectedContentHashFrom(input));
        const references = new Map();
        const affected = new Set();

        for (const operation of operations) {
            if (operation.kind === 'create') {
                applyCreateOperation(next, operation, references, affected, id);
            } else if (operation.kind === 'update') {
                applyUpdateOperation(next, operation, references, affected);
            } else if (operation.kind === 'reorder') {
                applyReorderOperation(next, operation, references, affected);
            } else if (operation.kind === 'delete') {
                applyDeleteOperation(next, operation, references, affected);
            }
        }

        if (next.nodes.length > MAX_OUTLINE_NODES) {
            throw validationError('大纲节点数量超过安全上限。');
        }
        assertParentGraph(next.nodes);
        const liveIds = new Set(next.nodes.map(node => node.id));
        next.nodes.forEach((node, index) => {
            node.order = index;
            if (Array.isArray(node.children)) {
                node.children = node.children.filter(childId => liveIds.has(childId));
            }
        });
        next.revision += 1;
        affectedNodeIds = [...affected];
        return withVersion(next, next.revision, Date.now());
    }, {
        defaultValue: DEFAULT_OUTLINE,
        expectedRevision,
        expectedContentHash: expectedContentHashFrom(input),
        resource: `outline:${id}`,
        includeCurrent: true,
    });

    publishOutlineChange(id, previous, outline, input.actor, ['nodes']);

    return {
        success: true,
        ...outlineVersionResult(outline),
        nodes: outline.nodes,
        affectedNodeIds,
        operationCount: operations.length,
    };
}

function outlinePath(projectId) {
    return projectFile(projectId, 'outline.json');
}

async function updateExistingOutline(projectId, updater, options = {}) {
    try {
        return await updateVersionedJson(outlinePath(projectId), async current => {
            const normalized = normalizeOutline(current);
            const next = await updater(normalized);
            return next;
        }, {
            expectedRevision: options.expectedRevision,
            expectedContentHash: options.expectedContentHash,
            resource: `outline:${projectId}`,
            includeCurrent: true,
        });
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new AppError('NOT_FOUND', 'Outline not found', { status: 404 });
        }
        throw error;
    }
}

function normalizeOutline(outline) {
    return {
        ...(outline || {}),
        schemaVersion: Number(outline?.schemaVersion || 1),
        revision: Number(outline?.revision || 0),
        nodes: Array.isArray(outline?.nodes) ? outline.nodes : [],
    };
}

function publishOutlineChange(projectId, previous, next, actor, changedFields) {
    const version = getVersionStamp(next);
    publishDomainChange({
        projectId,
        entityType: 'outline',
        entityId: projectId,
        operation: 'updated',
        beforeRevision: readRevision(previous),
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
        changedFields,
        actor,
    });
}

function outlineVersionResult(outline) {
    const version = getVersionStamp(outline);
    return {
        revision: version.revision,
        updatedAt: version.updatedAt,
        contentHash: version.contentHash,
    };
}

function cloneOutline(outline) {
    return {
        ...outline,
        nodes: outline.nodes
            .map(node => ({
                ...node,
                children: Array.isArray(node.children) ? [...node.children] : [],
            }))
            .sort((left, right) => Number(left.order || 0) - Number(right.order || 0)),
    };
}

function normalizePatchOperations(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATCH_OPERATIONS) {
        throw validationError(`大纲提案必须包含 1～${MAX_PATCH_OPERATIONS} 个操作。`);
    }
    return value.map((operation, index) => normalizePatchOperation(operation, index));
}

function normalizePatchOperation(operation, index) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        throw validationError(`大纲提案第 ${index + 1} 个操作格式无效。`);
    }
    const kind = String(operation.kind || '');
    if (kind === 'create') {
        assertAllowedKeys(operation, [
            'kind', 'ref', 'parentId', 'parentRef', 'title', 'description',
            'type', 'chapterId', 'completed',
        ]);
        return {
            kind,
            ref: requireLocalRef(operation.ref, 'ref'),
            ...normalizeParent(operation),
            title: requireBoundedText(operation.title, 'title', 500),
            description: optionalBoundedText(operation.description, 'description', 10_000),
            type: optionalBoundedText(operation.type, 'type', 50) || 'plot',
            chapterId: optionalBoundedText(operation.chapterId, 'chapterId', 120),
            completed: operation.completed === true,
        };
    }
    if (kind === 'update') {
        assertAllowedKeys(operation, ['kind', 'nodeId', 'nodeRef', 'patch']);
        return {
            kind,
            ...normalizeTarget(operation),
            patch: normalizeNodePatch(operation.patch),
        };
    }
    if (kind === 'reorder') {
        assertAllowedKeys(operation, [
            'kind', 'nodeId', 'nodeRef', 'beforeNodeId', 'beforeRef', 'afterNodeId', 'afterRef',
        ]);
        const target = normalizeTarget(operation);
        const before = normalizeOptionalTarget(operation, 'beforeNodeId', 'beforeRef');
        const after = normalizeOptionalTarget(operation, 'afterNodeId', 'afterRef');
        if (Boolean(before) === Boolean(after)) {
            throw validationError('reorder 操作必须且只能指定 before 或 after 目标。');
        }
        return { kind, ...target, ...(before ? { before } : { after }) };
    }
    if (kind === 'delete') {
        assertAllowedKeys(operation, ['kind', 'nodeId', 'nodeRef']);
        return { kind, ...normalizeTarget(operation) };
    }
    throw validationError(`不支持的大纲操作：${kind || '空'}`);
}

function normalizeNodePatch(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw validationError('update 操作需要 patch。');
    }
    assertAllowedKeys(value, [
        'title', 'description', 'type', 'completed', 'parentId', 'parentRef', 'chapterId',
    ]);
    const patch = {};
    if (value.title !== undefined) patch.title = requireBoundedText(value.title, 'title', 500);
    if (value.description !== undefined) {
        patch.description = optionalBoundedText(value.description, 'description', 10_000);
    }
    if (value.type !== undefined) patch.type = requireBoundedText(value.type, 'type', 50);
    if (value.chapterId !== undefined) {
        patch.chapterId = optionalBoundedText(value.chapterId, 'chapterId', 120);
    }
    if (value.completed !== undefined) {
        if (typeof value.completed !== 'boolean') throw validationError('completed 必须是布尔值。');
        patch.completed = value.completed;
    }
    if (value.parentId !== undefined || value.parentRef !== undefined) {
        Object.assign(patch, normalizeParent(value, { allowEmpty: true }));
    }
    if (Object.keys(patch).length === 0) throw validationError('update patch 不能为空。');
    return patch;
}

function applyCreateOperation(outline, operation, references, affected, projectId) {
    if (references.has(operation.ref)) throw validationError(`重复的 proposal ref：${operation.ref}`);
    const parentId = resolveParent(operation, references);
    if (parentId) assertNodeExists(outline.nodes, parentId);
    const now = Date.now();
    const node = {
        id: uuidv4(),
        novelId: projectId,
        parentId,
        title: operation.title,
        description: operation.description,
        type: operation.type,
        chapterId: operation.chapterId,
        order: outline.nodes.length,
        completed: operation.completed,
        children: [],
        created: now,
        updated: now,
    };
    references.set(operation.ref, node.id);
    outline.nodes.push(node);
    affected.add(node.id);
}

function applyUpdateOperation(outline, operation, references, affected) {
    const nodeId = resolveTarget(operation, references);
    const node = assertNodeExists(outline.nodes, nodeId);
    const patch = { ...operation.patch };
    if (patch.parentId !== undefined || patch.parentRef !== undefined) {
        patch.parentId = resolveParent(patch, references);
        delete patch.parentRef;
        if (patch.parentId) assertNodeExists(outline.nodes, patch.parentId);
        if (patch.parentId === nodeId) throw validationError('大纲节点不能成为自己的父节点。');
    }
    Object.assign(node, patch, { updated: Date.now() });
    affected.add(nodeId);
}

function applyReorderOperation(outline, operation, references, affected) {
    const nodeId = resolveTarget(operation, references);
    const anchorId = resolveTarget(operation.before || operation.after, references);
    if (nodeId === anchorId) throw validationError('reorder 节点和锚点不能相同。');
    const node = assertNodeExists(outline.nodes, nodeId);
    assertNodeExists(outline.nodes, anchorId);
    outline.nodes = outline.nodes.filter(item => item.id !== nodeId);
    const anchorIndex = outline.nodes.findIndex(item => item.id === anchorId);
    const insertAt = operation.before ? anchorIndex : anchorIndex + 1;
    outline.nodes.splice(insertAt, 0, node);
    node.updated = Date.now();
    affected.add(nodeId);
}

function applyDeleteOperation(outline, operation, references, affected) {
    const nodeId = resolveTarget(operation, references);
    assertNodeExists(outline.nodes, nodeId);
    const deletedIds = collectDescendantIds(outline.nodes, nodeId);
    outline.nodes = outline.nodes.filter(node => !deletedIds.has(node.id));
    for (const id of deletedIds) affected.add(id);
}

function assertParentGraph(nodes) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
        if (node.parentId && !byId.has(node.parentId)) {
            throw validationError(`父节点不存在：${node.parentId}`);
        }
        const visited = new Set([node.id]);
        let current = node;
        while (current.parentId) {
            if (visited.has(current.parentId)) throw validationError('大纲父子关系形成了循环。');
            visited.add(current.parentId);
            current = byId.get(current.parentId);
            if (!current) break;
        }
    }
}

function assertNodeExists(nodes, nodeId) {
    const node = nodes.find(item => item.id === nodeId);
    if (!node) throw validationError(`大纲节点不存在：${nodeId}`);
    return node;
}

function resolveTarget(target, references) {
    if (target.nodeId) return target.nodeId;
    const nodeId = references.get(target.nodeRef);
    if (!nodeId) throw validationError(`proposal ref 尚不可用：${target.nodeRef}`);
    return nodeId;
}

function resolveParent(value, references) {
    if (value.parentRef) {
        const parentId = references.get(value.parentRef);
        if (!parentId) throw validationError(`proposal parentRef 尚不可用：${value.parentRef}`);
        return parentId;
    }
    return value.parentId || '';
}

function normalizeTarget(value) {
    const target = normalizeOptionalTarget(value, 'nodeId', 'nodeRef');
    if (!target) throw validationError('操作必须指定 nodeId 或 nodeRef。');
    return target;
}

function normalizeOptionalTarget(value, idKey, refKey) {
    const hasId = value[idKey] !== undefined && value[idKey] !== '';
    const hasRef = value[refKey] !== undefined && value[refKey] !== '';
    if (hasId && hasRef) throw validationError(`${idKey} 与 ${refKey} 不能同时使用。`);
    if (hasId) return { nodeId: requireBoundedText(value[idKey], idKey, 120) };
    if (hasRef) return { nodeRef: requireLocalRef(value[refKey], refKey) };
    return null;
}

function normalizeParent(value, options = {}) {
    const hasId = value.parentId !== undefined;
    const hasRef = value.parentRef !== undefined && value.parentRef !== '';
    if (hasId && hasRef) throw validationError('parentId 与 parentRef 不能同时使用。');
    if (hasRef) return { parentRef: requireLocalRef(value.parentRef, 'parentRef') };
    if (hasId) {
        const parentId = optionalBoundedText(value.parentId, 'parentId', 120);
        if (!parentId && options.allowEmpty !== true) return { parentId: '' };
        return { parentId };
    }
    return { parentId: '' };
}

function requireLocalRef(value, field) {
    const ref = String(value || '').trim();
    if (!/^[a-z][a-z0-9_-]{0,79}$/u.test(ref)) {
        throw validationError(`${field} 必须是小写 proposal 局部引用。`);
    }
    return ref;
}

function requireBoundedText(value, field, maxLength) {
    const result = optionalBoundedText(value, field, maxLength);
    if (!result) throw validationError(`${field} 不能为空。`);
    return result;
}

function optionalBoundedText(value, field, maxLength) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.includes('\0') || [...value].length > maxLength) {
        throw validationError(`${field} 格式无效或过长。`);
    }
    return value.trim();
}

function assertAllowedKeys(value, allowed) {
    const unexpected = Object.keys(value).find(key => !allowed.includes(key));
    if (unexpected) throw validationError(`大纲操作包含未知字段：${unexpected}`);
}

function requireRevision(value) {
    const revision = Number(value);
    if (!Number.isInteger(revision) || revision < 0) throw validationError('expectedRevision 无效。');
    return revision;
}

function validationError(message) {
    return new AppError('VALIDATION_ERROR', message, {
        status: 400,
        publicMessage: message,
    });
}

function assertExpectedRevision(outline, expectedRevision, expectedContentHash) {
    assertVersionExpectedRevision(outline, expectedRevision, 'outline', {
        includeCurrent: true,
        expectedContentHash,
    });
}

function collectDescendantIds(nodes, rootId) {
    const ids = new Set();
    const visit = id => {
        const matches = nodes.filter(node => node.id === id || node.parentId === id);
        for (const node of matches) {
            if (ids.has(node.id)) continue;
            ids.add(node.id);
            visit(node.id);
        }
    };
    visit(rootId);
    return ids;
}

function requireProjectId(value) {
    return requireString(value, 'projectId', { maxLength: 100 });
}

function requireNodeId(value) {
    return requireString(value, 'nodeId', { maxLength: 120 });
}

function notFound() {
    return new AppError('NOT_FOUND', 'Node not found', { status: 404 });
}
