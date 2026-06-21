import { loadProjectContext } from '../../project-data.js';
import {
    getCharacterSummary,
    getChapterSummary,
    getWorldBookEntrySummary,
} from '../../reference-summaries.js';

const DEFAULT_DETAIL_TOKENS = 1200;

export async function buildReferenceStore(runtime = {}) {
    const context = runtime.context || {};
    const novelId = context.novelId || runtime.novelId || 'default';
    const project = await loadProjectContext(novelId, context);
    const chapterLimit = resolveChapterLimit(project, context);
    const records = [
        ...worldBookRecords(project),
        ...characterRecords(project),
        ...chapterRecords(project, chapterLimit),
        ...memoryRecords(project, chapterLimit),
        sceneRecord(project, runtime),
    ].filter(Boolean);

    return {
        novelId,
        project,
        runtime,
        chapterLimit,
        records,
        byId: new Map(records.map(record => [record.id, record])),
    };
}

export function searchStore(store, { query = '', types = [], limit = 8 } = {}) {
    const wantedTypes = Array.isArray(types) && types.length ? new Set(types) : null;
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 8, 12));
    const terms = tokenize(query);
    const candidates = store.records
        .filter(record => !wantedTypes || wantedTypes.has(record.type))
        .map(record => ({
            record,
            score: scoreRecord(record, terms, query),
        }))
        .filter(item => item.score > 0 || !terms.length)
        .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title, 'zh-CN'))
        .slice(0, normalizedLimit);

    return {
        query,
        results: candidates.map(({ record, score }) => ({
            id: record.id,
            type: record.type,
            title: record.title,
            summary: record.summary,
            score: Number(score.toFixed(4)),
            detailAvailable: Boolean(record.content),
            source: record.source,
        })),
    };
}

export function getStoreDetail(store, { id = '', maxTokens = DEFAULT_DETAIL_TOKENS } = {}) {
    const record = store.byId.get(String(id));
    if (!record) {
        return { error: `Reference not found: ${id}`, id };
    }
    const normalizedMax = Math.max(128, Math.min(Number(maxTokens) || DEFAULT_DETAIL_TOKENS, 4000));
    return {
        id: record.id,
        type: record.type,
        title: record.title,
        content: trimApproxTokens(record.content || record.summary || '', normalizedMax),
        source: record.source,
        truncated: estimateTokens(record.content || '') > normalizedMax,
    };
}

export function getStoreSceneContext(store, args = {}) {
    const runtime = store.runtime || {};
    const context = runtime.context || {};
    const beforeChars = Math.max(200, Math.min(Number(args.beforeChars) || 3000, 12000));
    const scope = args.scope || 'current_tail';
    const currentText = cleanReferenceText(context.currentText || '');
    const beforeText = currentText.slice(-beforeChars);
    const summaries = args.includeRecentSummary === false
        ? []
        : filterSummariesByLimit(store.project.plotMemory.chapterSummaries, store.chapterLimit).slice(-5);
    const outline = args.includeOutline === false
        ? []
        : store.project.plotMemory.openOutline.slice(0, 8);

    return {
        id: 'scene:current',
        type: 'scene',
        scope,
        novelId: store.novelId,
        chapterTitle: context.chapterTitle || '',
        currentPosition: 'chapter_end',
        beforeText,
        beforeChars: beforeText.length,
        currentTextLength: currentText.length,
        recentSummary: summaries,
        openOutline: outline,
        currentRequest: runtime.message || '',
    };
}

function worldBookRecords(project) {
    return Object.entries(project.worldBook?.entries || {})
        .filter(([, entry]) => !isWorldBookEntryDisabled(entry))
        .map(([key, entry]) => {
            const id = `worldbook:${entry.uid ?? key}`;
            const title = entry.comment || entry.name || (entry.key || []).join(' / ') || id;
            const content = entry.content || '';
            const summary = getWorldBookEntrySummary(entry);
            return {
                id,
                type: 'worldbook',
                title,
                summary: summary || summarize(content, title),
                content,
                keywords: [...(entry.key || []), ...(entry.keysecondary || []), title],
                source: { kind: 'worldbook', uid: entry.uid ?? key, folder: getWorldBookFolder(entry), group: entry.group || '', position: entry.position ?? 0 },
            };
        });
}

function getWorldBookFolder(entry = {}) {
    return String(entry.folder || entry._folder || entry._source || entry.group || '').trim();
}

function isWorldBookEntryDisabled(entry = {}) {
    return entry.disable === true
        || entry.disabled === true
        || entry.enabled === false;
}

function characterRecords(project) {
    return (project.characters || []).filter(character => !isCharacterDisabled(character)).map((character, index) => {
        const data = character.data || character;
        const name = data.name || character.name || `Character ${index + 1}`;
        const parts = [
            field('Description', data.description),
            field('Personality', data.personality),
            field('Scenario', data.scenario),
            field('First message', data.first_mes),
            field('Message examples', data.mes_example),
            field('System prompt', data.system_prompt),
            field('Post-history instructions', data.post_history_instructions),
            field('Creator notes', data.creator_notes),
        ].filter(Boolean);
        const content = parts.join('\n\n');
        const summary = getCharacterSummary(character);
        return {
            id: `character:${name}`,
            type: 'character',
            title: name,
            summary: summary || summarize(content, name),
            content,
            keywords: [name, ...(data.tags || [])],
            source: { kind: 'character', name },
        };
    });
}

function isCharacterDisabled(character = {}) {
    const data = character.data || character;
    return character.disable === true
        || character.disabled === true
        || character.enabled === false
        || data.disable === true
        || data.disabled === true
        || data.enabled === false
        || data.extensions?.cuigengji?.disabled === true
        || data.extensions?.novel_ai_editor?.disabled === true;
}

function chapterRecords(project, chapterLimit = null) {
    return (project.chapters || [])
        .filter(chapter => isChapterVisible(chapter, chapterLimit))
        .map((chapter, index) => {
        const id = `chapter:${chapter.id || index}`;
        const title = chapter.title || `Chapter ${index + 1}`;
        const content = [
            chapter.volumeTitle ? `Volume: ${chapter.volumeTitle}` : '',
            chapter.notes ? `Notes: ${chapter.notes}` : '',
            chapter.plotPoints?.length ? `Plot points: ${chapter.plotPoints.map(point =>
                typeof point === 'string' ? point : (point.title || point.description || JSON.stringify(point)),
            ).join(' / ')}` : '',
            cleanReferenceText(chapter.content || ''),
        ].filter(Boolean).join('\n\n');
        const summary = getChapterSummary(chapter);
        return {
            id,
            type: 'chapter',
            title,
            summary: summary || summarize(content, title),
            content,
            keywords: [title, chapter.volumeTitle || ''],
            source: { kind: 'chapter', id: chapter.id || '', volumeTitle: chapter.volumeTitle || '', order: Number(chapter.order || 0) },
        };
    });
}

function memoryRecords(project, chapterLimit = null) {
    const summaries = filterSummariesByLimit(project.plotMemory?.chapterSummaries || [], chapterLimit);
    const events = project.plotMemory?.keyEvents || [];
    return [
        ...summaries.map((item, index) => ({
            id: `memory:chapter-summary:${index}`,
            type: 'memory',
            title: item.title || `Chapter summary ${index + 1}`,
            summary: summarize(item.summary || '', item.title),
            content: item.summary || '',
            keywords: [item.title || ''],
            source: { kind: 'chapter-summary', updated: item.updated || 0, order: Number(item.order || 0) },
        })),
        ...events.map((item, index) => ({
            id: `memory:key-event:${index}`,
            type: 'memory',
            title: item.title || `Key event ${index + 1}`,
            summary: summarize(item.content || '', item.title),
            content: item.content || '',
            keywords: [item.title || ''],
            source: { kind: 'key-event' },
        })),
    ];
}

function resolveChapterLimit(project, context = {}) {
    if (context.includeFutureChapters === true) return null;
    if (Number.isFinite(Number(context.currentChapterOrder))) return Number(context.currentChapterOrder);
    const currentTitle = normalizeTitle(context.chapterTitle || '');
    if (!currentTitle) return null;
    const chapter = (project.chapters || []).find(item => normalizeTitle(item.title || '') === currentTitle);
    if (!chapter) return null;
    return Number(chapter.order || 0);
}

function isChapterVisible(chapter = {}, chapterLimit = null) {
    if (chapterLimit === null || chapterLimit === undefined) return true;
    return Number(chapter.order || 0) <= Number(chapterLimit);
}

function filterSummariesByLimit(summaries = [], chapterLimit = null) {
    if (chapterLimit === null || chapterLimit === undefined) return summaries || [];
    return (summaries || []).filter(summary => Number(summary.order || 0) <= Number(chapterLimit));
}

function normalizeTitle(value = '') {
    return String(value || '').replace(/\s+/g, '').trim();
}

function sceneRecord(project, runtime) {
    const context = runtime.context || {};
    const currentText = cleanReferenceText(context.currentText || '');
    if (!currentText && !context.chapterTitle) return null;
    return {
        id: 'scene:current',
        type: 'scene',
        title: context.chapterTitle || 'Current writing scene',
        summary: summarize(currentText.slice(-1200), context.chapterTitle || 'Current writing scene'),
        content: currentText,
        keywords: [context.chapterTitle || '', runtime.message || ''],
        source: { kind: 'current-scene', chapters: project.chapters?.length || 0 },
    };
}

function field(label, value) {
    return value ? `${label}:\n${value}` : '';
}

function summarize(content = '', fallback = '') {
    const clean = cleanReferenceText(content).replace(/\s+/g, ' ').trim();
    if (!clean) return fallback || '';
    return clean.length > 260 ? `${clean.slice(0, 260)}...` : clean;
}

function cleanReferenceText(text = '') {
    return String(text || '')
        .split(/\r?\n/)
        .filter(line => !isImportedNoiseLine(line))
        .join('\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
}

function isImportedNoiseLine(line = '') {
    const text = String(line || '').trim();
    if (!text) return false;
    if (/^={6,}$/.test(text) || /^-{6,}$/.test(text)) return true;
    return /知轩藏书|更多精校小说|zxcs8\.com|www\.zxcs8\.com|下载[:：]?http|精校小说尽在/i.test(text);
}

function tokenize(query = '') {
    const raw = String(query || '').trim().toLowerCase();
    if (!raw) return [];
    const parts = raw.split(/[\s,，。；;:：、|/\\()[\]{}"'“”‘’]+/).filter(Boolean);
    return parts.length ? parts : [raw];
}

function scoreRecord(record, terms, rawQuery) {
    const haystack = [
        record.title,
        record.summary,
        record.content,
        ...(record.keywords || []),
    ].join('\n').toLowerCase();
    if (!terms.length) return 0.1;
    let score = 0;
    for (const term of terms) {
        if (!term) continue;
        if (String(record.title || '').toLowerCase().includes(term)) score += 4;
        if ((record.keywords || []).some(keyword => String(keyword).toLowerCase().includes(term))) score += 3;
        if (haystack.includes(term)) score += 1;
    }
    const compactQuery = String(rawQuery || '').trim().toLowerCase();
    if (compactQuery && haystack.includes(compactQuery)) score += 2;
    return score;
}

function trimApproxTokens(text = '', maxTokens = DEFAULT_DETAIL_TOKENS) {
    const maxChars = Math.max(300, Math.floor(maxTokens * 2.4));
    const value = String(text || '');
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n\n[truncated: reference detail exceeded maxTokens=${maxTokens}]`;
}

function estimateTokens(text = '') {
    const chineseChars = (String(text).match(/[\u3400-\u9fff]/g) || []).length;
    const otherChars = String(text).length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 3.5);
}
