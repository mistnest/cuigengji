import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ApiError, asyncRoute, requireString } from '../lib/http.js';
import { readJson, updateJson } from '../lib/json-store.js';
import { projectFile } from '../lib/project-paths.js';

export const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
    const novelId = requireString(req.query.novelId, 'novelId', { maxLength: 100 });
    res.json(await readJson(outlinePath(novelId), { defaultValue: { nodes: [] } }));
}));

router.post('/', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    const node = {
        id: uuidv4(),
        novelId,
        parentId: req.body.parentId || '',
        title: req.body.title || '未命名节点',
        description: req.body.description || '',
        type: req.body.type || 'plot',
        chapterId: req.body.chapterId || '',
        order: 0,
        completed: false,
        children: [],
        created: Date.now(),
        updated: Date.now(),
    };
    await updateJson(outlinePath(novelId), outline => {
        const nodes = Array.isArray(outline.nodes) ? outline.nodes : [];
        node.order = nodes.length;
        return { ...outline, nodes: [...nodes, node] };
    }, { defaultValue: { nodes: [] } });
    res.status(201).json(node);
}));

router.put('/reorder', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    if (!Array.isArray(req.body.nodeIds)) {
        throw new ApiError(400, 'nodeIds must be an array', 'VALIDATION_ERROR');
    }
    await updateExistingOutline(novelId, outline => {
        req.body.nodeIds.forEach((id, index) => {
            const node = outline.nodes.find(item => item.id === id);
            if (node) node.order = index;
        });
        return outline;
    });
    res.json({ success: true });
}));

router.put('/:id', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    let updatedNode;
    await updateExistingOutline(novelId, outline => {
        const node = outline.nodes.find(item => item.id === req.params.id);
        if (!node) throw new ApiError(404, 'Node not found', 'NOT_FOUND');
        for (const field of ['title', 'description', 'type', 'completed', 'parentId', 'order', 'chapterId']) {
            if (req.body[field] !== undefined) node[field] = req.body[field];
        }
        node.updated = Date.now();
        updatedNode = { ...node };
        return outline;
    });
    res.json(updatedNode);
}));

router.delete('/:id', asyncRoute(async (req, res) => {
    const novelId = requireString(req.body.novelId, 'novelId', { maxLength: 100 });
    await updateExistingOutline(novelId, outline => {
        const ids = collectDescendantIds(outline.nodes, req.params.id);
        if (!ids.size) throw new ApiError(404, 'Node not found', 'NOT_FOUND');
        return { ...outline, nodes: outline.nodes.filter(node => !ids.has(node.id)) };
    });
    res.json({ success: true });
}));

function outlinePath(novelId) {
    return projectFile(novelId, 'outline.json');
}

async function updateExistingOutline(novelId, updater) {
    try {
        return await updateJson(outlinePath(novelId), outline => {
            if (!Array.isArray(outline.nodes)) outline.nodes = [];
            return updater(outline);
        });
    } catch (err) {
        if (err.code === 'ENOENT') throw new ApiError(404, 'Outline not found', 'NOT_FOUND');
        throw err;
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
