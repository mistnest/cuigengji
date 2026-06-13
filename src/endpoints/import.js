/**
 * Novel AI Editor — Import API
 * SillyTavern 数据导入
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import sanitize from 'sanitize-filename';
import mammoth from 'mammoth';
import iconv from 'iconv-lite';
import jschardet from 'jschardet';
import multer from 'multer';

import { PROJECT_ROOT, getDataRoot } from '../config.js';
import { read as readPngCharCard } from '../character-card-parser.js';

export const router = express.Router();

const upload = multer({
    dest: path.join(getDataRoot(), '_uploads'),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
});

function getUserDataDir() {
    return getDataRoot();
}

// POST /api/import/worldbook — 导入世界书 JSON
router.post('/worldbook', async (req, res) => {
    try {
        const { name, data } = req.body;

        if (!data || !data.entries) {
            return res.status(400).json({ error: 'Invalid world book format: missing "entries"' });
        }

        const worldsDir = path.join(getUserDataDir(), 'worlds');
        fs.mkdirSync(worldsDir, { recursive: true });

        const filename = sanitize(name || 'imported_world') + '.json';
        const filePath = path.join(worldsDir, filename);

        // Ensure the data has proper structure
        const worldBook = {
            entries: data.entries || {},
        };

        fs.writeFileSync(filePath, JSON.stringify(worldBook, null, 2), 'utf8');

        res.json({
            success: true,
            name: filename,
            path: filePath,
            entryCount: Object.keys(worldBook.entries).length,
            entries: worldBook.entries,
        });
    } catch (err) {
        console.error('[Import] World book error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/import/character-png — 导入角色卡 PNG
router.post('/character-png', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Parse PNG character card using SillyTavern's parser
        const pngBuffer = fs.readFileSync(req.file.path);
        let charData;

        try {
            const rawData = readPngCharCard(new Uint8Array(pngBuffer));
            charData = JSON.parse(rawData);
        } catch (parseErr) {
            // If PNG parsing fails, try reading as plain JSON
            return res.status(400).json({ error: 'Invalid character card PNG: ' + parseErr.message });
        }

        // Save character data
        const charsDir = path.join(getUserDataDir(), 'characters');
        fs.mkdirSync(charsDir, { recursive: true });

        const charName = sanitize(charData.data?.name || req.file.originalname.replace('.png', ''));
        const jsonFilename = `${charName}.json`;
        const jsonPath = path.join(charsDir, jsonFilename);

        // Save JSON
        fs.writeFileSync(jsonPath, JSON.stringify(charData, null, 2), 'utf8');

        // Also save PNG as avatar/thumbnail
        const pngFilename = `${charName}.png`;
        const pngPath = path.join(charsDir, pngFilename);
        fs.copyFileSync(req.file.path, pngPath);

        // Clean up multer temp file
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            name: charName,
            data: charData,
            jsonPath: jsonPath,
            pngPath: pngPath,
            hasEmbeddedWorldBook: hasEmbeddedWorldBook(charData),
        });
    } catch (err) {
        console.error('[Import] Character PNG error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/import/character-json — 导入角色卡 JSON
router.post('/character-json', async (req, res) => {
    try {
        const { data } = req.body;

        if (!data) {
            return res.status(400).json({ error: 'No character data provided' });
        }

        const charsDir = path.join(getUserDataDir(), 'characters');
        fs.mkdirSync(charsDir, { recursive: true });

        const charName = sanitize(data.data?.name || data.name || 'imported_character');
        const filename = `${charName}.json`;
        const filePath = path.join(charsDir, filename);

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

        res.json({
            success: true,
            name: charName,
            data: data,
            path: filePath,
            hasEmbeddedWorldBook: hasEmbeddedWorldBook(data),
        });
    } catch (err) {
        console.error('[Import] Character JSON error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/import/preset — 导入预设 JSON
router.post('/preset', async (req, res) => {
    try {
        const { name, data } = req.body;

        if (!data) {
            return res.status(400).json({ error: 'No preset data provided' });
        }

        const presetsDir = path.join(getUserDataDir(), 'presets');
        fs.mkdirSync(presetsDir, { recursive: true });

        const filename = sanitize(name || 'imported_preset') + '.json';
        const filePath = path.join(presetsDir, filename);

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

        res.json({
            success: true,
            name: filename,
            data: data,
            path: filePath,
        });
    } catch (err) {
        console.error('[Import] Preset error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/import/document — 导入 TXT/DOCX 文件为章节
router.post('/document', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file' });
        const { novelId, volumeId, autoSplit } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId required' });

        let text = '';
        const ext = path.extname(req.file.originalname).toLowerCase();

        if (ext === '.docx') {
            const result = await mammoth.extractRawText({ path: req.file.path });
            text = result.value;
        } else {
            text = readTextFile(req.file.path);
        }

        fs.unlinkSync(req.file.path); // Clean up temp

        if (!text.trim()) return res.status(400).json({ error: 'File is empty' });

        const chapters = [];
        const chaptersDir = path.join(getDataRoot(), 'novels', sanitize(novelId), 'chapters');

        if (autoSplit === 'true') {
            // Split by chapter markers: "第X章", "Chapter X", "第X卷", etc.
            const parts = text.split(/(?=第[一二三四五六七八九十百千\d]+[章卷节回篇])|(?=Chapter\s+\d+)|(?=CHAPTER\s+\d+)/i);
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i].trim();
                if (!part) continue;
                const titleMatch = part.match(/^(第[一二三四五六七八九十百千\d]+[章卷节回篇]|Chapter\s+\d+|CHAPTER\s+\d+).*/);
                const title = titleMatch ? titleMatch[0].substring(0, 50).replace(/[^\w一-鿿\s]/g, '').trim() : `第${chapters.length + 1}章`;
                const content = part.replace(/^.+[\r\n]+/, '').trim(); // Remove first line (title) from content
                const chapter = {
                    id: uuidv4(), novelId, title, content, status: 'draft', wordCount: countWords(content),
                    created: Date.now(), updated: Date.now(), order: chapters.length,
                };
                chapters.push(chapter);
                const filename = sanitize(`${String(chapters.length).padStart(3, '0')}-${title}`) + '.json';
                let targetDir = chaptersDir;
                if (volumeId) { targetDir = path.join(chaptersDir, sanitize(volumeId)); }
                fs.mkdirSync(targetDir, { recursive: true });
                fs.writeFileSync(path.join(targetDir, filename), JSON.stringify(chapter, null, 2), 'utf8');
            }
        } else {
            // Single chapter import
            const title = req.file.originalname.replace(ext, '').substring(0, 50);
            const chapter = {
                id: uuidv4(), novelId, title, content: text, status: 'draft', wordCount: countWords(text),
                created: Date.now(), updated: Date.now(), order: 0,
            };
            chapters.push(chapter);
            let targetDir = chaptersDir;
            if (volumeId) { targetDir = path.join(chaptersDir, sanitize(volumeId)); }
            fs.mkdirSync(targetDir, { recursive: true });
            const filename = sanitize(`001-${title}`) + '.json';
            fs.writeFileSync(path.join(targetDir, filename), JSON.stringify(chapter, null, 2), 'utf8');
        }

        res.json({ success: true, chapters, count: chapters.length });
    } catch (err) {
        console.error('[Import] Document error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/import/folder — 导入文件夹结构（卷=文件夹，章=文件）
router.post('/folder', upload.array('files', 200), async (req, res) => {
    try {
        const { novelId } = req.body;
        if (!novelId) return res.status(400).json({ error: 'novelId required' });
        const chaptersDir = path.join(getDataRoot(), 'novels', sanitize(novelId), 'chapters');
        const results = { volumes: 0, chapters: 0, errors: [] };

        for (const file of req.files) {
            try {
                const ext = path.extname(file.originalname).toLowerCase();
                if (!['.txt', '.docx', '.json'].includes(ext)) continue;

                let text = '';
                if (ext === '.docx') {
                    const result = await mammoth.extractRawText({ path: file.path });
                    text = result.value;
                } else {
                    text = readTextFile(file.path);
                }
                if (!text.trim()) continue;

                const relPath = file.originalname.replace(/\\/g, '/');
                const parts = relPath.split('/');
                let volumeId = '';
                let targetDir = chaptersDir;

                // If file is inside subfolders, create volumes
                if (parts.length > 1) {
                    const volName = parts[0];
                    volumeId = `vol_${volName}`;
                    targetDir = path.join(chaptersDir, sanitize(volName));
                    if (!fs.existsSync(targetDir)) { fs.mkdirSync(targetDir, { recursive: true }); results.volumes++; }
                }

                const title = path.basename(parts[parts.length - 1], ext).substring(0, 50);
                const chapter = {
                    id: uuidv4(), novelId, title, content: text, status: 'draft', wordCount: countWords(text),
                    created: Date.now(), updated: Date.now(), order: results.chapters,
                };
                fs.mkdirSync(targetDir, { recursive: true });
                const filename = sanitize(`${String(results.chapters + 1).padStart(3, '0')}-${title}`) + '.json';
                fs.writeFileSync(path.join(targetDir, filename), JSON.stringify(chapter, null, 2), 'utf8');
                results.chapters++;
            } catch (e) {
                results.errors.push(`${file.originalname}: ${e.message}`);
            }
        }

        // Clean up temp files
        req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });

        res.json({ success: true, results });
    } catch (err) {
        console.error('[Import] Folder error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Auto-detect encoding and read file as UTF-8 text
function readTextFile(filePath) {
    const buffer = fs.readFileSync(filePath);

    // UTF-8 is the modern default. Decode it strictly before asking a
    // heuristic detector, which can misclassify short Chinese UTF-8 files.
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
    } catch { /* continue with legacy encodings */ }

    // Use jschardet to guess encoding
    const detected = jschardet.detect(buffer);
    if (detected.encoding && detected.encoding !== 'UTF-8' && detected.confidence > 0.7) {
        try {
            return iconv.decode(buffer, detected.encoding);
        } catch { /* fallback */ }
    }
    // Try GBK (most common for Chinese text files)
    try {
        const gbk = iconv.decode(buffer, 'gbk');
        // Check if it looks like valid Chinese text
        const chineseRatio = (gbk.match(/[一-鿿]/g) || []).length / Math.max(gbk.length, 1);
        if (chineseRatio > 0.05) return gbk;
    } catch { /* fallback */ }
    // Fallback: return UTF-8, strip BOM
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function countWords(text) {
    const chinese = (text.match(/[一-鿿]/g) || []).length;
    const other = (text.match(/[a-zA-Z0-9]+/g) || []).length;
    return chinese + other;
}

function hasEmbeddedWorldBook(character) {
    const book = character?.data?.character_book
        || character?.character_book
        || character?.data?.data?.character_book;
    const entries = book?.entries;
    if (!entries) return false;
    return Array.isArray(entries) ? entries.length > 0 : Object.keys(entries).length > 0;
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// POST /api/import/batch — 批量导入
router.post('/batch', upload.array('files', 50), async (req, res) => {
    try {
        const results = { worldBooks: 0, characters: 0, presets: 0, errors: [] };

        for (const file of req.files) {
            try {
                const ext = path.extname(file.originalname).toLowerCase();
                const content = readTextFile(file.path);

                if (file.originalname.includes('world') || ext === '.json' && content.includes('"entries"')) {
                    const data = JSON.parse(content);
                    if (data.entries) {
                        const worldsDir = path.join(getUserDataDir(), 'worlds');
                        fs.mkdirSync(worldsDir, { recursive: true });
                        const filename = sanitize(file.originalname);
                        fs.writeFileSync(path.join(worldsDir, filename), JSON.stringify(data, null, 2));
                        results.worldBooks++;
                        continue;
                    }
                }

                if (ext === '.png') {
                    const pngBuffer = fs.readFileSync(file.path);
                    const rawData = readPngCharCard(new Uint8Array(pngBuffer));
                    const charData = JSON.parse(rawData);
                    const charsDir = path.join(getUserDataDir(), 'characters');
                    fs.mkdirSync(charsDir, { recursive: true });
                    const charName = sanitize(charData.data?.name || file.originalname.replace('.png', ''));
                    fs.writeFileSync(path.join(charsDir, `${charName}.json`), JSON.stringify(charData, null, 2));
                    fs.copyFileSync(file.path, path.join(charsDir, `${charName}.png`));
                    results.characters++;
                    continue;
                }

                // Try as preset
                const data = JSON.parse(content);
                if (data.temperature !== undefined || data.max_tokens !== undefined) {
                    const presetsDir = path.join(getUserDataDir(), 'presets');
                    fs.mkdirSync(presetsDir, { recursive: true });
                    fs.writeFileSync(path.join(presetsDir, sanitize(file.originalname)), JSON.stringify(data, null, 2));
                    results.presets++;
                    continue;
                }
            } catch (e) {
                results.errors.push(`${file.originalname}: ${e.message}`);
            }
        }

        // Clean up temp files
        for (const file of req.files) {
            try { fs.unlinkSync(file.path); } catch {}
        }

        res.json({ success: true, results });
    } catch (err) {
        console.error('[Import] Batch error:', err);
        res.status(500).json({ error: err.message });
    }
});
