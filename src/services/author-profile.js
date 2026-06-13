/**
 * Novel AI Editor — L1: Author Profile System
 *
 * 参考 Claude Code 的 CLAUDE.md + Auto Memory 架构，映射到写作领域：
 *
 *   ~/.novel-ai-editor/author/
 *   ├── AUTHOR.md           ← 作者档案（类似 CLAUDE.md，AI 可建议修改）
 *   └── memory/
 *       ├── MEMORY.md       ← 索引（每行一个文件引用，上限 200 行）
 *       ├── style.md        ← 从多本书中提炼的文风特征
 *       ├── workflow.md     ← 工作流偏好（大纲→写→改 vs 边想边写）
 *       ├── feedback.md     ← 用户反复提出的修改意见模式
 *       └── genre-notes.md  ← 不同题材的写作心得
 *
 * 进化循环：
 *   每次写作 → 积累 signals → 每章/每书结束 → 后台整理 → 更新 AUTHOR.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDataRoot } from '../config.js';

const AUTHOR_DIR = path.join(getDataRoot(), '..', 'author');
const MEMORY_DIR = path.join(AUTHOR_DIR, 'memory');

// ==================== Memory File Format ====================

/**
 * 每个记忆文件格式（参考 CC 的 frontmatter）：
 *
 * ---
 * name: <kebab-case-slug>
 * description: <one-line summary>
 * type: user | feedback | project | reference
 * freshness: <ISO timestamp>
 * ---
 *
 * <content>
 *
 * Why: <为什么这样>
 * How to apply: <怎么用>
 */

// ==================== Types ====================

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];

// ==================== Author Profile ====================

export class AuthorProfile {
    constructor() {
        this._ensureDirs();
    }

    _ensureDirs() {
        [AUTHOR_DIR, MEMORY_DIR].forEach(d => {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        });
        // Ensure MEMORY.md exists
        const indexPath = path.join(MEMORY_DIR, 'MEMORY.md');
        if (!fs.existsSync(indexPath)) {
            fs.writeFileSync(indexPath, '# Author Memory Index\n\n', 'utf8');
        }
        // Ensure AUTHOR.md exists
        const authorPath = path.join(AUTHOR_DIR, 'AUTHOR.md');
        if (!fs.existsSync(authorPath)) {
            fs.writeFileSync(authorPath, `# 作者档案

## 基本信息
- 笔名：（待填写）
- 主要创作类型：（待填写）
- 写作经验：（待填写）

## 文风特征
（AI 会根据你的写作自动分析）

## 工作流偏好
（你偏好怎样的创作流程）

## 写作规则
（你希望 AI 始终遵守的规则）
`, 'utf8');
        }
    }

    // ==================== Core Operations ====================

    /**
     * 读取 AUTHOR.md
     */
    readProfile() {
        const p = path.join(AUTHOR_DIR, 'AUTHOR.md');
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    }

    /**
     * 更新 AUTHOR.md（用户手动或 AI 建议后确认）
     */
    updateProfile(content) {
        const p = path.join(AUTHOR_DIR, 'AUTHOR.md');
        fs.writeFileSync(p, content, 'utf8');
    }

    /**
     * AI 建议更新 AUTHOR.md（返回建议，用户审核后才写入）
     * @param {string} section - 要更新的章节名
     * @param {string} suggestion - AI 建议的新内容
     * @returns {object} {original, suggestion, section}
     */
    suggestProfileUpdate(section, suggestion) {
        const current = this.readProfile();
        // Find the section
        const sectionRegex = new RegExp(`(## ${section}[\\s\\S]*?)(?=\\n## |$)`, 'g');
        const match = current.match(sectionRegex);
        const original = match ? match[0] : `## ${section}\n（无现有内容）`;

        return { section, original, suggestion, timestamp: new Date().toISOString() };
    }

    /**
     * 应用通过审核的建议
     */
    applySuggestion(section, newContent) {
        const current = this.readProfile();
        const sectionRegex = new RegExp(`(## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[\\s\\S]*?(?=\\n## |$)`, 'g');
        const updated = current.replace(sectionRegex, `$1\n${newContent}\n`);
        this.updateProfile(updated);
    }

    // ==================== Memory Files ====================

    /**
     * 写入一条记忆（类似 CC 的 memory file）
     */
    writeMemory(name, description, content, type = 'project') {
        if (!MEMORY_TYPES.includes(type)) throw new Error(`Invalid type: ${type}`);

        const filename = `${name}.md`;
        const filePath = path.join(MEMORY_DIR, filename);

        const frontmatter = [
            '---',
            `name: ${name}`,
            `description: ${description}`,
            `type: ${type}`,
            `freshness: ${new Date().toISOString()}`,
            '---',
        ].join('\n');

        const body = `${frontmatter}\n\n${content}`;
        fs.writeFileSync(filePath, body, 'utf8');

        // Update index
        this._updateIndex(name, description, type);

        return filePath;
    }

    /**
     * 读取一条记忆
     */
    readMemory(name) {
        const filePath = path.join(MEMORY_DIR, `${name}.md`);
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf8');
        return this._parseMemory(raw);
    }

    /**
     * 删除一条记忆
     */
    deleteMemory(name) {
        const filePath = path.join(MEMORY_DIR, `${name}.md`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        this._removeFromIndex(name);
    }

    /**
     * 列出所有记忆文件的索引
     */
    listMemories() {
        const indexPath = path.join(MEMORY_DIR, 'MEMORY.md');
        if (!fs.existsSync(indexPath)) return [];

        const content = fs.readFileSync(indexPath, 'utf8');
        const lines = content.split('\n').filter(l => l.match(/^- \[.+\]\(.+\.md\)/));

        return lines.map(line => {
            const match = line.match(/^- \[(.+)\]\((.+\.md)\)\s*—\s*(.+)/);
            if (!match) return null;
            return { title: match[1], file: match[2], description: match[3] };
        }).filter(Boolean);
    }

    /**
     * 检索相关记忆（按关键词匹配标题和描述）
     * CC 的做法：每次取 top 5，不做向量检索
     */
    retrieveRelevant(query, maxResults = 5) {
        const all = this.listMemories();
        if (!all.length) return [];

        // Simple relevance scoring: keyword match in title + description
        const keywords = query.toLowerCase().split(/\s+/);
        const scored = all.map(m => {
            const text = `${m.title} ${m.description}`.toLowerCase();
            let score = 0;
            keywords.forEach(kw => {
                if (text.includes(kw)) score += 1;
                if (m.title.toLowerCase().includes(kw)) score += 2; // Title match weighted higher
            });
            return { ...m, score };
        }).filter(m => m.score > 0);

        scored.sort((a, b) => b.score - a.score);

        // Return top N with full content
        return scored.slice(0, maxResults).map(m => {
            const memory = this.readMemory(m.file.replace('.md', ''));
            return { ...m, content: memory?.content || '', freshness: memory?.freshness };
        });
    }

    // ==================== Index Management ====================

    _updateIndex(name, description, type) {
        const indexPath = path.join(MEMORY_DIR, 'MEMORY.md');
        let content = fs.readFileSync(indexPath, 'utf8');

        // Check if already in index
        const entryPattern = new RegExp(`^- \\[.+\\]\\(${name}\\.md\\)`);
        if (entryPattern.test(content)) {
            // Update existing entry
            content = content.replace(
                entryPattern,
                `- [${name}](${name}.md) — ${description}`
            );
        } else {
            // Add new entry
            content += `\n- [${name}](${name}.md) — ${description}`;
        }

        // CC 的硬限制：200 行
        const lines = content.split('\n');
        if (lines.length > 200) {
            console.warn('[AuthorProfile] MEMORY.md 超过 200 行，旧条目将被截断');
            const header = lines[0]; // Keep the title line
            content = header + '\n' + lines.slice(-199).join('\n');
        }

        // 25KB 限制
        if (Buffer.byteLength(content, 'utf8') > 25000) {
            console.warn('[AuthorProfile] MEMORY.md 超过 25KB，将被截断');
            content = content.slice(0, 24500);
        }

        fs.writeFileSync(indexPath, content, 'utf8');
    }

    _removeFromIndex(name) {
        const indexPath = path.join(MEMORY_DIR, 'MEMORY.md');
        let content = fs.readFileSync(indexPath, 'utf8');
        const pattern = new RegExp(`^- \\[.+\\]\\(${name}\\.md\\).*\\n?`, 'm');
        content = content.replace(pattern, '');
        fs.writeFileSync(indexPath, content, 'utf8');
    }

    // ==================== Freshness Check (CC feature) ====================

    /**
     * 检查记忆新鲜度（参考 CC 的 freshness 警告）
     */
    checkFreshness(name) {
        const memory = this.readMemory(name);
        if (!memory?.freshness) return { stale: false, message: '' };

        const age = Date.now() - new Date(memory.freshness).getTime();
        const days = Math.floor(age / (1000 * 60 * 60 * 24));

        if (days > 30) {
            return { stale: true, message: `⚠️ 这条记忆已超过 30 天（${days} 天），可能已过时`, days };
        } else if (days > 7) {
            return { stale: true, message: `📝 这条记忆是 ${days} 天前记录的`, days };
        }
        return { stale: false, message: '', days };
    }

    // ==================== Format for Prompt Injection ====================

    /**
     * 将作者档案格式化为可注入 prompt 的文本
     */
    formatForPrompt(includeMemories = true, maxMemoryTokens = 1500) {
        const parts = [];

        // AUTHOR.md
        const profile = this.readProfile();
        if (profile) {
            parts.push('【作者档案】');
            parts.push(profile);
            parts.push('');
        }

        // Recent memories
        if (includeMemories) {
            const all = this.listMemories();
            if (all.length > 0) {
                parts.push('【历史记忆】（最近 5 条）');
                const recent = all.slice(-5);
                for (const m of recent) {
                    const memory = this.readMemory(m.file.replace('.md', ''));
                    const fresh = this.checkFreshness(m.file.replace('.md', ''));
                    const warning = fresh.stale ? ` (${fresh.message})` : '';
                    if (memory) {
                        parts.push(`- ${m.title}${warning}: ${memory.content?.substring(0, 200)}`);
                    }
                }
            }
        }

        return parts.join('\n');
    }

    // ==================== Parse ====================

    _parseMemory(raw) {
        const lines = raw.split('\n');
        let inFrontmatter = false;
        let frontmatterEnd = 0;
        const meta = {};

        if (lines[0] === '---') {
            inFrontmatter = true;
            for (let i = 1; i < lines.length; i++) {
                if (lines[i] === '---') {
                    frontmatterEnd = i;
                    break;
                }
                const colonIdx = lines[i].indexOf(':');
                if (colonIdx > 0) {
                    meta[lines[i].substring(0, colonIdx).trim()] = lines[i].substring(colonIdx + 1).trim();
                }
            }
        }

        const content = lines.slice(frontmatterEnd + 1).join('\n').trim();

        return {
            name: meta.name || '',
            description: meta.description || '',
            type: meta.type || 'project',
            freshness: meta.freshness || '',
            content,
        };
    }
}

// Singleton
let _instance = null;
export function getAuthorProfile() {
    if (!_instance) _instance = new AuthorProfile();
    return _instance;
}
