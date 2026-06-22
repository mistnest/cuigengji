/**
 * 催更姬 — Prompt Builder
 * 将小说创作上下文组装为 AI prompt
 */
/**
 * 构建小说续写的完整 prompt
 * @param {object} params
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildNovelPrompt(params) {
    const {
        text,              // 当前正文
        chapterContext,    // 前文章节摘要
        worldBook,         // 世界书 {entries: {...}}
        characters,        // 角色列表
        outline,           // 大纲节点
        styleGuide,        // 文风指南
        instructions,      // 特别指示
    } = params;

    const systemParts = [];

    // === 1. Base role definition ===
    systemParts.push('你是一个专业的网络小说作家，拥有丰富的创作经验。');
    systemParts.push('你的任务是根据提供的设定、前文和大纲，进行高质量的续写。');
    systemParts.push('');

    // === 2. Style guide ===
    if (styleGuide) {
        systemParts.push('【文风指南】');
        systemParts.push(styleGuide);
        systemParts.push('');
    }

    // === 3. Writing rules ===
    systemParts.push('【写作规范】');
    systemParts.push('1. 保持与原文完全一致的文风、语气和叙事节奏');
    systemParts.push('2. 充分利用世界观设定，让情节发展与世界观有机融合');
    systemParts.push('3. 人物言行必须符合其性格设定');
    systemParts.push('4. 对话要自然、有个性、推动情节');
    systemParts.push('5. 情节发展要有因果逻辑，避免突兀转折');
    systemParts.push('6. 适当设置悬念和冲突，保持读者兴趣');
    systemParts.push('7. 描写要具体生动，注重细节');
    systemParts.push('8. 使用纯中文写作，注意标点符号规范');
    systemParts.push('');

    // === 4. World book entries (filtered by relevance) ===
    const activeEntries = getActiveWorldBookEntries(worldBook, text);
    if (activeEntries.length > 0) {
        systemParts.push('【当前场景相关世界观】');
        activeEntries.forEach((entry, i) => {
            const label = entry.comment || entry.key?.[0] || `条目${i + 1}`;
            systemParts.push(`◇ ${label}：${entry.content}`);
        });
        systemParts.push('');
    }

    // === 5. Character info ===
    const relevantChars = getRelevantCharacters(characters, text);
    if (relevantChars.length > 0) {
        systemParts.push('【出场角色】');
        relevantChars.forEach(ch => {
            const name = ch.data?.name || ch.name || '';
            const desc = ch.data?.description || ch.description || '';
            const personality = ch.data?.personality || ch.personality || '';
            const scenario = ch.data?.scenario || ch.scenario || '';

            systemParts.push(`【${name}】`);
            if (desc) systemParts.push(`  描述：${desc}`);
            if (personality) systemParts.push(`  性格：${personality}`);
            if (scenario) systemParts.push(`  背景：${scenario}`);
        });
        systemParts.push('');
    }

    const systemPrompt = systemParts.join('\n');

    // === Build user prompt ===
    const userParts = [];

    // Outline requirements
    if (outline && outline.length > 0) {
        const incompleteNodes = outline.filter(n => !n.completed);
        if (incompleteNodes.length > 0) {
            userParts.push('【大纲要求 — 本章需完成的情节节点】');
            incompleteNodes.forEach((n, i) => {
                userParts.push(`${i + 1}. ${n.title}${n.description ? ' — ' + n.description : ''}`);
            });
            userParts.push('');
        }
    }

    // Chapter context (previous chapters summary)
    if (chapterContext) {
        userParts.push('【前文摘要】');
        userParts.push(chapterContext);
        userParts.push('');
    }

    // Special instructions
    if (instructions) {
        userParts.push(`【特别指示】${instructions}`);
        userParts.push('');
    }

    // Current text
    userParts.push('【当前正文 — 请从此处续写】');
    userParts.push(text.trimEnd());
    userParts.push('');
    userParts.push('请根据以上所有信息，用与原文一致的文风续写。直接写出续写内容，不要加任何前缀、后缀或说明文字。确保：');
    userParts.push('- 情节符合大纲要求');
    userParts.push('- 人物言行符合性格设定');
    userParts.push('- 世界观设定准确');
    userParts.push('- 文风与原文一致');

    const userPrompt = userParts.join('\n');

    return { systemPrompt, userPrompt };
}

/**
 * 构建情节候选 prompt
 */
export function buildPlotPrompt(params) {
    const { text, worldBook, characters, outline, styleGuide } = params;

    const userParts = [];

    userParts.push('请根据当前小说的上下文，给出3种不同的情节发展方向。');
    userParts.push('每种候选需要包含：情节方向概述、关键冲突、预估字数、一段预览（100字左右）。');
    userParts.push('');
    userParts.push('用以下格式回复：');
    userParts.push('---');
    userParts.push('情节走向：<方向概述>');
    userParts.push('冲突点：<关键冲突>');
    userParts.push('预计字数：<数字>');
    userParts.push('预览：<约100字的预览片段>');
    userParts.push('---');
    userParts.push('（重复以上格式共3次）');
    userParts.push('');

    if (outline && outline.length > 0) {
        userParts.push('【大纲参考】');
        outline.forEach(n => userParts.push(`- ${n.title}: ${n.description || ''}`));
        userParts.push('');
    }

    userParts.push('【当前正文】');
    userParts.push(text.slice(-2000)); // Last 2000 chars for context
    userParts.push('');
    userParts.push('请给出3种风格各异的情节发展方向：');

    return {
        systemPrompt: buildSimpleSystemPrompt(worldBook, characters, styleGuide),
        userPrompt: userParts.join('\n'),
    };
}

/**
 * 构建灵感引导 prompt
 */
export function buildInspirePrompt(params) {
    const { text, worldBook, characters, styleGuide } = params;

    const userParts = [];

    userParts.push('作为一个创意写作顾问，请根据当前小说内容提供灵感启发。');
    userParts.push('请分析并建议：');
    userParts.push('');
    userParts.push('1. **情节拓展**：可以发展的新情节线（2-3个方向）');
    userParts.push('2. **人物深化**：可以强化的人物关系和成长弧线');
    userParts.push('3. **冲突升级**：可以引入的新矛盾或悬念');
    userParts.push('4. **场景建议**：推荐的下一场景及其氛围描写要点');
    userParts.push('5. **对话点子**：关键对话场景的建议');

    if (text) {
        userParts.push('\n【当前正文】');
        userParts.push(text.slice(-1500));
    }

    return {
        systemPrompt: buildSimpleSystemPrompt(worldBook, characters, styleGuide),
        userPrompt: userParts.join('\n'),
    };
}

// ==================== Helpers ====================

function buildSimpleSystemPrompt(worldBook, characters, styleGuide) {
    const parts = ['你是一个专业的网络小说创作顾问。'];
    if (styleGuide) parts.push(`文风：${styleGuide}`);

    const entries = getActiveWorldBookEntries(worldBook, '');
    if (entries.length > 0) {
        parts.push('世界观：' + entries.map(e => e.content).join('；'));
    }

    const chars = getRelevantCharacters(characters, '');
    if (chars.length > 0) {
        parts.push('角色：' + chars.map(c => c.data?.name || c.name || '').join('、'));
    }

    return parts.join('\n');
}

/**
 * 获取活跃的世界书条目（匹配关键词）
 */
function getActiveWorldBookEntries(worldBook, text) {
    if (!worldBook?.entries) return [];

    const entries = Object.values(worldBook.entries)
        .filter(e => !e.disable)
        .sort((a, b) => (a.order || 100) - (b.order || 100));

    if (!text) return entries.filter(e => e.constant).slice(0, 10);

    // Filter by keyword matching
    const active = [];
    for (const entry of entries) {
        if (entry.constant) {
            active.push(entry);
            continue;
        }

        if (entry.selective && entry.key?.length > 0) {
            const matched = entry.key.some(kw => {
                const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                try {
                    return new RegExp(escaped, entry.caseSensitive ? 'g' : 'gi').test(text);
                } catch {
                    return text.toLowerCase().includes(kw.toLowerCase());
                }
            });
            if (matched) active.push(entry);
        }
    }

    // If min activations is set or budget cap, handle that
    return active.slice(0, 25); // Max 25 entries
}

/**
 * 获取相关角色
 */
function getRelevantCharacters(characters, text) {
    if (!characters?.length) return [];
    if (!text) return characters.slice(0, 10);

    // Return characters whose names appear in the text
    const relevant = characters.filter(ch => {
        const name = ch.data?.name || ch.name || '';
        return name && text.includes(name);
    });

    // If no explicit matches, return first 3 characters
    return relevant.length > 0 ? relevant : characters.slice(0, 3);
}
