/**
 * Novel AI Editor — Outline API
 * 大纲 CRUD 操作
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import sanitize from 'sanitize-filename';
import { v4 as uuidv4 } from 'uuid';

import { getDataRoot } from '../config.js';

export const router = express.Router();

function getUserDataDir() {
    return getDataRoot();
}

function getOutlinePath(novelId) {
    return path.join(getUserDataDir(), 'novels', sanitize(novelId), 'outline.json');
}

// GET /api/outline?novelId=xxx — Get full outline tree
router.get('/', async (req, res) => {
    try {
        const { novelId } = req.query;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const outlinePath = getOutlinePath(novelId);
        if (!fs.existsSync(outlinePath)) {
            return res.json({ nodes: [] });
        }

        const data = JSON.parse(fs.readFileSync(outlinePath, 'utf8'));
        res.json(data);
    } catch (err) {
        console.error('[Outline] Get error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/outline — Create a new outline node
router.post('/', async (req, res) => {
    try {
        const { novelId, parentId, title, description, type, chapterId } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const outlinePath = getOutlinePath(novelId);
        const outlineDir = path.dirname(outlinePath);
        fs.mkdirSync(outlineDir, { recursive: true });

        let outline = { nodes: [] };
        if (fs.existsSync(outlinePath)) {
            outline = JSON.parse(fs.readFileSync(outlinePath, 'utf8'));
        }

        const node = {
            id: uuidv4(),
            novelId,
            parentId: parentId || '',
            title: title || '未命名节点',
            description: description || '',
            type: type || 'plot',
            chapterId: chapterId || '',
            order: outline.nodes.length,
            completed: false,
            children: [],
            created: Date.now(),
            updated: Date.now(),
        };

        outline.nodes.push(node);
        fs.writeFileSync(outlinePath, JSON.stringify(outline, null, 2), 'utf8');

        res.status(201).json(node);
    } catch (err) {
        console.error('[Outline] Create error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/outline/reorder — Reorder outline nodes
router.put('/reorder', async (req, res) => {
    try {
        const { novelId, nodeIds } = req.body;  // nodeIds in new order
        if (!novelId || !Array.isArray(nodeIds)) {
            return res.status(400).json({ error: 'novelId and nodeIds array are required' });
        }

        const outlinePath = getOutlinePath(novelId);
        if (!fs.existsSync(outlinePath)) return res.status(404).json({ error: 'Outline not found' });

        const outline = JSON.parse(fs.readFileSync(outlinePath, 'utf8'));

        nodeIds.forEach((id, index) => {
            const node = outline.nodes.find(n => n.id === id);
            if (node) node.order = index;
        });

        fs.writeFileSync(outlinePath, JSON.stringify(outline, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        console.error('[Outline] Reorder error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/outline/:id — Update outline node
router.put('/:id', async (req, res) => {
    try {
        const { novelId, title, description, type, completed, parentId, order, chapterId } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const outlinePath = getOutlinePath(novelId);
        if (!fs.existsSync(outlinePath)) return res.status(404).json({ error: 'Outline not found' });

        const outline = JSON.parse(fs.readFileSync(outlinePath, 'utf8'));
        const node = outline.nodes.find(n => n.id === req.params.id);
        if (!node) return res.status(404).json({ error: 'Node not found' });

        if (title !== undefined) node.title = title;
        if (description !== undefined) node.description = description;
        if (type !== undefined) node.type = type;
        if (completed !== undefined) node.completed = completed;
        if (parentId !== undefined) node.parentId = parentId;
        if (order !== undefined) node.order = order;
        if (chapterId !== undefined) node.chapterId = chapterId;
        node.updated = Date.now();

        fs.writeFileSync(outlinePath, JSON.stringify(outline, null, 2), 'utf8');
        res.json(node);
    } catch (err) {
        console.error('[Outline] Update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/outline/:id — Delete outline node
router.delete('/:id', async (req, res) => {
    try {
        const { novelId } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const outlinePath = getOutlinePath(novelId);
        if (!fs.existsSync(outlinePath)) return res.status(404).json({ error: 'Outline not found' });

        const outline = JSON.parse(fs.readFileSync(outlinePath, 'utf8'));

        // Recursively remove node and its children
        function removeNode(nodes, id) {
            const toRemove = new Set();
            function collect(nodes, id) {
                for (const n of nodes) {
                    if (n.id === id || n.parentId === id) {
                        toRemove.add(n.id);
                        collect(nodes, n.id);
                    }
                }
            }
            collect(nodes, id);
            return nodes.filter(n => !toRemove.has(n.id));
        }

        outline.nodes = removeNode(outline.nodes, req.params.id);
        fs.writeFileSync(outlinePath, JSON.stringify(outline, null, 2), 'utf8');

        res.json({ success: true });
    } catch (err) {
        console.error('[Outline] Delete error:', err);
        res.status(500).json({ error: err.message });
    }
});
