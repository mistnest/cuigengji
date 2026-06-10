/**
 * Novel AI Editor — Shared Data Schemas
 * 数据模型定义，确保前后端数据格式一致
 */

// ==================== Novel Project ====================
export const NovelSchema = {
    id: '',               // 唯一标识
    title: '',            // 书名
    author: '',           // 作者
    genre: '',            // 类型/标签
    synopsis: '',         // 作品简介
    styleGuide: '',       // 文风指南
    created: 0,           // 创建时间戳
    updated: 0,           // 更新时间戳
    volumes: [],          // [{id, title, order, chapters: [...]}]
    outline: {},          // 大纲树
    characters: [],       // 关联角色ID列表
    worldBooks: [],       // 关联世界书ID列表
};

// ==================== Chapter ====================
export const ChapterSchema = {
    id: '',
    novelId: '',
    volumeId: '',         // 所属卷
    title: '',
    content: '',
    summary: '',          // 章节摘要 (AI 生成)
    wordCount: 0,
    status: 'draft',      // 'draft' | 'writing' | 'completed' | 'revised'
    order: 0,
    created: 0,
    updated: 0,
    notes: '',            // 作者笔记
    plotPoints: [],       // 本章情节节点
};

// ==================== Outline Node ====================
export const OutlineNodeSchema = {
    id: '',
    novelId: '',
    parentId: '',         // 父节点ID (树形结构)
    title: '',
    description: '',      // 节点描述
    type: 'plot',         // 'arc' | 'plot' | 'scene' | 'note'
    chapterId: '',        // 关联章节
    order: 0,
    completed: false,
    children: [],
};

// ==================== World Book Entry (兼容 ST 格式) ====================
export const WorldBookEntrySchema = {
    uid: 0,
    key: [],              // 主关键词
    keysecondary: [],     // 次级关键词
    comment: '',          // 备注/显示名
    content: '',          // 注入内容
    constant: false,      // 始终激活
    selective: true,      // 选择性激活
    order: 100,           // 排序权重
    position: 0,          // 注入位置 (0=角色前, 1=角色后, 2=depth, 3=@D)
    disable: false,
    group: '',            // 分组
    groupWeight: 100,
    sticky: 0,
    cooldown: 0,
    probability: 100,
    depth: 4,             // 扫描深度
    role: null,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
};

// ==================== Character Card (兼容 ST v3 格式) ====================
export const CharacterCardSchema = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name: '',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        character_book: { entries: {} },  // 内嵌世界书
        tags: [],
        creator: '',
        character_version: '',
        extensions: {},
    },
};

// ==================== AI Preset (兼容 ST 格式) ====================
export const AIPresetSchema = {
    name: '',
    provider: '',         // 'anthropic' | 'openai' | 'openrouter' | 'ollama'
    temperature: 0.7,
    max_tokens: 4096,
    top_p: 0.9,
    top_k: 40,
    frequency_penalty: 0,
    presence_penalty: 0,
    repetition_penalty: 1.0,
    stop: [],
    seed: null,
    stream: true,
    systemPrompt: '',     // 自定义系统提示
    prefill: '',          // 预填充文本
};

// ==================== AI Generation Request ====================
export const GenerationRequestSchema = {
    text: '',             // 当前正文
    chapterContext: '',   // 章节上下文 (前文)
    config: {},           // AI 配置
    worldBook: {},        // 世界书数据
    characters: [],       // 角色列表
    outline: [],          // 大纲
    styleGuide: '',       // 文风指南
    instructions: '',     // 额外指令
};

// ==================== AI Plot Candidate ====================
export const PlotCandidateSchema = {
    index: 0,
    direction: '',        // 情节走向
    preview: '',          // 预览片段
    estimatedWords: 0,    // 预计字数
    conflict: '',         // 冲突点
    charactersInvolved: [], // 涉及角色
    worldBookEntries: [],   // 涉及世界观条目
};
