import fs from 'node:fs/promises';
import path from 'node:path';

import iconv from 'iconv-lite';
import jschardet from 'jschardet';
import mammoth from 'mammoth';
import sanitize from 'sanitize-filename';

import { read as readPngCharCard } from './character-card/character-card-parser.js';
import { AppError, projectFile, requireString } from '../../../foundation/platform/index.js';
import { createChapter } from '../../../domains/project/index.js';
import {
    ensureCharacterSummaries,
    ensureWorldBookSummaries,
    saveCharacter,
    saveWorldBook,
} from '../../../domains/knowledge/index.js';
import {
    migrateAiConfigSecrets,
    savePreset,
    sanitizePresetSecrets,
} from '../../../foundation/configuration/index.js';

export async function importWorldBookData(projectId, name, data, options = {}) {
    requireProjectId(projectId);
    if (!data?.entries) throw validationError('Invalid world book format: missing entries');
    const sourceName = sanitize(name || 'imported_world') || 'imported_world';
    const worldBook = ensureWorldBookSummaries(normalizeWorldBookData(data)).data;
    applyWorldBookFolder(worldBook, sourceName);
    await saveWorldBook(projectId, sourceName, worldBook, { actor: options.actor });
    return {
        success: true,
        name: `${sourceName}.json`,
        entryCount: Object.keys(worldBook.entries || {}).length,
        entries: worldBook.entries || {},
    };
}

export async function importWorldBookFile(projectId, filePath, options = {}) {
    const data = JSON.parse(await readTextFile(filePath));
    return importWorldBookData(
        projectId,
        path.basename(filePath, path.extname(filePath)),
        data,
        options,
    );
}

export async function importCharacterData(projectId, data, options = {}) {
    requireProjectId(projectId);
    if (!data) throw validationError('No character data provided');
    const character = ensureCharacterSummaries([normalizeCharacterData(data)]).data[0];
    const saved = await saveCharacter(projectId, character, { actor: options.actor });
    return {
        success: true,
        name: saved.name,
        data: character,
        character,
        hasEmbeddedWorldBook: hasEmbeddedWorldBook(character),
    };
}

export async function importCharacterFile(projectId, filePath, options = {}) {
    const extension = path.extname(options.originalName || filePath).toLowerCase();
    if (extension === '.json') {
        return importCharacterData(projectId, JSON.parse(await readTextFile(filePath)), options);
    }
    if (extension !== '.png') throw validationError('Only PNG and JSON character cards are supported');

    const pngBuffer = await fs.readFile(filePath);
    let data;
    try {
        data = JSON.parse(readPngCharCard(new Uint8Array(pngBuffer)));
    } catch (error) {
        throw new AppError('VALIDATION_ERROR', `Invalid character card PNG: ${error.message}`, {
            status: 400,
            publicMessage: '角色卡 PNG 无效或不包含可读取的数据。',
        });
    }
    const result = await importCharacterData(projectId, data, options);
    const avatarPath = projectFile(
        projectId,
        'assets',
        'characters',
        `${sanitize(result.name) || 'character'}.png`,
    );
    await fs.mkdir(path.dirname(avatarPath), { recursive: true });
    await fs.copyFile(filePath, avatarPath);
    return result;
}

export async function importPresetData(projectId, name, data, options = {}) {
    requireProjectId(projectId);
    if (!data || typeof data !== 'object') throw validationError('No preset data provided');
    const safeName = sanitize(name || data.name || 'imported_preset') || 'imported_preset';
    const provider = data.provider || providerFromImportedPreset(data.chat_completion_source);
    migrateAiConfigSecrets({
        ...data,
        provider,
    }, safeName);
    const sanitized = sanitizePresetSecrets(data);
    await savePreset(projectId, safeName, sanitized, {
        expectedRevision: options.expectedRevision,
        expectedContentHash: options.expectedContentHash,
        actor: options.actor,
    });
    return { success: true, name: `${safeName}.json`, data: sanitized };
}

function providerFromImportedPreset(source) {
    return {
        claude: 'anthropic',
        makersuite: 'google',
        openai: 'openai',
    }[source] || source || '';
}

export async function importPresetFile(projectId, filePath, options = {}) {
    return importPresetData(
        projectId,
        path.basename(filePath, path.extname(filePath)),
        JSON.parse(await readTextFile(filePath)),
        options,
    );
}

export async function importDocumentFile(projectId, filePath, options = {}) {
    requireProjectId(projectId);
    const sourceName = options.originalName || filePath;
    const extension = path.extname(sourceName).toLowerCase();
    const text = extension === '.docx'
        ? (await mammoth.extractRawText({ path: filePath })).value
        : await readTextFile(filePath);
    if (!text.trim()) throw validationError('File is empty');

    const parts = options.autoSplit === false
        ? [{ title: path.basename(sourceName, extension).slice(0, 50), content: text.trim() }]
        : splitTextIntoChapters(text);
    const chapters = [];
    for (const part of parts) {
        if (!part.content.trim()) continue;
        chapters.push(await createChapter(projectId, {
            title: part.title || `第 ${chapters.length + 1} 章`,
            content: part.content.trim(),
            volumeId: options.volumeId || '',
            order: chapters.length,
            actor: options.actor,
        }));
    }
    return { success: true, chapters, count: chapters.length };
}

export async function importFolder(projectId, folderPath, options = {}) {
    requireProjectId(projectId);
    const files = await listSupportedDocuments(folderPath);
    const results = { volumes: 0, chapters: 0, errors: [] };
    const volumeIds = new Map();
    for (const filePath of files) {
        try {
            const relative = path.relative(folderPath, filePath);
            const segments = relative.split(path.sep);
            let volumeId = '';
            if (segments.length > 1) {
                const volumeName = segments[0];
                if (!volumeIds.has(volumeName)) {
                    const volume = await createChapter(projectId, {
                        type: 'volume', title: volumeName, actor: options.actor,
                    });
                    volumeIds.set(volumeName, volume.id);
                    results.volumes += 1;
                }
                volumeId = volumeIds.get(volumeName);
            }
            const imported = await importDocumentFile(projectId, filePath, {
                autoSplit: false,
                volumeId,
                actor: options.actor,
            });
            results.chapters += imported.count;
        } catch (error) {
            results.errors.push(`${path.basename(filePath)}: ${error.message}`);
        }
    }
    return { success: true, results };
}

async function listSupportedDocuments(root) {
    const files = [];
    const visit = async dir => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const target = path.join(dir, entry.name);
            if (entry.isDirectory()) await visit(target);
            else if (entry.isFile() && ['.txt', '.docx'].includes(path.extname(entry.name).toLowerCase())) {
                files.push(target);
            }
        }
    };
    await visit(root);
    return files.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function splitTextIntoChapters(text = '') {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const headings = [];
    let offset = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (isChapterHeading(trimmed)) {
            headings.push({ title: normalizeChapterTitle(trimmed), start: offset, lineLength: line.length });
        }
        offset += line.length + 1;
    }
    if (!headings.length) return [{ title: '', content: normalized.trim() }];

    const parts = [];
    const preface = normalized.slice(0, headings[0].start).trim();
    if (preface) parts.push({ title: '导入前言', content: preface });
    for (let index = 0; index < headings.length; index += 1) {
        const current = headings[index];
        const next = headings[index + 1];
        const titleLineEnd = current.start + current.lineLength;
        const contentStart = normalized[titleLineEnd] === '\n' ? titleLineEnd + 1 : titleLineEnd;
        parts.push({
            title: current.title,
            content: normalized.slice(contentStart, next ? next.start : normalized.length).trim(),
        });
    }
    return parts;
}

function isChapterHeading(line = '') {
    const title = normalizeChapterTitle(line);
    if (!title || title.length > 48 || /[。！？；?!;]/.test(title)) return false;
    const marker = '(?:第?[0-9一二三四五六七八九十百千万零〇两]+[章节回卷篇]|Chapter\\s+\\d+)';
    if (!new RegExp(`^${marker}`, 'i').test(title)) return false;
    const match = title.match(new RegExp(`^(${marker})(.*)$`, 'i'));
    const suffix = (match?.[2] || '').trim();
    if (!suffix) return true;
    if (/^[的了着过]/.test(suffix) && title.length > 18) return false;
    if (/^[：:、.．\-—\s　]/.test(match?.[2] || '')) return true;
    return title.length <= 18;
}

function normalizeChapterTitle(line = '') {
    return String(line || '')
        .replace(/^[\s　#*【《<]+/, '')
        .replace(/[\s　】》>]*$/, '')
        .trim();
}

async function readTextFile(filePath) {
    const buffer = await fs.readFile(filePath);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
    } catch { /* continue with legacy encodings */ }
    const detected = jschardet.detect(buffer);
    if (detected.encoding && detected.encoding !== 'UTF-8' && detected.confidence > 0.7) {
        try { return iconv.decode(buffer, detected.encoding); } catch { /* fallback */ }
    }
    try {
        const gbk = iconv.decode(buffer, 'gbk');
        const chineseRatio = (gbk.match(/[一-鿿]/g) || []).length / Math.max(gbk.length, 1);
        if (chineseRatio > 0.05) return gbk;
    } catch { /* fallback */ }
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function normalizeEnabledDisabled(target = {}) {
    const disabled = target.disable === true || target.disabled === true || target.enabled === false;
    return { ...target, disable: disabled, disabled, enabled: !disabled };
}

function normalizeWorldBookData(data = {}) {
    return { ...data, entries: normalizeWorldBookEntries(data.entries || {}) };
}

function normalizeWorldBookEntries(entries = {}) {
    const pairs = Array.isArray(entries) ? entries.map((entry, index) => [entry?.uid ?? index, entry]) : Object.entries(entries);
    return Object.fromEntries(pairs.map(([key, entry], index) => [key, normalizeWorldBookEntry(entry, index)]));
}

function normalizeWorldBookEntry(entry = {}, index = 0) {
    const normalized = normalizeEnabledDisabled(entry || {});
    return {
        ...normalized,
        uid: normalized.uid ?? index,
        key: Array.isArray(normalized.key)
            ? normalized.key
            : Array.isArray(normalized.keys) ? normalized.keys : [normalized.key].filter(Boolean),
        keysecondary: Array.isArray(normalized.keysecondary) ? normalized.keysecondary : [],
        content: normalized.content || '',
        comment: normalized.comment || normalized.name || '',
        selective: normalized.selective !== false,
    };
}

function applyWorldBookFolder(worldBook = {}, folder = '') {
    const targetFolder = String(folder || '').trim();
    for (const entry of Object.values(worldBook.entries || {})) {
        if (entry.group && !entry.sourceGroup) entry.sourceGroup = entry.group;
        entry.folder = entry.folder || entry._folder || targetFolder;
        entry._folder = entry.folder;
    }
    if (targetFolder) worldBook.folders = [...new Set([...(worldBook.folders || []), targetFolder])];
    return worldBook;
}

function normalizeCharacterData(character = {}) {
    const normalized = normalizeEnabledDisabled(character || {});
    const data = normalizeEnabledDisabled(normalized.data || normalized);
    const charBook = data.character_book || normalized.character_book;
    if (charBook?.entries) data.character_book = { ...charBook, entries: normalizeWorldBookEntries(charBook.entries) };
    return {
        ...normalized,
        data,
        disable: data.disable || normalized.disable,
        disabled: data.disabled || normalized.disabled,
        enabled: !(data.disabled || normalized.disabled),
    };
}

function hasEmbeddedWorldBook(character) {
    const book = character?.data?.character_book || character?.character_book || character?.data?.data?.character_book;
    const entries = book?.entries;
    return Boolean(entries && (Array.isArray(entries) ? entries.length : Object.keys(entries).length));
}

function requireProjectId(value) {
    return requireString(value, 'projectId', { maxLength: 100 });
}

function validationError(message) {
    return new AppError('VALIDATION_ERROR', message, { status: 400 });
}
