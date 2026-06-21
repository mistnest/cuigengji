import crypto from 'node:crypto';

const SUMMARY_EXTENSION_KEY = 'cuigengji';
const LEGACY_SUMMARY_EXTENSION_KEY = 'novel_ai_editor';
const CHAPTER_SUMMARY_CHARS = 420;

const SUMMARY_TYPES = {
    worldBook: {
        source: buildWorldBookSummarySource,
    },
    character: {
        source: buildCharacterSummarySource,
    },
    chapter: {
        source: buildChapterSummarySource,
    },
};

export function ensureWorldBookSummaries(worldBook = {}) {
    const entries = worldBook.entries || {};
    let changed = false;
    const nextEntries = {};

    for (const [uid, entry] of Object.entries(entries)) {
        const next = ensureWorldBookEntrySummary(entry);
        nextEntries[uid] = next.entry;
        if (next.changed) changed = true;
    }

    return {
        data: { ...worldBook, entries: nextEntries },
        changed,
    };
}

export function ensureCharacterSummaries(characters = []) {
    let changed = false;
    const data = (characters || []).map(character => {
        const next = ensureCharacterSummary(character);
        if (next.changed) changed = true;
        return next.character;
    });
    return { data, changed };
}

export function ensureChapterSummaries(chapters = []) {
    let changed = false;
    const data = (chapters || []).map(chapter => {
        const next = ensureChapterSummary(chapter);
        if (next.changed) changed = true;
        return next.chapter;
    });
    return { data, changed };
}

export function ensureWorldBookEntrySummary(entry = {}) {
    const next = ensureReferenceSummary('worldBook', entry);
    return { entry: next.item, changed: next.changed };
}

export function ensureCharacterSummary(character = {}) {
    const data = character.data || character;
    const next = ensureReferenceSummary('character', data);
    if (!next.changed) return { character, changed: false };

    if (character.data) {
        return {
            changed: true,
            character: {
                ...character,
                data: next.item,
            },
        };
    }

    return { changed: true, character: next.item };
}

export function ensureChapterSummary(chapter = {}) {
    if (chapter.type === 'volume') return { chapter, changed: false };
    const next = ensureReferenceSummary('chapter', chapter);
    return { chapter: next.item, changed: next.changed };
}

export function ensureReferenceSummary(type, item = {}) {
    const config = getSummaryConfig(type);
    const source = config.source(item);
    const sourceHash = hashText(source);
    const existing = readSummaryMeta(type, item);

    if (existing.aiSummary?.brief && existing.aiSummarySourceHash === sourceHash) {
        return writeSummaryMeta(type, item, {
            summary: existing.aiSummary.brief,
            summarySourceHash: sourceHash,
            summaryUpdatedAt: existing.summaryUpdatedAt || Date.now(),
            summaryGenerator: 'ai-v1',
            aiSummary: existing.aiSummary,
            aiSummarySourceHash: sourceHash,
        });
    }

    if (existing.summaryGenerator === 'ai-v1' && existing.summary && existing.summarySourceHash === sourceHash) {
        return { item, changed: false };
    }

    return { item, changed: false };
}

export function applyAiReferenceSummary(type, item = {}, aiSummary = {}) {
    const config = getSummaryConfig(type);
    const normalized = normalizeAiSummary(aiSummary);
    if (!normalized.brief) return { item, changed: false };

    const sourceHash = hashText(config.source(item));
    return writeSummaryMeta(type, item, {
        summary: normalized.brief,
        summarySourceHash: sourceHash,
        summaryUpdatedAt: Date.now(),
        summaryGenerator: 'ai-v1',
        aiSummary: normalized,
        aiSummarySourceHash: sourceHash,
    });
}

export function getWorldBookEntrySummary(entry = {}) {
    return getReferenceSummary('worldBook', entry);
}

export function getCharacterSummary(character = {}) {
    return getReferenceSummary('character', character.data || character);
}

export function getChapterSummary(chapter = {}) {
    return getReferenceSummary('chapter', chapter);
}

export function getReferenceSummary(type, item = {}) {
    const config = getSummaryConfig(type);
    const existing = readSummaryMeta(type, item);
    const sourceHash = hashText(config.source(item));
    if (existing.aiSummary?.brief && existing.aiSummarySourceHash === sourceHash) return existing.aiSummary.brief;
    if (existing.summaryGenerator === 'ai-v1' && existing.summary && existing.summarySourceHash === sourceHash) return existing.summary;
    if (existing.aiSummary?.brief) return existing.aiSummary.brief;
    if (existing.summary) return existing.summary;
    return '';
}

export function getReferenceSummarySourceHash(type, item = {}) {
    const config = getSummaryConfig(type);
    return hashText(config.source(item));
}

export function normalizeAiSummary(summary = {}) {
    if (typeof summary === 'string') {
        return {
            brief: compactLine(summary, CHAPTER_SUMMARY_CHARS),
            keyEvents: [],
            characters: [],
            worldFacts: [],
            openThreads: [],
            continuityNotes: [],
        };
    }

    return {
        brief: compactLine(summary.brief || summary.summary || '', CHAPTER_SUMMARY_CHARS),
        keyEvents: uniqueStrings(summary.keyEvents || summary.events || []).slice(0, 12),
        characters: uniqueStrings(summary.characters || []).slice(0, 20),
        worldFacts: uniqueStrings(summary.worldFacts || summary.facts || []).slice(0, 12),
        openThreads: uniqueStrings(summary.openThreads || summary.threads || []).slice(0, 12),
        continuityNotes: uniqueStrings(summary.continuityNotes || summary.notes || []).slice(0, 12),
    };
}

function getSummaryConfig(type) {
    const config = SUMMARY_TYPES[type];
    if (!config) throw new Error(`Unknown reference summary type: ${type}`);
    return config;
}

function readSummaryMeta(type, item = {}) {
    if (type === 'character') {
        return item.extensions?.[SUMMARY_EXTENSION_KEY]
            || item.extensions?.[LEGACY_SUMMARY_EXTENSION_KEY]
            || {};
    }
    return item;
}

function writeSummaryMeta(type, item = {}, meta = {}) {
    if (type === 'character') {
        const existing = item.extensions?.[SUMMARY_EXTENSION_KEY]
            || item.extensions?.[LEGACY_SUMMARY_EXTENSION_KEY]
            || {};
        const extensions = {
            ...(item.extensions || {}),
            [SUMMARY_EXTENSION_KEY]: {
                ...existing,
                ...meta,
            },
        };
        const next = { ...item, extensions };
        return { item: next, changed: JSON.stringify(next) !== JSON.stringify(item) };
    }

    const next = { ...item, ...meta };
    return { item: next, changed: JSON.stringify(next) !== JSON.stringify(item) };
}

function buildWorldBookSummarySource(entry = {}) {
    return [
        entry.comment || entry.name || '',
        Array.isArray(entry.key) && entry.key.length ? `关键词：${entry.key.join(', ')}` : '',
        entry.content || '',
    ].filter(Boolean).join('\n');
}

function buildCharacterSummarySource(data = {}) {
    const structured = [
        data.description ? `描述：${data.description}` : '',
        data.personality ? `性格：${data.personality}` : '',
        data.scenario ? `处境：${data.scenario}` : '',
        data.system_prompt ? `系统提示：${data.system_prompt}` : '',
        data.post_history_instructions ? `后置指令：${data.post_history_instructions}` : '',
    ].filter(Boolean);

    return [
        data.name && structured.length ? `姓名：${data.name}` : '',
        ...structured,
        !structured.length && data.first_mes ? data.first_mes : '',
    ].filter(Boolean).join('\n');
}

function buildChapterSummarySource(chapter = {}) {
    const cleanContent = cleanChapterTextForSummary(chapter.content || '');
    return [
        chapter.title ? `章节：${chapter.title}` : '',
        chapter.notes ? `备注：${chapter.notes}` : '',
        chapter.plotPoints?.length ? `情节点：${chapter.plotPoints.map(point =>
            typeof point === 'string' ? point : (point.title || point.description || JSON.stringify(point)),
        ).join(' / ')}` : '',
        cleanContent,
    ].filter(Boolean).join('\n');
}

function cleanChapterTextForSummary(text = '') {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !isImportedNoiseLine(line))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function isImportedNoiseLine(line = '') {
    const text = String(line || '').trim();
    if (!text) return true;
    if (/^={6,}$/.test(text) || /^-{6,}$/.test(text)) return true;
    return /知轩藏书|更多精校小说|zxcs8\.com|www\.zxcs8\.com|下载[:：]?http|精校小说尽在/i.test(text);
}

function compactLine(value = '', maxLen = 200) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function uniqueStrings(values = []) {
    return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function hashText(text = '') {
    return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}
