/**
 * Novel AI Editor — Chapters API
 * 卷 = 文件夹，章 = JSON 文件
 *  data/novels/<novelId>/chapters/
 *   ├── 第一卷/
 *   │   ├── 001-第一章.json
 *   │   └── 002-第二章.json
 *   └── 第二卷/
 *       └── 003-第三章.json
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import sanitize from 'sanitize-filename';
import { v4 as uuidv4 } from 'uuid';
import { getDataRoot } from '../config.js';

export const router = express.Router();

function chaptersDir(novelId) {
    return path.join(getDataRoot(), 'novels', sanitize(novelId), 'chapters');
}

// GET /api/chapters?novelId=xxx — List all volumes and chapters
router.get('/', async (req, res) => {
    try {
        const { novelId } = req.query;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const root = chaptersDir(novelId);
        const items = [];

        if (fs.existsSync(root)) {
            const entries = fs.readdirSync(root, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const volId = `vol_${entry.name}`;
                    items.push({ id: volId, novelId, type: 'volume', title: entry.name, volumeId: '', order: 0 });
                    const chFiles = fs.readdirSync(path.join(root, entry.name)).filter(f => f.endsWith('.json')).sort();
                    for (const f of chFiles) {
                        try {
                            const d = JSON.parse(fs.readFileSync(path.join(root, entry.name, f), 'utf8'));
                            items.push(lightChapter(d, volId));
                        } catch {}
                    }
                } else if (entry.isFile() && entry.name.endsWith('.json')) {
                    if (entry.name.startsWith('vol_')) {
                        try {
                            const d = JSON.parse(fs.readFileSync(path.join(root, entry.name), 'utf8'));
                            items.push({ id: d.id, novelId, type: 'volume', title: d.title, volumeId: '', order: 0 });
                        } catch {}
                    } else {
                        try {
                            const d = JSON.parse(fs.readFileSync(path.join(root, entry.name), 'utf8'));
                            items.push(lightChapter(d, ''));
                        } catch {}
                    }
                }
            }
        }

        const volumes = items
            .filter(item => item.type === 'volume')
            .sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || a.title.localeCompare(b.title, 'zh-CN'));
        const chapters = items.filter(item => item.type !== 'volume');
        const sortChapters = (a, b) =>
            Number(a.order || 0) - Number(b.order || 0)
            || Number(a.created || 0) - Number(b.created || 0)
            || a.title.localeCompare(b.title, 'zh-CN');
        const ordered = [];
        for (const volume of volumes) {
            ordered.push(volume);
            ordered.push(...chapters.filter(chapter => chapter.volumeId === volume.id).sort(sortChapters));
        }
        ordered.push(...chapters.filter(chapter => !chapter.volumeId).sort(sortChapters));

        res.json({ chapters: ordered });
    } catch (err) {
        console.error('[Chapters] List error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/chapters — Create volume or chapter
// GET /api/chapters/:id — Load full chapter content
router.get('/:id', async (req, res) => {
    try {
        const { novelId } = req.query;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });
        const root = chaptersDir(novelId);
        const found = findChapterFile(root, req.params.id);
        if (!found) return res.status(404).json({ error: 'Not found' });
        res.json(found.data);
    } catch (err) {
        console.error('[Chapters] Get error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { novelId, title, type, volumeId, content = '' } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const root = chaptersDir(novelId);

        if (type === 'volume') {
            // Create volume folder
            const volName = sanitize(title || '未命名卷');
            const volPath = path.join(root, volName);
            if (!fs.existsSync(volPath)) fs.mkdirSync(volPath, { recursive: true });

            return res.status(201).json({
                id: `vol_${volName}`,
                novelId,
                type: 'volume',
                title: title || '未命名卷',
                volumeId: '',
                order: 0,
            });
        }

        // Create chapter file
        const chapter = {
            id: uuidv4(),
            novelId,
            title: title || '未命名章节',
            content,
            status: 'draft',
            wordCount: countWords(content),
            created: Date.now(),
            updated: Date.now(),
            notes: '',
            plotPoints: [],
            order: 0,
        };

        let targetDir = root;
        if (volumeId && volumeId.startsWith('vol_')) {
            const volName = volumeId.replace('vol_', '');
            targetDir = path.join(root, volName);
        }
        fs.mkdirSync(targetDir, { recursive: true });

        // Filename: orderIndex-title.json
        const existing = fs.readdirSync(targetDir).filter(f => f.endsWith('.json'));
        const prefix = String(existing.length + 1).padStart(3, '0');
        const filename = sanitize(`${prefix}-${chapter.title}`) + '.json';
        fs.writeFileSync(path.join(targetDir, filename), JSON.stringify(chapter, null, 2), 'utf8');

        chapter.volumeId = volumeId || '';
        res.status(201).json(chapter);
    } catch (err) {
        console.error('[Chapters] Create error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/chapters/:id — Update chapter (content, title, move between volumes)
router.put('/:id', async (req, res) => {
    try {
        const { novelId, title, content, volumeId, order } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const root = chaptersDir(novelId);
        const found = findChapterFile(root, req.params.id);
        if (!found) return res.status(404).json({ error: 'Chapter not found' });

        const chapter = JSON.parse(fs.readFileSync(found.path, 'utf8'));

        if (title !== undefined) chapter.title = title;
        if (content !== undefined) {
            chapter.content = content;
            const chinese = (content.match(/[一-鿿]/g) || []).length;
            const other = (content.match(/[a-zA-Z0-9]+/g) || []).length;
            chapter.wordCount = chinese + other;
        }
        chapter.updated = Date.now();

        // Handle volume change (move file)
        if (volumeId !== undefined) {
            const newVolId = volumeId || '';
            chapter.volumeId = newVolId;
            let targetDir = root;
            if (newVolId && newVolId.startsWith('vol_')) {
                const volName = newVolId.replace('vol_', '');
                targetDir = path.join(root, volName);
            }
            fs.mkdirSync(targetDir, { recursive: true });

            const newPath = getUniquePath(path.join(targetDir, path.basename(found.path)), found.path);
            if (found.path !== newPath) {
                fs.renameSync(found.path, newPath);
                found.path = newPath;
            }
        }

        if (order !== undefined) chapter.order = order;
        fs.writeFileSync(found.path, JSON.stringify(chapter, null, 2), 'utf8');
        chapter.volumeId = volumeId || chapter.volumeId || '';
        res.json(chapter);
    } catch (err) {
        console.error('[Chapters] Update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/chapters/:id — Delete chapter or volume
router.delete('/:id', async (req, res) => {
    try {
        const { novelId } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId is required' });

        const root = chaptersDir(novelId);

        // Check if it's a volume
        if (req.params.id.startsWith('vol_')) {
            const volName = req.params.id.replace('vol_', '');
            const volPath = path.join(root, volName);
            if (fs.existsSync(volPath)) {
                for (const file of fs.readdirSync(volPath)) {
                    const source = path.join(volPath, file);
                    if (!fs.statSync(source).isFile()) continue;
                    const target = getUniquePath(path.join(root, file), source);
                    fs.renameSync(source, target);
                    if (target.endsWith('.json')) {
                        try {
                            const chapter = JSON.parse(fs.readFileSync(target, 'utf8'));
                            chapter.volumeId = '';
                            fs.writeFileSync(target, JSON.stringify(chapter, null, 2), 'utf8');
                        } catch {}
                    }
                }
                fs.rmSync(volPath, { recursive: true, force: true });
                return res.json({ success: true });
            }
        }

        // It's a chapter — find it
        const found = findChapterFile(root, req.params.id);
        if (!found) return res.status(404).json({ error: 'Chapter not found' });

        // Backup
        const backupDir = path.join(getDataRoot(), 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(found.path, path.join(backupDir, `${req.params.id}_${Date.now()}.json`));
        fs.unlinkSync(found.path);

        res.json({ success: true });
    } catch (err) {
        console.error('[Chapters] Delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== Helpers ====================

// Return only metadata (no content) for list view — much faster
function lightChapter(d, volumeId) {
    return {
        id: d.id, novelId: d.novelId, type: d.type || 'chapter', title: d.title,
        volumeId, wordCount: d.wordCount || 0, status: d.status || 'draft',
        order: d.order || 0, created: d.created, updated: d.updated,
    };
}

function findChapterFile(rootDir, id) {
    function search(dir) {
        if (!fs.existsSync(dir)) return null;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                const found = search(full);
                if (found) return found;
            } else if (e.isFile() && e.name.endsWith('.json')) {
                try {
                    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
                    if (data.id === id) return { path: full, data };
                } catch { /* skip */ }
            }
        }
        return null;
    }
    return search(rootDir);
}

function getUniquePath(targetPath, currentPath) {
    if (path.resolve(targetPath) === path.resolve(currentPath)) return targetPath;
    if (!fs.existsSync(targetPath)) return targetPath;

    const parsed = path.parse(targetPath);
    for (let i = 2; i < 1000; i += 1) {
        const candidate = path.join(parsed.dir, `${parsed.name}-${i}${parsed.ext}`);
        if (!fs.existsSync(candidate)) return candidate;
    }
    return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
}

function countWords(content = '') {
    const chinese = (content.match(/[\u3400-\u9fff]/g) || []).length;
    const other = (content.match(/[a-zA-Z0-9]+/g) || []).length;
    return chinese + other;
}
