/**
 * Chat Tool — Shared tool definitions for Plan & Assist modes
 */
import path from 'node:path';
import fs from 'node:fs';
import { getDataRoot } from '../config.js';

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
                        type: 'object',
                        description: '要导入的JSON数据。character需含name/description/personality; worldbook需含entries数组(每项含comment/key/content); preset需含provider/model等信息',
                    },
                },
                required: ['target', 'data'],
            },
        },
    },
];

export const PLAN_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'update_outline',
            description: '更新或创建大纲节点，将情节讨论结果写入大纲',
            parameters: {
                type: 'object',
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string', description: '节点ID，留空则创建新节点' },
                                title: { type: 'string', description: '节点标题' },
                                description: { type: 'string', description: '节点描述/情节概述' },
                                completed: { type: 'boolean', description: '是否已完成' },
                                parent_id: { type: 'string', description: '父节点ID' },
                            },
                            required: ['title'],
                        },
                    },
                },
                required: ['nodes'],
            },
        },
    },
];

// ==================== Tool Executor ====================

export async function executeTool(name, args = {}, novelId = '') {
    const charsDir = path.join(getDataRoot(), 'characters');
    const presetsDir = path.join(getDataRoot(), 'presets');
    const root = path.join(getDataRoot(), 'novels', novelId);

    switch (name) {
        case 'import_data': {
            const { target, data } = args;
            if (!target || !data) return { error: '缺少 target 或 data 参数' };

            if (target === 'character') {
                if (!data.name) return { error: '角色名缺失' };
                const card = {
                    spec: 'chara_card_v3', spec_version: '3.0',
                    data: {
                        name: data.name,
                        description: data.description || '',
                        personality: data.personality || '',
                        scenario: data.scenario || '',
                        first_mes: data.first_mes || '',
                        mes_example: data.mes_example || '',
                        tags: data.tags || [],
                        group: data.group || '',
                        character_book: { entries: {} },
                    },
                };
                fs.mkdirSync(charsDir, { recursive: true });
                fs.writeFileSync(path.join(charsDir, `${data.name}.json`), JSON.stringify(card, null, 2), 'utf8');
                return { success: true, target: 'character', name: data.name };
            }

            if (target === 'worldbook') {
                const entries = data.entries || (data.key ? [data] : []);
                if (!entries.length) return { error: '没有提供世界书条目' };
                const wsFile = path.join(root, 'workspace.json');
                let ws = { worldBook: { entries: {} } };
                if (fs.existsSync(wsFile)) ws = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
                const wb = ws.worldBook?.entries || {};
                let uid = Math.max(0, ...Object.keys(wb).map(Number)) + 1;
                let added = 0;
                for (const e of entries) {
                    if (!e.content || !e.key?.length) continue;
                    wb[uid] = {
                        uid, key: e.key, keysecondary: [],
                        content: e.content, comment: e.comment || e.key[0],
                        group: e.group || '', constant: false, selective: true,
                        order: 100, position: 0, disable: false,
                        probability: 100, depth: 4,
                    };
                    uid++; added++;
                }
                ws.worldBook = { entries: wb };
                fs.writeFileSync(wsFile, JSON.stringify(ws, null, 2), 'utf8');
                return { success: true, target: 'worldbook', entries_added: added };
            }

            if (target === 'preset') {
                if (!data.name) return { error: '预设名称缺失' };
                fs.mkdirSync(presetsDir, { recursive: true });
                const preset = { name: data.name, ...data, savedAt: Date.now() };
                fs.writeFileSync(path.join(presetsDir, `${data.name}.json`), JSON.stringify(preset, null, 2), 'utf8');
                return { success: true, target: 'preset', name: data.name };
            }

            return { error: `未知 target: ${target}` };
        }

        case 'update_outline': {
            const outlineFile = path.join(root, 'outline.json');
            let outline = { nodes: [] };
            if (fs.existsSync(outlineFile)) outline = JSON.parse(fs.readFileSync(outlineFile, 'utf8'));
            const nodes = args.nodes || [];
            for (const n of nodes) {
                const exist = outline.nodes.find(on => on.id === n.id);
                if (exist) {
                    if (n.title) exist.title = n.title;
                    if (n.description) exist.description = n.description;
                    if (n.completed !== undefined) exist.completed = n.completed;
                } else {
                    outline.nodes.push({
                        id: n.id || `node_${Date.now().toString(36)}`,
                        title: n.title,
                        description: n.description || '',
                        completed: n.completed || false,
                        parentId: n.parent_id || null,
                        createdAt: Date.now(),
                    });
                }
            }
            fs.writeFileSync(outlineFile, JSON.stringify(outline, null, 2), 'utf8');
            return { success: true, nodes_updated: nodes.length };
        }

        default:
            return { error: `Unknown tool: ${name}` };
    }
}
