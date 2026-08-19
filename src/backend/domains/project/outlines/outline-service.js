import { v4 as uuidv4 } from 'uuid';

import { AppError, projectFile, readJson, requireString, updateJson } from '../../../foundation/platform/index.js';

const DEFAULT_OUTLINE = Object.freeze({ schemaVersion: 1, revision: 0, nodes: [] });

export async function getOutline(projectId) {
    const outline = await readJson(outlinePath(requireProjectId(projectId)), {
        defaultValue: DEFAULT_OUTLINE,
    });
    return normalizeOutline(outline);
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
    const outline = await updateJson(outlinePath(id), current => {
        const outline = normalizeOutline(current);
        node.order = outline.nodes.length;
        return {
            ...outline,
            revision: outline.revision + 1,
            nodes: [...outline.nodes, node],
        };
    }, { defaultValue: DEFAULT_OUTLINE });
    return { ...node, revision: outline.revision };
}

export async function updateOutlineNode(projectId, nodeId, patch = {}) {
    const id = requireProjectId(projectId);
    const targetId = requireNodeId(nodeId);
    let updatedNode;
    const outline = await updateExistingOutline(id, outline => {
        assertExpectedRevision(outline, patch.expectedRevision);
        const node = outline.nodes.find(item => item.id === targetId);
        if (!node) throw notFound();
        for (const field of ['title', 'description', 'type', 'completed', 'parentId', 'order', 'chapterId']) {
            if (patch[field] !== undefined) node[field] = patch[field];
        }
        node.updated = Date.now();
        updatedNode = { ...node };
        outline.revision += 1;
        return outline;
    });
    return { ...updatedNode, revision: outline.revision };
}

export async function reorderOutline(projectId, input = {}) {
    const id = requireProjectId(projectId);
    if (!Array.isArray(input.nodeIds)) {
        throw new AppError('VALIDATION_ERROR', 'nodeIds must be an array', { status: 400 });
    }
    const outline = await updateExistingOutline(id, current => {
        assertExpectedRevision(current, input.expectedRevision);
        input.nodeIds.forEach((nodeId, index) => {
            const node = current.nodes.find(item => item.id === nodeId);
            if (node) node.order = index;
        });
        current.revision += 1;
        return current;
    });
    return { success: true, revision: outline.revision };
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
    const outline = await updateExistingOutline(id, current => {
        assertExpectedRevision(current, options.expectedRevision);
        const ids = collectDescendantIds(current.nodes, targetId);
        if (!ids.size) throw notFound();
        current.nodes = current.nodes.filter(node => !ids.has(node.id));
        current.revision += 1;
        return current;
    });
    return { success: true, revision: outline.revision };
}

function outlinePath(projectId) {
    return projectFile(projectId, 'outline.json');
}

async function updateExistingOutline(projectId, updater) {
    try {
        return await updateJson(outlinePath(projectId), current => updater(normalizeOutline(current)));
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

function assertExpectedRevision(outline, expectedRevision) {
    if (expectedRevision === undefined) return;
    if (Number(expectedRevision) !== outline.revision) {
        throw new AppError('REVISION_CONFLICT', 'Outline was changed by another operation', {
            status: 409,
            publicMessage: '大纲已被其他操作修改，请刷新后重试。',
            details: { expectedRevision: Number(expectedRevision), currentRevision: outline.revision },
        });
    }
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
