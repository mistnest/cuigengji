/**
 * Chat Tool — Shared tool definitions for Plan & Assist modes
 */
import sanitize from 'sanitize-filename';

import {
    listCharacters,
    saveCharacter,
    ensureCharacterSummaries,
    ensureWorldBookSummaries,
} from '../../../backend/domains/knowledge/index.js';
import { loadWorkspace, saveWorkspace } from '../../../backend/domains/project/index.js';
import {
    getPreset,
    savePreset,
    sanitizePresetSecrets,
} from '../../../backend/foundation/configuration/index.js';

// ==================== Tool Definitions ====================

export const ASSIST_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'import_data',
            description: '将AI生成的JSON数据导入到编辑器的角色库、世界书或预设中',
            parameters: {
                type: 'object',
                properties: {
                    target: {
                        type: 'string',
                        enum: ['character', 'worldbook', 'preset'],
                        description: '导入目标类型',
                    },
                    data: {
                        anyOf: [
                            { type: 'object' },
                            { type: 'array' },
                        ],
                        description: '要导入的JSON数据。character需含name/summary/description/personality; worldbook可为单条{comment,key,summary,content}、数组或{entries}; summary用于正文写作注入，必须保留核心事实',
                    },
                },
                required: ['target', 'data'],
            },
        },
    },
];

// ==================== Tool Executor ====================

export async function executeTool(name, args = {}, novelId = '', options = {}) {
    const writeOptions = normalizeWriteOptions(options);
    switch (name) {
        case 'import_data': {
            const { target, data } = args;
            if (!target || !data) return { error: '缺少 target 或 data 参数' };
            if (!novelId) return { error: '缺少 novelId，无法写入项目' };

            if (target === 'character') {
                return importCharacter(novelId, data, writeOptions);
            }

            if (target === 'worldbook') {
                return importWorldBookEntries(novelId, data, writeOptions);
            }

            if (target === 'preset') {
                return importPreset(novelId, data, writeOptions);
            }

            return { error: `未知 target: ${target}` };
        }

        default:
            return { error: `Unknown tool: ${name}` };
    }
}

async function importCharacter(novelId, data = {}, options = {}) {
    const name = String(data.data?.name || data.name || '').trim();
    if (!name) return { error: '角色名缺失' };

    const card = normalizeCharacterCard(data, name);
    const character = ensureCharacterSummaries([card]).data[0];
    // Resolve the current asset version before writing.  The old legacy tool
    // used a raw write here, which could silently replace a human edit made
    // while the model was thinking.  A missing asset is represented by
    // revision 0 so a concurrent first create still loses with a CAS error.
    const safeName = sanitize(String(name || '')).substring(0, 100);
    const existing = (await listCharacters(novelId))
        .find(item => item.name === safeName)?.data;
    const savedCharacter = await saveCharacter(novelId, character, {
        expectedRevision: data.expectedRevision ?? data.revision ?? existing?.revision ?? 0,
        expectedContentHash: data.expectedContentHash ?? data.contentHash ?? existing?.contentHash,
        actor: options.actor,
    });

    const workspaceResult = await updateWorkspace(novelId, options, workspace => {
        const characters = Array.isArray(workspace.characters) ? workspace.characters : [];
        const next = characters.filter(item => characterName(item) !== name);
        next.push(savedCharacter.character || character);
        return { ...workspace, characters: next };
    });

    return {
        success: true,
        target: 'character',
        name,
        character: savedCharacter.character || character,
        path: savedCharacter.path,
        revision: workspaceResult.saved.revision,
        updatedAt: workspaceResult.saved.updatedAt,
        contentHash: workspaceResult.saved.contentHash,
    };
}

async function importWorldBookEntries(novelId, data = {}, options = {}) {
    const entries = normalizeWorldBookInput(data);
    if (!entries.length) return { error: '没有提供世界书条目' };

    let addedEntries = {};
    const workspaceResult = await updateWorkspace(novelId, options, workspace => {
        const currentBook = workspace.worldBook?.entries ? workspace.worldBook : { entries: {} };
        const bookEntries = { ...(currentBook.entries || {}) };
        let uid = Math.max(0, ...Object.keys(bookEntries).map(Number).filter(Number.isFinite)) + 1;

        addedEntries = {};
        for (const entry of entries) {
            const normalized = normalizeWorldBookEntry(entry, uid);
            if (!normalized.content || !normalized.key.length) continue;
            bookEntries[uid] = normalized;
            addedEntries[uid] = normalized;
            uid++;
        }

        return {
            ...workspace,
            worldBook: ensureWorldBookSummaries({
                ...currentBook,
                entries: bookEntries,
            }).data,
        };
    });

    if (!Object.keys(addedEntries).length) return { error: '世界书条目缺少 content 或 key' };

    return {
        success: true,
        target: 'worldbook',
        entries_added: Object.keys(addedEntries).length,
        entries: addedEntries,
        revision: workspaceResult.saved.revision,
        updatedAt: workspaceResult.saved.updatedAt,
        contentHash: workspaceResult.saved.contentHash,
    };
}

async function importPreset(novelId, data = {}, options = {}) {
    const name = String(data.name || '').trim();
    if (!name) return { error: '预设名称缺失' };
    const preset = sanitizePresetSecrets({ ...data, name, savedAt: Date.now() });
    const existingPreset = await getPreset(novelId, name);
    const savedPreset = await savePreset(novelId, name, preset, {
        expectedRevision: data.expectedPresetRevision ?? data.presetRevision
            ?? existingPreset?.revision ?? 0,
        expectedContentHash: data.expectedPresetContentHash ?? data.presetContentHash
            ?? existingPreset?.contentHash,
        actor: options.actor,
    });

    const workspacePreset = {
        ...preset,
        revision: savedPreset.revision,
        updatedAt: savedPreset.updatedAt,
        contentHash: savedPreset.contentHash,
    };
    const workspaceResult = await updateWorkspace(novelId, options, workspace => ({
        ...workspace,
        presets: {
            ...(workspace.presets || {}),
            [name]: workspacePreset,
        },
        presetName: workspace.presetName || name,
    }));

    return {
        success: true,
        target: 'preset',
        name,
        preset: workspacePreset,
        path: savedPreset.path,
        revision: workspaceResult.saved.revision,
        updatedAt: workspaceResult.saved.updatedAt,
        contentHash: workspaceResult.saved.contentHash,
    };
}

/**
 * Update the authoritative workspace through a read/CAS/write cycle.  When
 * the caller has no snapshot metadata we pin the CAS to the version read at
 * the beginning of this operation; this is still safer than an unconditional
 * update because another writer can commit between the read and the write.
 */
async function updateWorkspace(novelId, options = {}, mutate) {
    const workspace = await loadWorkspace(novelId);
    const expectedRevision = options.expectedRevision ?? workspace.revision ?? 0;
    const expectedContentHash = options.expectedContentHash ?? workspace.contentHash;
    const candidate = mutate(structuredClone(workspace));
    const saved = await saveWorkspace(novelId, {
        ...candidate,
        expectedRevision,
        expectedContentHash,
        actor: options.actor,
    });
    return { workspace, candidate, saved };
}

function normalizeWriteOptions(options = {}) {
    const actor = options?.actor && typeof options.actor === 'object'
        ? options.actor
        : { kind: 'agent', id: 'legacy-writing-tool' };
    return {
        expectedRevision: options?.expectedRevision,
        expectedContentHash: options?.expectedContentHash,
        actor,
    };
}

function normalizeCharacterCard(data = {}, name) {
    const source = data.data || data;
    const summary = cleanSummary(source.summary || data.summary || buildCharacterImportSummary(source), 80);
    return {
        ...data,
        spec: data.spec || 'chara_card_v3',
        spec_version: data.spec_version || '3.0',
        data: {
            ...source,
            name,
            summary,
            description: source.description || '',
            personality: source.personality || '',
            scenario: source.scenario || '',
            first_mes: source.first_mes || '',
            mes_example: source.mes_example || '',
            tags: Array.isArray(source.tags) ? source.tags : [],
            group: source.group || '',
            character_book: source.character_book || { entries: {} },
        },
    };
}

function normalizeWorldBookInput(data = {}) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.entries)) return data.entries;
    if (data.entries && typeof data.entries === 'object') return Object.values(data.entries);
    if (data.key || data.keys || data.content) return [data];
    return [];
}

function normalizeWorldBookEntry(entry = {}, uid) {
    const key = Array.isArray(entry.key)
        ? entry.key
        : Array.isArray(entry.keys)
            ? entry.keys
            : [entry.key].filter(Boolean);
    const disabled = entry.disable === true || entry.disabled === true || entry.enabled === false;
    const content = entry.content || '';
    const summary = cleanSummary(entry.summary || buildWorldBookImportSummary(entry), 80);
    return {
        ...entry,
        uid,
        key,
        keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
        summary,
        content,
        comment: entry.comment || entry.name || key[0] || `条目${uid}`,
        folder: entry.folder || entry._folder || entry._source || 'AI设定工具',
        _folder: entry.folder || entry._folder || entry._source || 'AI设定工具',
        sourceGroup: entry.sourceGroup || entry.group || '',
        group: entry.sourceGroup || entry.group || '',
        constant: entry.constant === true,
        selective: entry.selective !== false,
        order: Number(entry.order || entry.insertion_order || 100),
        position: normalizePosition(entry.position ?? entry.extensions?.position),
        disable: disabled,
        disabled,
        enabled: !disabled,
        probability: Number(entry.probability || entry.extensions?.probability || 100),
        depth: Number(entry.depth || entry.extensions?.depth || 4),
        _source: entry._source || 'AI设定工具',
    };
}

function buildCharacterImportSummary(source = {}) {
    return [
        source.name,
        source.description,
        source.personality,
        source.scenario,
    ].filter(Boolean).join('；');
}

function buildWorldBookImportSummary(entry = {}) {
    return [
        entry.comment || entry.name,
        Array.isArray(entry.key) ? entry.key.join('、') : entry.key,
        entry.content,
    ].filter(Boolean).join('；');
}

function cleanSummary(text = '', max = 80) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function normalizePosition(value) {
    if (value === 'after_char') return 1;
    if (value === 'before_char') return 0;
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function characterName(character = {}) {
    return character.data?.name || character.name || '';
}
