import crypto from 'node:crypto';

const SUMMARY_EXTENSION_KEY = 'novel_ai_editor';
const DEFAULT_SUMMARY_CHARS = 260;

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

export function ensureChapterSummary(chapter = {}) {
    if (chapter.type === 'volume') return { chapter, changed: false };
    const source = buildChapterSummarySource(chapter);
    const sourceHash = hashText(source);
    if (chapter.summary && chapter.summarySourceHash === sourceHash) {
        return { chapter, changed: false };
    }
    return {
        changed: true,
        chapter: {
            ...chapter,
            summary: summarizeText(source, 420),
            summarySourceHash: sourceHash,
            summaryUpdatedAt: Date.now(),
            summaryGenerator: 'local-v1',
        },
    };
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
    const source = buildWorldBookSummarySource(entry);
    const sourceHash = hashText(source);
    if (entry.summary && entry.summarySourceHash === sourceHash) {
        return { entry, changed: false };
    }
    return {
        changed: true,
        entry: {
            ...entry,
            summary: summarizeText(source, DEFAULT_SUMMARY_CHARS),
            summarySourceHash: sourceHash,
            summaryUpdatedAt: Date.now(),
            summaryGenerator: 'local-v1',
        },
    };
}

export function ensureCharacterSummary(character = {}) {
    const data = character.data || character;
    const source = buildCharacterSummarySource(data);
    const sourceHash = hashText(source);
    const extensions = { ...(data.extensions || {}) };
    const existing = extensions[SUMMARY_EXTENSION_KEY] || {};
    if (existing.summary && existing.summarySourceHash === sourceHash) {
        return { character, changed: false };
    }

    extensions[SUMMARY_EXTENSION_KEY] = {
        ...existing,
        summary: summarizeText(source, DEFAULT_SUMMARY_CHARS),
        summarySourceHash: sourceHash,
        summaryUpdatedAt: Date.now(),
        summaryGenerator: 'local-v1',
    };

    if (character.data) {
        return {
            changed: true,
            character: {
                ...character,
                data: {
                    ...data,
                    extensions,
                },
            },
        };
    }

    return {
        changed: true,
        character: {
            ...character,
            extensions,
        },
    };
}

export function getWorldBookEntrySummary(entry = {}) {
    return entry.summary || summarizeText(buildWorldBookSummarySource(entry), DEFAULT_SUMMARY_CHARS);
}

export function getCharacterSummary(character = {}) {
    const data = character.data || character;
    return data.extensions?.[SUMMARY_EXTENSION_KEY]?.summary
        || summarizeText(buildCharacterSummarySource(data), DEFAULT_SUMMARY_CHARS);
}

export function getChapterSummary(chapter = {}) {
    return chapter.summary || summarizeText(buildChapterSummarySource(chapter), 420);
}

function buildWorldBookSummarySource(entry = {}) {
    return [
        entry.comment || entry.name || '',
        Array.isArray(entry.key) && entry.key.length ? `Keywords: ${entry.key.join(', ')}` : '',
        entry.content || '',
    ].filter(Boolean).join('\n');
}

function buildCharacterSummarySource(data = {}) {
    const structured = [
        data.description ? `Description: ${data.description}` : '',
        data.personality ? `Personality: ${data.personality}` : '',
        data.scenario ? `Scenario: ${data.scenario}` : '',
        data.system_prompt ? `System prompt: ${data.system_prompt}` : '',
        data.post_history_instructions ? `Post-history instructions: ${data.post_history_instructions}` : '',
    ].filter(Boolean);

    return [
        data.name && structured.length ? `Name: ${data.name}` : '',
        ...structured,
        !structured.length && data.first_mes ? data.first_mes : '',
    ].filter(Boolean).join('\n');
}

function buildChapterSummarySource(chapter = {}) {
    return [
        chapter.title ? `Title: ${chapter.title}` : '',
        chapter.notes ? `Notes: ${chapter.notes}` : '',
        chapter.plotPoints?.length ? `Plot points: ${chapter.plotPoints.map(point =>
            typeof point === 'string' ? point : (point.title || point.description || JSON.stringify(point)),
        ).join(' / ')}` : '',
        chapter.content ? `Content: ${chapter.content}` : '',
    ].filter(Boolean).join('\n');
}

function summarizeText(text = '', maxChars = DEFAULT_SUMMARY_CHARS) {
    const clean = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!clean) return '';
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, maxChars)}...`;
}

function hashText(text = '') {
    return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}
