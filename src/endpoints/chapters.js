/**
 * Novel AI Editor — Chapters API
 * 章节 CRUD 操作
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

// GET /api/chapters — List chapters for a novel
router.get('/', async (req, res) => {
    try {
        const { novelId } = req.query;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const novelDir = path.join(getUserDataDir(), 'novels', sanitize(novelId));
        const chaptersDir = path.join(novelDir, 'chapters');

        if (!fs.existsSync(chaptersDir)) {
            return res.json({ chapters: [] });
        }

        const files = fs.readdirSync(chaptersDir)
            .filter(f => f.endsWith('.json'))
            .sort();

        const chapters = [];
        for (const file of files) {
            const content = fs.readFileSync(path.join(chaptersDir, file), 'utf8');
            try {
                chapters.push(JSON.parse(content));
            } catch { /* skip invalid */ }
        }

        res.json({ chapters });
    } catch (err) {
        console.error('[Chapters] List error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/chapters — Create a new chapter
router.post('/', async (req, res) => {
    try {
        const { novelId, title, content, volumeId } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const novelDir = path.join(getUserDataDir(), 'novels', sanitize(novelId));
        const chaptersDir = path.join(novelDir, 'chapters');
        fs.mkdirSync(chaptersDir, { recursive: true });

        const chapter = {
            id: uuidv4(),
            novelId,
            volumeId: volumeId || '',
            title: title || '未命名章节',
            content: content || '',
            summary: '',
            wordCount: 0,
            status: 'draft',
            order: Date.now(),
            created: Date.now(),
            updated: Date.now(),
            notes: '',
            plotPoints: [],
        };

        const filename = sanitize(`${chapter.id}.json`);
        fs.writeFileSync(path.join(chaptersDir, filename), JSON.stringify(chapter, null, 2), 'utf8');

        res.status(201).json(chapter);
    } catch (err) {
        console.error('[Chapters] Create error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/chapters/:id — Get chapter by ID
router.get('/:id', async (req, res) => {
    try {
        const { novelId } = req.query;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const filename = sanitize(`${req.params.id}.json`);
        const filePath = path.join(getUserDataDir(), 'novels', sanitize(novelId), 'chapters', filename);

        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Chapter not found' });

        const content = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(content));
    } catch (err) {
        console.error('[Chapters] Get error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/chapters/:id — Update chapter
router.put('/:id', async (req, res) => {
    try {
        const { novelId, title, content, summary, status, notes, plotPoints } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const filename = sanitize(`${req.params.id}.json`);
        const filePath = path.join(getUserDataDir(), 'novels', sanitize(novelId), 'chapters', filename);

        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Chapter not found' });

        const chapter = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (title !== undefined) chapter.title = title;
        if (content !== undefined) {
            chapter.content = content;
            // Count words
            const chineseChars = (content.match(/[一-鿿]/g) || []).length;
            const otherWords = (content.match(/[a-zA-Z0-9]+/g) || []).length;
            chapter.wordCount = chineseChars + otherWords;
        }
        if (summary !== undefined) chapter.summary = summary;
        if (status !== undefined) chapter.status = status;
        if (notes !== undefined) chapter.notes = notes;
        if (plotPoints !== undefined) chapter.plotPoints = plotPoints;
        chapter.updated = Date.now();

        fs.writeFileSync(filePath, JSON.stringify(chapter, null, 2), 'utf8');
        res.json(chapter);
    } catch (err) {
        console.error('[Chapters] Update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/chapters/:id — Delete chapter
router.delete('/:id', async (req, res) => {
    try {
        const { novelId } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const filename = sanitize(`${req.params.id}.json`);
        const filePath = path.join(getUserDataDir(), 'novels', sanitize(novelId), 'chapters', filename);

        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Chapter not found' });

        // Move to backups instead of deleting
        const backupDir = path.join(getUserDataDir(), 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
        const backupFile = path.join(backupDir, `${req.params.id}_${Date.now()}.json`);
        fs.copyFileSync(filePath, backupFile);
        fs.unlinkSync(filePath);

        res.json({ success: true });
    } catch (err) {
        console.error('[Chapters] Delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/chapters/:id/summarize — AI生成章节摘要
router.post('/:id/summarize', async (req, res) => {
    // Will be implemented in Phase 3 with AI service integration
    res.status(501).json({ error: 'Not implemented yet' });
});
