/**
 * Novel AI Editor — Import API
 * SillyTavern 数据导入
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import sanitize from 'sanitize-filename';
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
            hasEmbeddedWorldBook: !!(charData?.data?.character_book?.entries && Object.keys(charData.data.character_book.entries).length > 0),
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

// POST /api/import/batch — 批量导入
router.post('/batch', upload.array('files', 50), async (req, res) => {
    try {
        const results = { worldBooks: 0, characters: 0, presets: 0, errors: [] };

        for (const file of req.files) {
            try {
                const ext = path.extname(file.originalname).toLowerCase();
                const content = fs.readFileSync(file.path, 'utf8');

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
