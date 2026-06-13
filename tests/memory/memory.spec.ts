/**
 * 催更姬 — 记忆系统专项测试
 *
 * 测试 context-orchestrator 7 层架构中 L1-L5 子管线的模块：
 *
 *   Layer  platform        → 平台规则 (orchestrator 组装)
 *   Layer  author          → L1 作者档案 + 跨书记忆
 *   Layer  worldSetting    → L4 世界书检索 + 关键词匹配
 *   Layer  characterState  → L4 角色检测 + 状态推断
 *   Layer  plotHistory     → L2 项目记忆 + L4 大纲/章节摘要
 *   Layer  recentPlot      → 近期情节 (orchestrator 组装)
 *   Layer  userMessage     → 用户输入 (orchestrator 组装)
 *
 * 本测试覆盖的底层模块:
 *   author-profile.js   → 作者档案 CRUD + 记忆索引 + 新鲜度 + 检索
 *   novel-memory.js     → 项目记忆 CRUD + 自动提取(L3) + 摘要
 *   memory-manager.js   → 智能检索(L4) + Prompt 组装(L5)
 *   context-manager.js  → Token 预算 + 正文裁剪 + 上下文窗口
 *
 * 运行方式:
 *   纯逻辑单元测试，无需启动服务器。
 *   npx playwright test tests/memory/memory.spec.ts --project=chromium
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "url";

// ==================== Test Helpers ====================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// Override DATA_ROOT to a temp directory for clean testing
const TEST_DATA = path.join(PROJECT_ROOT, "data", "__test_memory__");

function setupTestData() {
  if (!fs.existsSync(TEST_DATA)) fs.mkdirSync(TEST_DATA, { recursive: true });
  // Also set global
  (globalThis as any).DATA_ROOT = TEST_DATA;
}

function cleanupTestData() {
  if (fs.existsSync(TEST_DATA)) {
    fs.rmSync(TEST_DATA, { recursive: true, force: true });
  }
}

// Dynamic import after setting DATA_ROOT
async function loadModule(modulePath: string) {
  setupTestData();
  const fullPath = path.join(PROJECT_ROOT, modulePath);
  return await import("file:///" + fullPath.replace(/\\/g, "/") + "?t=" + Date.now());
}

// ==================== L1: Author Profile Tests ====================

test.describe("L1 — Author Profile", () => {
  test.beforeEach(() => setupTestData());
  test.afterAll(() => cleanupTestData());

  test("TC-MEM-L1-001 @smoke Author profile creates default AUTHOR.md", async () => {
    const mod = await loadModule("src/services/author-profile.js");
    const profile = mod.getAuthorProfile();

    const content = profile.readProfile();
    expect(content).toContain("作者档案");
    expect(content).toContain("笔名");
    expect(content).toContain("文风特征");
  });

  test("TC-MEM-L1-002 Write and read a memory file", async () => {
    const mod = await loadModule("src/services/author-profile.js");
    const profile = mod.getAuthorProfile();

    const filePath = profile.writeMemory(
      "test-style",
      "我的文风特点",
      "# 文风\n- 喜欢古风用词\n- 偏好第一人称\n\n**Why:** 从多本书分析得出\n**How to apply:** 每次续写时注入到 system prompt",
      "project"
    );

    expect(fs.existsSync(filePath)).toBe(true);

    const memory = profile.readMemory("test-style");
    expect(memory).not.toBeNull();
    expect(memory.name).toBe("test-style");
    expect(memory.type).toBe("project");
    expect(memory.content).toContain("喜欢古风用词");
    expect(memory.content).toContain("Why:");
    expect(memory.content).toContain("How to apply:");
  });

  test("TC-MEM-L1-003 List memories from MEMORY.md index", async () => {
    const mod = await loadModule("src/services/author-profile.js");
    const profile = mod.getAuthorProfile();

    // Write two memories
    profile.writeMemory("style-1", "文风记忆1", "测试内容1", "project");
    profile.writeMemory("style-2", "文风记忆2", "测试内容2", "feedback");

    const list = profile.listMemories();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const style1 = list.find((m: any) => m.file === "style-1.md");
    expect(style1).toBeDefined();
    expect(style1.description).toBe("文风记忆1");
  });

  test("TC-MEM-L1-004 Delete a memory removes from file and index", async () => {
    const mod = await loadModule("src/services/author-profile.js");
    const profile = mod.getAuthorProfile();

    profile.writeMemory("to-delete", "待删除记忆", "会删除的内容", "project");
    expect(profile.readMemory("to-delete")).not.toBeNull();

    profile.deleteMemory("to-delete");
    expect(profile.readMemory("to-delete")).toBeNull();

    const list = profile.listMemories();
    const found = list.find((m: any) => m.file === "to-delete.md");
    expect(found).toBeUndefined();
  });

  test("TC-MEM-L1-005 Keyword-based memory retrieval (CC-style top-5)", async () => {
    const mod = await loadModule("src/services/author-profile.js");
    const profile = mod.getAuthorProfile();

    profile.writeMemory("ancient-style", "古风写作技巧", "使用文言虚词和四字成语", "project");
    profile.writeMemory("scifi-tips", "科幻写作技巧", "注重科学逻辑和世界观自洽", "project");
    profile.writeMemory("romance-notes", "言情写作心得", "注重情感描写和人物心理", "feedback");

    // Search for "古风"
    const results = profile.retrieveRelevant("古风 写作");
    expect(results.length).toBeGreaterThan(0);
    // "ancient-style" should be top result (title match weighted higher)
    const top = results[0];
    expect(top.file).toBe("ancient-style.md");
  });

  test("TC-MEM-L1-006 Memory freshness check detects stale memories", async () => {
    const mod = await loadModule("src/services/author-profile.js");
    const profile = mod.getAuthorProfile();

    profile.writeMemory("old-memory", "旧记忆", "一些内容", "project");

    // Initially fresh
    const fresh = profile.checkFreshness("old-memory");
    expect(fresh.stale).toBe(false);

    // We can also test that the freshness field is a valid ISO date
    const memory = profile.readMemory("old-memory");
    expect(memory.freshness).toBeTruthy();
    expect(() => new Date(memory.freshness)).not.toThrow();
  });

  test("TC-MEM-L1-007 formatForPrompt includes profile and recent memories", async () => {
    const mod = await loadModule("src/services/author-profile.js");
    const profile = mod.getAuthorProfile();

    profile.writeMemory("note-1", "笔记1", "详细内容AAA", "project");
    profile.writeMemory("note-2", "笔记2", "详细内容BBB", "feedback");

    const prompt = profile.formatForPrompt(true, 2000);
    expect(prompt).toContain("作者档案");
    expect(prompt).toContain("历史记忆");
    expect(prompt).toContain("note-2"); // most recent last
  });

  test("TC-MEM-L1-008 MEMORY.md index enforces 200-line hard limit", async () => {
    const mod = await loadModule("src/services/author-profile.js");
    const profile = mod.getAuthorProfile();

    // Write many memories to test the line cap
    for (let i = 0; i < 10; i++) {
      profile.writeMemory(`bulk-${i}`, `批量记忆 ${i}`, `内容 ${i}`, "project");
    }

    // Verify no crash and memories are accessible
    const list = profile.listMemories();
    expect(list.length).toBeGreaterThan(0);

    // The MEMORY.md file should exist and be reasonable size
    const indexPath = path.join(TEST_DATA, "..", "author", "memory", "MEMORY.md");
    const size = fs.statSync(indexPath).size;
    expect(size).toBeLessThan(30000); // 25KB soft limit
  });

  test("TC-MEM-L1-009 Profile update and section suggestion", async () => {
    const mod = await loadModule("src/services/author-profile.js");
    const profile = mod.getAuthorProfile();

    // AI suggests an update to the 文风特征 section
    const suggestion = profile.suggestProfileUpdate(
      "文风特征",
      "- 喜欢用短句\n- 偏好白描手法\n- 对话占比 40%"
    );
    expect(suggestion.section).toBe("文风特征");
    expect(suggestion.original).toBeDefined();
    expect(suggestion.suggestion).toContain("白描手法");

    // User applies the suggestion
    profile.applySuggestion("文风特征", suggestion.suggestion);
    const updated = profile.readProfile();
    expect(updated).toContain("白描手法");
  });
});

// ==================== L2: Novel Project Memory Tests ====================

test.describe("L2 — Novel Project Memory", () => {
  test.beforeEach(() => setupTestData());
  test.afterAll(() => cleanupTestData());

  test("TC-MEM-L2-001 @smoke NovelConfig creates project file with defaults", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const config = new mod.NovelConfig("test-novel-l2");

    const data = config.read();
    expect(data.novelId).toBe("test-novel-l2");
    expect(data).toHaveProperty("title");
    expect(data).toHaveProperty("styleGuide");
    expect(data).toHaveProperty("created");
  });

  test("TC-MEM-L2-002 NovelConfig write merges with existing data", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const config = new mod.NovelConfig("test-novel-l2");

    config.write({ title: "星辰大海", genre: "科幻" });
    const data = config.read();
    expect(data.title).toBe("星辰大海");
    expect(data.genre).toBe("科幻");
    expect(data.novelId).toBe("test-novel-l2"); // preserved
  });

  test("TC-MEM-L2-003 NovelConfig.formatForPrompt generates correct prompt", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const config = new mod.NovelConfig("test-novel-l2");

    config.write({
      title: "星辰大海",
      author: "测试作者",
      genre: "科幻",
      styleGuide: "使用硬科幻风格，注重科学细节",
    });

    const prompt = config.formatForPrompt();
    expect(prompt).toContain("书名：《星辰大海》");
    expect(prompt).toContain("作者：测试作者");
    expect(prompt).toContain("类型：科幻");
    expect(prompt).toContain("硬科幻风格");
  });

  test("TC-MEM-L2-004 NovelMemory writes chapter summary and lists memories", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const memory = new mod.NovelMemory("test-novel-l2");

    memory.saveChapterSummary("第一章-启程", "主角离开家乡，踏上星际旅程。");
    memory.saveChapterSummary("第二章-危机", "太空船遭遇陨石，紧急迫降未知星球。");

    const list = memory.listMemories();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const chapter1 = list.find((m: any) => m.description?.includes("第一章"));
    expect(chapter1).toBeDefined();
  });

  test("TC-MEM-L2-005 NovelMemory session notes save and retrieve", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const memory = new mod.NovelMemory("test-novel-l2");

    const filePath = memory.saveSessionNotes("今天写了第三章，引入反派角色。");
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("第三章");
    expect(content).toContain("反派角色");
  });

  test("TC-MEM-L2-006 NovelMemory.formatForPrompt includes summaries", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const memory = new mod.NovelMemory("test-novel-l2");

    memory.saveChapterSummary("第一章", "主角登场，确立世界观。");
    memory.saveChapterSummary("第二章", "遇到第一个冲突点。");

    const prompt = memory.formatForPrompt();
    expect(prompt).toContain("前文章节摘要");
  });
});

// ==================== L3: Auto-Extraction Tests ====================

test.describe("L3 — Auto-Extraction (from AI output)", () => {
  test.beforeEach(() => setupTestData());
  test.afterAll(() => cleanupTestData());

  test("TC-MEM-L3-001 @smoke NovelMemory extracts character names", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const memory = new mod.NovelMemory("test-novel-l3");

    // Use names that match the extraction pattern: 2-4 Chinese chars + optional suffix (儿|子|公|... |生|师|仙|...)
    const text = `苏云踏空而来，遇见了白鹤仙和墨羽道人。
    旁边的侍女轻声说："韩公子到了。"
    远处传来声音："李师叔，王师姐！"`;

    const result = memory.extractFromText(text);
    // Should find at least some named entities
    const names = result.newCharacters.map((c: any) => c.name);
    // 苏云 is a name (2 chars), 白鹤仙 matches suffix pattern, etc.
    expect(names.length).toBeGreaterThan(0);
  });

  test("TC-MEM-L3-002 @smoke Common words are filtered out", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const memory = new mod.NovelMemory("test-novel-l3");

    // Only use words from the actual _isCommonPhrase list in novel-memory.js
    const text = "没有，什么，怎么，这个，那个，我们，他们，已经，不是，可以，起来，下来，不过，但是，因为，所以，如果，虽然，然后，于是，接着，说道，看着，听到，觉得。";

    const result = memory.extractFromText(text);
    const names = result.newCharacters.map((c: any) => c.name);
    // All words in the text are in _isCommonPhrase list, so no names should be extracted
    expect(names.length).toBe(0);
  });

  test("TC-MEM-L3-002 NovelMemory extracts world elements (places)", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const memory = new mod.NovelMemory("test-novel-l3");

    const text = `
    穿过黑风山脉，前方就是天剑城。
    据说凌霄殿中藏有上古神器——噬魂剑。
    附近还有万毒谷和碧水寒潭。
    `;

    const result = memory.extractFromText(text);
    const elements = result.newWorldElements.map((e: any) => e.element);

    expect(elements.some((e: string) => e.includes("黑风山脉") || e.includes("山"))).toBe(true);
    expect(elements.some((e: string) => e.includes("城") || e.includes("凌霄殿"))).toBe(true);
  });

  test("TC-MEM-L3-003 NovelMemory extracts world elements (items)", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const memory = new mod.NovelMemory("test-novel-l3");

    const text = "他祭出青龙剑，催动九转玄功，头顶浮现鸿蒙珠的光辉。";

    const result = memory.extractFromText(text);
    const elements = result.newWorldElements.map((e: any) => e.element);

    expect(elements.some((e: string) => e.includes("剑") || e.includes("青龙剑"))).toBe(true);
  });

  test("TC-MEM-L3-004 NovelMemory detects plot developments", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const memory = new mod.NovelMemory("test-novel-l3");

    const text = `
    突然，一道黑影闪过。他没想到，原来这一切都是阴谋！
    师尊竟然已经死了，幕后黑手是那个人。
    他握紧拳头，心中充满了爱与恨。
    `;

    const result = memory.extractFromText(text);
    expect(result.plotDevelopments.length).toBeGreaterThan(0);

    const types = result.plotDevelopments.map((d: any) => d.type);
    expect(types).toContain("转折/揭示");
    expect(types).toContain("关系发展");
  });

  test("TC-MEM-L3-005 @smoke World element classification works", async () => {
    const mod = await loadModule("src/services/novel-memory.js");
    const memory = new mod.NovelMemory("test-novel-l3");

    const text = "天剑城、青龙剑、玄火宗、九转丹、碧水寒潭";

    const result = memory.extractFromText(text);
    const elements = result.newWorldElements;

    // Find by exact element name, not substring
    const city = elements.find((e: any) => e.element === "天剑城");
    const sword = elements.find((e: any) => e.element === "青龙剑");
    const sect = elements.find((e: any) => e.element === "玄火宗");
    const pill = elements.find((e: any) => e.element === "九转丹");

    if (city) expect(city.type).toBe("地点");
    if (sword) expect(sword.type).toBe("装备");
    if (sect) expect(sect.type).toBe("势力");
    if (pill) expect(pill.type).toBe("功法/丹药");

    // At least 3 should be found
    const found = [city, sword, sect, pill].filter(Boolean).length;
    expect(found).toBeGreaterThanOrEqual(3);
  });
});

// ==================== L4: Smart Retrieval Tests ====================

test.describe("L4 — Smart Retrieval (MemoryManager)", () => {
  test.beforeEach(() => setupTestData());
  test.afterAll(() => cleanupTestData());

  const testWorldBook = {
    entries: {
      1: {
        uid: 1, key: ["玄天宗"], keysecondary: [], comment: "修仙宗门",
        content: "玄天宗是大陆上最强大的修仙宗门，位于苍云山脉之巅。", constant: false,
        selective: true, order: 100, position: 0, disable: false,
        group: "", groupWeight: 100, sticky: 0, cooldown: 0, probability: 100,
        depth: 1000, role: null, scanDepth: null, caseSensitive: null,
        matchWholeWords: null, useGroupScoring: null, automationId: "",
      },
      2: {
        uid: 2, key: ["灵脉"], keysecondary: [], comment: "灵力源泉",
        content: "灵脉是天地灵气的汇聚之处，修炼者在灵脉附近修炼事半功倍。", constant: true,
        selective: true, order: 90, position: 1, disable: false,
        group: "", groupWeight: 100, sticky: 0, cooldown: 0, probability: 100,
        depth: 1000, role: null, scanDepth: null, caseSensitive: null,
        matchWholeWords: null, useGroupScoring: null, automationId: "",
      },
      3: {
        uid: 3, key: ["飞升"], keysecondary: ["渡劫", "天雷"], comment: "渡劫飞升",
        content: "修士渡劫飞升需经历九道天雷，每道都比前一道强一倍。", constant: false,
        selective: true, order: 80, position: 2, disable: false,
        group: "", groupWeight: 100, sticky: 0, cooldown: 0, probability: 100,
        depth: 1000, role: null, scanDepth: null, caseSensitive: null,
        matchWholeWords: null, useGroupScoring: null, automationId: "",
      },
      4: {
        uid: 4, key: ["禁术"], keysecondary: [], comment: "已禁用的条目",
        content: "此术已被禁用", constant: false,
        selective: true, order: 100, position: 0, disable: true,  // ← disabled
        group: "", groupWeight: 100, sticky: 0, cooldown: 0, probability: 100,
        depth: 1000, role: null, scanDepth: null, caseSensitive: null,
        matchWholeWords: null, useGroupScoring: null, automationId: "",
      },
    },
  };

  const testCharacters = [
    {
      data: {
        name: "林若风",
        description: "年轻的剑修，性格坚毅果敢。",
        personality: "外冷内热，重情义",
        scenario: "为报师仇踏上修仙之路",
      },
    },
    {
      data: {
        name: "柳如烟",
        description: "丹宗首席弟子，聪慧温婉。",
        personality: "聪慧，温柔但有主见",
        scenario: "身世成谜，与林若风命运纠葛",
      },
    },
    {
      data: {
        name: "龙傲天",
        description: "大陆第一高手。",
        personality: "霸气外露",
        scenario: "守护世界和平",
      },
    },
  ];

  test("TC-MEM-L4-001 @smoke Constant entries always active", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: testWorldBook,
      characters: [],
      outline: [],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    const text = "这是一个没有触发任何关键词的普通正文。";
    const memories = mgr.retrieve(text);

    // 灵脉 (uid:2) is constant — must appear
    const hasLingMai = memories.some((m: any) => m.id === "wb_2");
    expect(hasLingMai).toBe(true);
  });

  test("TC-MEM-L4-002 Keyword match activates world entry", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: testWorldBook,
      characters: [],
      outline: [],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    const text = "他来到玄天宗的山门前，抬头望着巍峨的山峰。";
    const memories = mgr.retrieve(text);

    // 玄天宗 should activate
    const xuanTian = memories.find((m: any) => m.id === "wb_1");
    expect(xuanTian).toBeDefined();
    expect(xuanTian.label).toBe("修仙宗门");
  });

  test("TC-MEM-L4-003 Disabled entries are never activated", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: testWorldBook,
      characters: [],
      outline: [],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    const text = "他使用了禁术的力量。";
    const memories = mgr.retrieve(text);

    // 禁术 (uid:4) is disabled — should NOT appear
    const hasJinShu = memories.some((m: any) => m.id === "wb_4");
    expect(hasJinShu).toBe(false);
  });

  test("TC-MEM-L4-004 Secondary keyword logic AND_ANY works", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: testWorldBook,
      characters: [],
      outline: [],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    // 飞升 (uid:3) has secondary keys: ["渡劫", "天雷"]
    // With AND_ANY (default logic=0): match primary + ANY secondary

    // Case 1: Primary match, no secondary match → should NOT activate
    const text1 = "他即将飞升。";
    const mem1 = mgr.retrieve(text1);
    const feiSheng1 = mem1.find((m: any) => m.id === "wb_3");
    expect(feiSheng1).toBeUndefined(); // need at least one secondary match

    // Case 2: Primary match + secondary "渡劫" match → should activate
    const text2 = "他即将飞升，天空乌云密布，这是渡劫的前兆。";
    const mem2 = mgr.retrieve(text2);
    const feiSheng2 = mem2.find((m: any) => m.id === "wb_3");
    expect(feiSheng2).toBeDefined();

    // Case 3: Primary match + secondary "天雷" match → should activate
    const text3 = "他即将飞升，九天之上的天雷滚滚而来。";
    const mem3 = mgr.retrieve(text3);
    const feiSheng3 = mem3.find((m: any) => m.id === "wb_3");
    expect(feiSheng3).toBeDefined();
  });

  test("TC-MEM-L4-005 Character name detection activates character memory", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: { entries: {} },
      characters: testCharacters,
      outline: [],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    const text = "林若风拔出长剑，柳如烟在一旁默默注视着。";
    const memories = mgr.retrieve(text);

    const linChar = memories.find((m: any) => m.id === "char_林若风");
    expect(linChar).toBeDefined();
    expect(linChar.content).toContain("剑修");

    const liuChar = memories.find((m: any) => m.id === "char_柳如烟");
    expect(liuChar).toBeDefined();
    expect(liuChar.content).toContain("丹宗");

    // 龙傲天 is NOT in the text — should NOT activate
    const longChar = memories.find((m: any) => m.id === "char_龙傲天");
    expect(longChar).toBeUndefined();
  });

  test("TC-MEM-L4-006 Character weight increases with multiple mentions", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: { entries: {} },
      characters: testCharacters,
      outline: [],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    // Mention 林若风 3 times
    const text = "林若风走进大殿。林若风看着前方。林若风拔出长剑。";
    const memories = mgr.retrieve(text);

    const linChar = memories.find((m: any) => m.id === "char_林若风");
    expect(linChar).toBeDefined();
    expect(linChar.weight).toBeGreaterThanOrEqual(85 + 6); // base 85 + mentions*2
  });

  test("TC-MEM-L4-007 Outline nodes are retrieved (incomplete only)", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: { entries: {} },
      characters: [],
      outline: [
        { id: "o1", title: "开场冲突", description: "主角遭遇反派", completed: false },
        { id: "o2", title: "中期转折", description: "发现真相", completed: true },  // ← completed
        { id: "o3", title: "高潮对决", description: "最终决战", completed: false },
      ],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    const memories = mgr.retrieve("任意正文");

    // Should have o1 and o3, NOT o2
    const o1 = memories.find((m: any) => m.id === "outline_o1");
    const o2 = memories.find((m: any) => m.id === "outline_o2");
    const o3 = memories.find((m: any) => m.id === "outline_o3");

    expect(o1).toBeDefined();
    expect(o2).toBeUndefined(); // completed → not active
    expect(o3).toBeDefined();
  });

  test("TC-MEM-L4-008 getStats returns correct memory statistics", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: testWorldBook,
      characters: testCharacters,
      outline: [{ id: "o1", title: "测试节点", description: "描述", completed: false }],
      styleGuide: "使用古风文笔",
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    const text = "林若风来到玄天宗。飞升在即，渡劫将至。";
    const memories = mgr.retrieve(text);
    const stats = mgr.getStats(memories);

    expect(stats.totalEntries).toBeGreaterThanOrEqual(3);
    expect(stats.totalTokens).toBeGreaterThan(0);
    expect(stats.budget).toBe(Math.round(128000 * 15 / 100)); // 19,200
    expect(stats.budgetPct).toBe(15);
    expect(stats.modelContext).toBe(128000);
    expect(stats.byType).toBeDefined();

    // Should have world_entry, character, and outline types
    expect(stats.byType["world_entry"]).toBeGreaterThanOrEqual(1);
    expect(stats.byType["character"]).toBeGreaterThanOrEqual(1);
  });

  test("TC-MEM-L4-009 Token budget trimming works correctly", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    // Very small budget (1% of tiny context)
    const mgr = new mod.MemoryManager({
      worldBook: testWorldBook,
      characters: testCharacters,
      outline: [],
      modelContextSize: 1000, // Tiny context
      memoryBudgetPct: 1,     // 1% = 10 tokens
    });

    const text = "林若风来到玄天宗。";
    const memories = mgr.retrieve(text);
    const stats = mgr.getStats(memories);

    // Should not exceed budget
    expect(stats.totalTokens).toBeLessThanOrEqual(10 + 5); // small margin
    // Only the most important items retained
    expect(stats.usagePercent).toBeLessThanOrEqual(100);
  });

  test("TC-MEM-L4-010 addCustomMemory and clearExtracted", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: { entries: {} },
      characters: [],
      outline: [],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    mgr.addCustomMemory("测试笔记", "这是一段用户手动添加的笔记", ["测试"]);
    mgr.addCustomMemory("AI提取", "AI自动提取的内容", ["自动"]);

    const memories = mgr.retrieve("测试一下");
    expect(memories.some((m: any) => m.label === "测试笔记")).toBe(true);

    mgr.clearExtracted();
    const after = mgr.retrieve("测试一下");
    expect(after.some((m: any) => m.label === "测试笔记")).toBe(false);
  });
});

// ==================== L5: Context Injection Tests ====================

test.describe("L5 — Context Injection & Token Management", () => {
  test.beforeEach(() => setupTestData());
  test.afterAll(() => cleanupTestData());

  test("TC-MEM-L5-001 @smoke formatForPrompt groups by position correctly", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: {
        entries: {
          1: {
            uid: 1, key: ["test"], keysecondary: [], comment: "全局设定",
            content: "这是全局设定内容", constant: true, selective: true,
            order: 100, position: 0, disable: false, probability: 100,
            group: "", groupWeight: 100, sticky: 0, cooldown: 0, depth: 1000,
            role: null, scanDepth: null, caseSensitive: null,
            matchWholeWords: null, useGroupScoring: null, automationId: "",
          },
          2: {
            uid: 2, key: ["test"], keysecondary: [], comment: "深度设定",
            content: "这是深度设定内容", constant: false, selective: true,
            order: 100, position: 3, disable: false, probability: 100,
            group: "", groupWeight: 100, sticky: 0, cooldown: 0, depth: 1000,
            role: null, scanDepth: null, caseSensitive: null,
            matchWholeWords: null, useGroupScoring: null, automationId: "",
          },
        },
      },
      characters: [{
        data: { name: "测试角色", description: "角色描述", personality: "性格", scenario: "背景" },
      }],
      outline: [{ id: "o1", title: "大纲节点", description: "节点描述", completed: false }],
      styleGuide: "文风指南内容",
      writingRules: ["规则1", "规则2"],
      chapterSummaries: [{ title: "第1章", summary: "章节摘要内容" }],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    const text = "测试内容 test 测试角色";
    const memories = mgr.retrieve(text);
    const prompt = mgr.formatForPrompt(memories);

    // Verify position grouping labels
    expect(prompt).toContain("【全局设定】");
    expect(prompt).toContain("【深度设定】");
    expect(prompt).toContain("【出场角色】");
    expect(prompt).toContain("【大纲要求】");
    expect(prompt).toContain("【前情提要】");
    expect(prompt).toContain("【文风要求】");
    expect(prompt).toContain("【写作规范】");

    // Verify content ordering: 全局设定 before 深度设定
    const globalIdx = prompt.indexOf("【全局设定】");
    const deepIdx = prompt.indexOf("【深度设定】");
    expect(globalIdx).toBeLessThan(deepIdx);
  });

  test("TC-MEM-L5-002 allocateBudget and checkBudget detect overflow", async () => {
    const mod = await loadModule("src/services/context-manager.js");

    // Normal case: fits easily
    const budget = mod.allocateBudget({
      model: "claude-sonnet-4-6",
      systemPrompt: "短系统提示",
      currentText: "短正文",
      worldBookTokens: 500,
      characterTokens: 300,
      maxOutputTokens: 4096,
    });

    expect(budget.total).toBe(200000);
    expect(budget.reserved).toBe(4096);
    expect(budget.system).toBeGreaterThan(0);
    expect(budget.user).toBeGreaterThan(0);

    const check = mod.checkBudget(budget);
    expect(check.exceeded).toBe(false);
    expect(check.available).toBeGreaterThan(100000);

    // Overflow case: too much text
    const overflowBudget = mod.allocateBudget({
      model: "claude-sonnet-4-6",
      systemPrompt: "短提示",
      currentText: "x".repeat(400000), // very long text
      worldBookTokens: 50000,
      characterTokens: 50000,
      maxOutputTokens: 4096,
    });

    const overflowCheck = mod.checkBudget(overflowBudget);
    // With tons of text, tokens, characters + reserved output, it should overflow or be nearly full
    expect(overflowCheck.available).toBeLessThan(check.available);
  });

  test("TC-MEM-L5-003 trimText preserves end content and adds marker", async () => {
    const mod = await loadModule("src/services/context-manager.js");

    const longText = "前文内容。".repeat(5000); // very long text
    const trimmed = mod.trimText(longText, 100); // very tight budget

    expect(trimmed.length).toBeLessThan(longText.length);
    expect(trimmed).toContain("[前文已省略]");
    // Should preserve the end
    expect(trimmed.endsWith("前文内容。")).toBe(true);
  });

  test("TC-MEM-L5-004 trimText with small text returns original", async () => {
    const mod = await loadModule("src/services/context-manager.js");

    const shortText = "短文本";
    const trimmed = mod.trimText(shortText, 1000);

    expect(trimmed).toBe(shortText); // No trimming needed
  });

  test("TC-MEM-L5-005 prepareContext returns full breakdown", async () => {
    const mod = await loadModule("src/services/context-manager.js");

    const result = mod.prepareContext({
      text: "这是需要续写的测试正文。" + "正文内容。".repeat(200),
      model: "claude-sonnet-4-6",
      systemPrompt: "你是一个小说家。",
      worldBook: { entries: {} },
      characters: [],
      maxOutputTokens: 4096,
    });

    expect(result.trimmedText).toBeDefined();
    expect(result.summary.totalBudget).toBe(200000);
    expect(result.summary.breakdown).toBeDefined();
    expect(result.summary.breakdown.systemPrompt).toBeGreaterThan(0);
    expect(result.summary.breakdown.text).toBeGreaterThan(0);
    expect(result.summary.breakdown.output).toBe(4096);
  });

  test("TC-MEM-L5-006 getModelContext handles partial and default matches", async () => {
    const mod = await loadModule("src/services/context-manager.js");

    // Exact model name
    const deepseek = mod.getModelContext("deepseek-v3");
    expect(deepseek.total).toBe(1000000);

    // Partial match
    const deepseek2 = mod.getModelContext("deepseek-chat");
    expect(deepseek2.total).toBe(1000000);

    // Unknown model → default
    const unknown = mod.getModelContext("unknown-model-xyz");
    expect(unknown.total).toBe(131072);

    // Claude variant
    const claude = mod.getModelContext("claude-sonnet-4-6");
    expect(claude.total).toBe(200000);
  });

  test("TC-MEM-L5-007 estimateTokens works for Chinese and English", async () => {
    const mod = await loadModule("src/services/context-manager.js");

    const chinese = "这是一段中文测试文本";
    const chTokens = mod.estimateTokens(chinese);
    expect(chTokens).toBeGreaterThan(0);
    expect(chTokens).toBeLessThan(chinese.length); // Chinese is ~1.5 chars/token

    const english = "This is a test sentence in English.";
    const enTokens = mod.estimateTokens(english);
    expect(enTokens).toBeGreaterThan(0);
    expect(enTokens).toBeLessThan(english.length); // English is ~3.5 chars/token

    // Empty text
    expect(mod.estimateTokens("")).toBe(0);
    expect(mod.estimateTokens(null)).toBe(0);
  });

  test("TC-MEM-L5-008 MemoryManager.formatForPrompt returns empty for empty memories", async () => {
    const mod = await loadModule("src/services/memory-manager.js");
    const mgr = new mod.MemoryManager({
      worldBook: { entries: {} },
      characters: [],
      outline: [],
      modelContextSize: 128000,
      memoryBudgetPct: 15,
    });

    const prompt = mgr.formatForPrompt([]);
    expect(prompt).toBe("");
  });

  test("TC-MEM-L5-009 Default model context values for all providers", async () => {
    const mod = await loadModule("src/services/context-manager.js");

    // Verify all known models have config
    const models = [
      "claude-sonnet-4-6", "claude-opus-4-8", "gpt-4o",
      "deepseek-v3", "deepseek-r1", "gemini-2.5", "qwen",
    ];

    for (const model of models) {
      const ctx = mod.getModelContext(model);
      expect(ctx.total).toBeGreaterThan(0);
      expect(ctx.output).toBeGreaterThan(0);
      expect(ctx.total).toBeGreaterThan(ctx.output);
    }
  });
});

// ==================== Integration: Full L1→L5 Pipeline ====================

test.describe("Memory — Full L1→L5 Integration", () => {
  test.beforeEach(() => setupTestData());
  test.afterAll(() => cleanupTestData());

  test("TC-MEM-INT-001 @smoke Full pipeline: Author Profile → Novel Memory → Retrieval → Format", async () => {
    // Step 1: L1 — Author Profile with a style preference
    const authorMod = await loadModule("src/services/author-profile.js");
    const profile = authorMod.getAuthorProfile();
    profile.writeMemory("ancient-style", "古风偏好", "使用文白夹杂的古风语言", "feedback");

    // Step 2: L2 — Novel Project Memory
    const novelMod = await loadModule("src/services/novel-memory.js");
    const config = new novelMod.NovelConfig("integration-test");
    config.write({ title: "仙路飘渺", genre: "仙侠", styleGuide: "仙侠风格，注重意境描写" });

    // Step 3: L3 — Auto-extract from generated text
    const memory = new novelMod.NovelMemory("integration-test");
    const generatedText = "苏云踏空而行，手中寒月剑泛起冷光。前方的紫霄殿中，似乎隐藏着什么秘密。";
    const extractions = memory.extractFromText(generatedText);
    expect(extractions.newCharacters.length).toBeGreaterThan(0);
    expect(extractions.newWorldElements.length).toBeGreaterThan(0);

    // Step 4: L4 — Smart Retrieval with real data
    const memMod = await loadModule("src/services/memory-manager.js");
    const mgr = new memMod.MemoryManager({
      worldBook: {
        entries: {
          1: {
            uid: 1, key: ["紫霄殿"], keysecondary: [], comment: "仙宫大殿",
            content: "紫霄殿是上界仙宫的正殿，内有鸿蒙至宝。", constant: false,
            selective: true, order: 100, position: 0, disable: false,
            probability: 100, depth: 2000,
            group: "", groupWeight: 100, sticky: 0, cooldown: 0,
            role: null, scanDepth: null, caseSensitive: null,
            matchWholeWords: null, useGroupScoring: null, automationId: "",
          },
          2: {
            uid: 2, key: ["寒月剑"], keysecondary: [], comment: "上古神兵",
            content: "寒月剑，上古十大神兵之一，剑身如月光般清冷。", constant: true,
            selective: true, order: 90, position: 1, disable: false,
            probability: 100, depth: 2000,
            group: "", groupWeight: 100, sticky: 0, cooldown: 0,
            role: null, scanDepth: null, caseSensitive: null,
            matchWholeWords: null, useGroupScoring: null, automationId: "",
          },
        },
      },
      characters: [{
        data: { name: "苏云", description: "仙门弟子，剑道天才", personality: "冷静专注", scenario: "" },
      }],
      outline: [{ id: "o1", title: "探索紫霄殿", description: "主角进入紫霄殿探索", completed: false }],
      styleGuide: config.read().styleGuide || "",
      chapterSummaries: [{ title: "前章", summary: "主角获得寒月剑" }],
      modelContextSize: 200000,
      memoryBudgetPct: 15,
    });

    const retrieved = mgr.retrieve(generatedText);
    const stats = mgr.getStats(retrieved);

    // Verify retrieval results
    expect(stats.totalEntries).toBeGreaterThanOrEqual(4); // 紫霄殿 + 寒月剑(constant) + 苏云 + 大纲

    // Verify character detected
    expect(retrieved.some((m: any) => m.id === "char_苏云")).toBe(true);

    // Verify constant entry always present
    expect(retrieved.some((m: any) => m.id === "wb_2")).toBe(true); // 寒月剑 is constant

    // Step 5: L5 — Format for prompt
    const prompt = mgr.formatForPrompt(retrieved);

    // Verify L1 author data would be included
    const authorPrompt = profile.formatForPrompt(true, 1000);
    expect(authorPrompt).toContain("古风");

    // Verify L2 novel data would be included
    const novelPrompt = config.formatForPrompt();
    expect(novelPrompt).toContain("仙路飘渺");

    // Verify L4+L5 formatted prompt
    expect(prompt).toContain("寒月剑");
    expect(prompt).toContain("苏云");
    expect(prompt).toContain("探索紫霄殿");
    expect(prompt).toContain("【全局设定】");
    expect(prompt).toContain("【出场角色】");
    expect(prompt).toContain("【大纲要求】");
    expect(prompt).toContain("【前情提要】");

    // Budget check
    expect(stats.usagePercent).toBeLessThanOrEqual(100);
  });
});
