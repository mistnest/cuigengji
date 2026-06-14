/**
 * Novel AI Editor — L2+L3: Novel Project Memory
 *
 * 每个小说项目专属的记忆系统：
 *
 *   data/novels/<novel-name>/
 *   ├── novel.json              ← 项目配置 (L2)
 *   └── memory/                 ← 本书专属记忆 (L3)
 *       ├── MEMORY.md           ← 索引
 *       ├── extracted-chars.md  ← AI 自动提取的新角色
 *       ├── world-elements.md   ← AI 自动提取的世界观元素
 *       ├── plot-threads.md     ← AI 跟踪的情节线
 *       └── session-notes.md    ← 每次写作的上下文笔记
 *
 * L2: 文件存储层 — 结构化的小说项目数据
 * L3: 自动提取层 — AI 生成后自动分析，提取可复用信息
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDataRoot } from '../config.js';

// ==================== Novel Config (L2) ====================

export class NovelConfig {
    constructor(novelId) {
        this.novelId = novelId;
        this.novelDir = path.join(getDataRoot(), 'novels', novelId);
        this.configPath = path.join(this.novelDir, 'novel.json');
        this.memoryDir = path.join(this.novelDir, 'memory');
        this._ensureDirs();
    }

    _ensureDirs() {
        [this.novelDir, this.memoryDir].forEach(d => {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        });
    }

    /**
     * 读取 novel.json
     */
    read() {
        if (!fs.existsSync(this.configPath)) {
            return this._defaultConfig();
        }
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    }

    /**
     * 写入 novel.json
     */
    write(config) {
        const current = this.read();
        const merged = { ...current, ...config, updated: Date.now() };
        fs.writeFileSync(this.configPath, JSON.stringify(merged, null, 2), 'utf8');
        return merged;
    }

    _defaultConfig() {
        return {
            novelId: this.novelId,
            title: '',
            author: '',
            genre: '',
            styleGuide: '',
            created: Date.now(),
            updated: Date.now(),
            linkedWorldBooks: [],
            linkedCharacters: [],
            globalWritingRules: [],
        };
    }

    /**
     * 格式化为 prompt 注入文本
     */
    formatForPrompt() {
        const config = this.read();
        const parts = [];
        if (config.title) parts.push(`书名：《${config.title}》`);
        if (config.author) parts.push(`作者：${config.author}`);
        if (config.genre) parts.push(`类型：${config.genre}`);
        if (config.styleGuide) {
            parts.push(`\n【文风指南】\n${config.styleGuide}`);
        }
        if (config.globalWritingRules?.length) {
            parts.push('\n【写作规则】');
            config.globalWritingRules.forEach((r, i) => parts.push(`${i + 1}. ${r}`));
        }
        return parts.join('\n');
    }
}

// ==================== Novel Memory Manager (L3) ====================

export class NovelMemory {
    constructor(novelId) {
        this.novelId = novelId;
        this.novelDir = path.join(getDataRoot(), 'novels', novelId);
        this.memoryDir = path.join(this.novelDir, 'memory');
        this.indexPath = path.join(this.memoryDir, 'MEMORY.md');
        this._ensureDirs();
    }

    _ensureDirs() {
        [this.novelDir, this.memoryDir].forEach(d => {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        });
        if (!fs.existsSync(this.indexPath)) {
            fs.writeFileSync(this.indexPath, `# ${this.novelId} — 记忆索引\n\n`, 'utf8');
        }
    }

    // ==================== Memory File Management ====================

    /**
     * 写入一条项目记忆
     */
    writeMemory(name, description, content, metadata = {}) {
        const filename = `${name}.md`;
        const filePath = path.join(this.memoryDir, filename);

        const frontmatter = [
            '---',
            `name: ${name}`,
            `description: ${description}`,
            `created: ${new Date().toISOString()}`,
            `type: ${metadata.type || 'note'}`,
            `source: ${metadata.source || 'manual'}`,
            '---',
        ].join('\n');

        fs.writeFileSync(filePath, `${frontmatter}\n\n${content}`, 'utf8');
        this._updateIndex(name, description);
        return filePath;
    }

    readMemory(name) {
        const filePath = path.join(this.memoryDir, `${name}.md`);
        if (!fs.existsSync(filePath)) return null;
        return fs.readFileSync(filePath, 'utf8');
    }

    listMemories() {
        if (!fs.existsSync(this.indexPath)) return [];
        const content = fs.readFileSync(this.indexPath, 'utf8');
        const lines = content.split('\n').filter(l => l.match(/^- \[/));
        return lines.map(line => {
            const m = line.match(/^- \[(.+)\]\((.+\.md)\)\s*—\s*(.+)/);
            return m ? { title: m[1], file: m[2], description: m[3] } : null;
        }).filter(Boolean);
    }

    // ==================== L3: Auto-Extraction ====================

    /**
     * 从 AI 生成的文本中提取新信息
     * 在每次 AI 生成后调用
     *
     * @param {string} generatedText - AI 刚生成的小说正文
     * @param {object} context - 当前上下文
     * @returns {object} 提取结果
     */
    extractFromText(generatedText, _context = {}) {
        const extractions = {
            newCharacters: this._extractCharacters(generatedText),
            newWorldElements: this._extractWorldElements(generatedText),
            plotDevelopments: this._detectPlotDevelopments(generatedText),
            sessionSummary: '',
        };
        return extractions;
    }

    /**
     * 从文本中检测可能的新角色名
     */
    _extractCharacters(text) {
        const existingChars = this._getExistingCharacterNames();
        const found = new Set();

        // Chinese name patterns
        const patterns = [
            /([一-鿿]{2,4}(?:儿|子|公|婆|老|少|爷|娘|兄|弟|姐|妹|姨|叔|伯|姑|嫂|丈|夫|妇|生|师|仙|王|皇|帝|尊|圣|魔|妖|神|佛|道|僧|侠|盗|贼|官|兵|将|相|侯|君|主|姬|妃|嫔|妾|奴|婢|仆|从))/g,
            /([一-鿿]{2,4})/g,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const name = match[1];
                if (!existingChars.includes(name) &&
                    !this._isCommonPhrase(name) &&
                    name.length >= 2 && name.length <= 4) {
                    found.add(name);
                }
            }
        }

        return Array.from(found).slice(0, 10).map(name => ({
            name,
            context: this._extractContext(text, name),
        }));
    }

    /**
     * 检测世界观元素（地点、物品、功法等）
     */
    _extractWorldElements(text) {
        const existingKeys = this._getExistingWorldKeys();
        const found = new Set();

        // Named entities with suffixes
        const suffixPatterns = /([一-鿿]{2,6}(?:山|峰|谷|河|湖|海|城|国|殿|阁|楼|塔|寺|庙|宫|府|院|庄|村|镇|门|派|宗|族|教|帮|会|盟|界|域|境|道|路|林|原|漠|岛|崖|洞|穴|渊|潭|泉|瀑))/g;
        const itemPatterns = /([一-鿿]{2,6}(?:剑|刀|枪|戟|斧|锤|鞭|弓|箭|盾|甲|铠|袍|丹|药|鼎|炉|符|阵|术|法|功|诀|经|典|谱|卷|印|珠|环|玉|石|镜|扇|铃|琴|棋|笔|墨|纸|砚))/g;

        for (const pattern of [suffixPatterns, itemPatterns]) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const element = match[1];
                if (!existingKeys.includes(element) && element.length >= 2) {
                    found.add(element);
                }
            }
        }

        return Array.from(found).slice(0, 10).map(element => ({
            element,
            type: this._classifyWorldElement(element),
            context: this._extractContext(text, element),
        }));
    }

    /**
     * 检测情节进展
     */
    _detectPlotDevelopments(text) {
        const developments = [];
        const markers = [
            { pattern: /突然|忽然|竟然|原来|没想到|发现|真相|秘密|揭示|暴露/g, type: '转折/揭示' },
            { pattern: /打败|战胜|突破|领悟|习得|掌握|晋升|突破/g, type: '角色成长' },
            { pattern: /死亡|死去|牺牲|消失|离去|告别/g, type: '角色变化' },
            { pattern: /爱|恨|情|仇|恩|怨|誓约|约定/g, type: '关系发展' },
            { pattern: /阴谋|计划|准备|部署|安排|埋伏/g, type: '伏笔/布局' },
        ];

        for (const marker of markers) {
            const matches = text.match(marker.pattern);
            if (matches && matches.length >= 2) {
                developments.push({
                    type: marker.type,
                    occurrences: matches.length,
                    snippet: this._extractSnippet(text, matches[0]),
                });
            }
        }

        return developments;
    }

    // ==================== Session Management ====================

    /**
     * 保存本次写作会话的摘要笔记
     */
    saveSessionNotes(notes) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return this.writeMemory(
            `session-${timestamp}`,
            `写作会话 — ${new Date().toLocaleDateString('zh-CN')}`,
            notes,
            { type: 'session', source: 'auto' }
        );
    }

    /**
     * 生成章节摘要并保存
     */
    saveChapterSummary(chapterTitle, summary) {
        return this.writeMemory(
            `chapter-${chapterTitle.replace(/[<>:"/\\|?*]/g, '_')}`,
            `章节摘要 — ${chapterTitle}`,
            summary,
            { type: 'chapter_summary', source: 'ai' }
        );
    }

    // ==================== Format for Prompt ====================

    /**
     * 将项目记忆格式化为 prompt 注入文本
     */
    formatForPrompt() {
        const parts = [];
        const memories = this.listMemories();

        // Last 3 chapter summaries
        const summaries = memories.filter(m => m.description?.startsWith('章节摘要'));
        if (summaries.length > 0) {
            parts.push('【前文章节摘要】');
            summaries.slice(-3).forEach(s => {
                const content = this.readMemory(s.file.replace('.md', ''));
                if (content) {
                    const body = content.split('---').pop()?.trim() || '';
                    parts.push(`- ${s.title}: ${body.substring(0, 300)}`);
                }
            });
        }

        // Plot threads
        const plotMem = memories.find(m => m.file === 'plot-threads.md');
        if (plotMem) {
            const content = this.readMemory('plot-threads');
            if (content) {
                parts.push('\n【情节线跟踪】');
                parts.push(content.split('---').pop()?.trim()?.substring(0, 500) || '');
            }
        }

        // Extracted characters
        const charMem = memories.find(m => m.file === 'extracted-chars.md');
        if (charMem) {
            const content = this.readMemory('extracted-chars');
            if (content) {
                parts.push('\n【自动识别的角色】');
                parts.push(content.split('---').pop()?.trim()?.substring(0, 400) || '');
            }
        }

        // World elements
        const worldMem = memories.find(m => m.file === 'world-elements.md');
        if (worldMem) {
            const content = this.readMemory('world-elements');
            if (content) {
                parts.push('\n【自动识别的世界观元素】');
                parts.push(content.split('---').pop()?.trim()?.substring(0, 400) || '');
            }
        }

        return parts.join('\n');
    }

    // ==================== Helpers ====================

    _updateIndex(name, description) {
        let content = fs.readFileSync(this.indexPath, 'utf8');
        const entry = `- [${name}](${name}.md) — ${description}`;
        const existing = new RegExp(`^- \\[.+\\]\\(${name}\\.md\\).*\\n?`, 'm');
        if (existing.test(content)) {
            content = content.replace(existing, entry + '\n');
        } else {
            content += entry + '\n';
        }
        fs.writeFileSync(this.indexPath, content, 'utf8');
    }

    _getExistingCharacterNames() {
        // Read from linked character cards
        const charsDir = path.join(getDataRoot(), 'characters');
        if (!fs.existsSync(charsDir)) return [];
        return fs.readdirSync(charsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(charsDir, f), 'utf8'));
                    return data.data?.name || data.name || '';
                } catch { return ''; }
            })
            .filter(Boolean);
    }

    _getExistingWorldKeys() {
        const worldsDir = path.join(getDataRoot(), 'worlds');
        if (!fs.existsSync(worldsDir)) return [];
        const keys = [];
        for (const f of fs.readdirSync(worldsDir).filter(f => f.endsWith('.json'))) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(worldsDir, f), 'utf8'));
                for (const entry of Object.values(data.entries || {})) {
                    keys.push(...(entry.key || []));
                }
            } catch { /* skip */ }
        }
        return keys;
    }

    _isCommonPhrase(text) {
        const common = ['没有', '什么', '怎么', '这个', '那个', '我们', '他们', '已经', '不是', '可以', '起来', '下来', '不过', '但是', '因为', '所以', '如果', '虽然', '然后', '于是', '接着', '说道', '看着', '听到', '觉得'];
        return common.includes(text);
    }

    _classifyWorldElement(element) {
        const last = element.slice(-1);
        if (/[山城国宫殿阁楼塔寺庙宫府院村镇门]/ .test(last)) return '地点';
        if (/[剑刀枪戟斧锤鞭弓箭盾甲铠袍]/ .test(last)) return '装备';
        if (/[丹药鼎炉符阵术法功诀经]/ .test(last)) return '功法/丹药';
        if (/[派宗族教帮会盟]/ .test(last)) return '势力';
        return '其他';
    }

    _extractContext(text, keyword, window = 60) {
        const idx = text.indexOf(keyword);
        if (idx < 0) return '';
        const start = Math.max(0, idx - window);
        const end = Math.min(text.length, idx + keyword.length + window);
        return text.substring(start, end).replace(/\n/g, ' ');
    }

    _extractSnippet(text, keyword, window = 40) {
        return this._extractContext(text, keyword, window);
    }
}
