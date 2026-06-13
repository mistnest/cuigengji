# Test Cases: 催更姬 v0.1.0 — 手动测试用例集

> 遵循 qa-test-planner skill `templates/test-case.md` 模板规范

---

## TC-MANUAL-001: 欢迎页加载 — 首次启动

**Priority:** P0 (Critical)
**Type:** Functional / UI
**Status:** Not Run
**Estimated Time:** 2 minutes
**Created:** 2026-06-12
**Author:** QA Automation Engineer

### Objective

验证应用首次启动时欢迎页正确渲染，所有元素可见且可交互。

### Preconditions

- 服务器已启动：`node src/server.js`
- 浏览器访问 `http://127.0.0.1:8765`
- 本地存储已清理（无历史工作区数据）

### Test Steps

1. 打开浏览器访问 `http://127.0.0.1:8765`
   **Expected:** 显示欢迎页，包含催更姬 logo/标题

2. 检查页面标题
   **Expected:** 浏览器标签页标题显示 "催更姬"

3. 检查欢迎页元素
   **Expected:** 看到 "+ 新建工作区" 和 "↗ 导入文档" 按钮；看到 "最近" 区域（显示 "暂无工作区" 或加载中）

4. 检查控制台
   **Expected:** 无 JavaScript 报错（忽略 favicon 404）

### Test Data

- 无需特殊数据

### Post-conditions

- 无

### Edge Cases & Variations

- 如果 `data/novels/` 目录已有项目，应出现在 "最近" 列表中
- 刷新页面后状态应一致

### Automation Status

**Status:** Automated
**Automation File:** `tests/e2e/novel-editor.spec.ts` — TC-E2E-001

---

## TC-MANUAL-002: 创建工作区 → 进入编辑器

**Priority:** P0 (Critical)
**Type:** Functional
**Status:** Not Run
**Estimated Time:** 3 minutes
**Created:** 2026-06-12

### Objective

验证通过欢迎页创建新工作区并进入主编辑器的完整流程。

### Preconditions

- 服务器已启动

### Test Steps

1. 点击 "+ 新建工作区" 按钮
   **Expected:** 弹出命名对话框

2. 输入工作区名称 "我的第一本小说"，点击确认
   **Expected:** 欢迎页隐藏，进入三栏编辑器布局

3. 检查编辑器布局
   **Expected:** 左侧显示 "章节/大纲" 标签；中间显示编辑区 textarea；右侧显示 "对话/世界书/角色/AI" 标签

4. 检查状态栏
   **Expected:** 底部显示 "就绪"、连接状态、字数为 0、"已保存"

### Test Data

- 工作区名称: "我的第一本小说"

### Edge Cases

- 空名称取消操作 — 应回到欢迎页
- 特殊字符名称 — 验证 sanitize 处理
- 同名工作区 — 应提示 "项目已存在"

### Automation Status

**Status:** Automated
**Automation File:** `tests/e2e/novel-editor.spec.ts` — TC-E2E-002

---

## TC-MANUAL-003: 章节管理 CRUD 流程

**Priority:** P0 (Critical)
**Type:** Functional
**Status:** Not Run
**Estimated Time:** 5 minutes
**Created:** 2026-06-12

### Objective

验证卷和章节的创建、编辑、删除完整流程。

### Preconditions

- 已进入工作区（编辑器可见）

### Test Steps

1. 点击 "新卷" 按钮
   **Expected:** 章节树中出现新卷节点

2. 点击 "新章节" 按钮
   **Expected:** 章节树中出现新章节（如"第1章"），编辑器加载空白内容

3. 在编辑器中输入正文内容
   **Expected:** 字数统计实时更新

4. 修改章节标题
   **Expected:** 章节标题输入框和顶部标题同步更新

5. 点击 "保存" 按钮
   **Expected:** 状态栏显示 "已保存"

6. 在章节树中右键 → 删除章节
   **Expected:** 确认后章节被删除，从树中移除

7. 删除卷
   **Expected:** 卷及其下章节被删除或解除关联

### Test Data

- 测试正文：任意中文段落（≥100字）

### Edge Cases

- 无章节时点击保存 — 应自动创建新章节
- 删除当前正在编辑的章节 — 应切换到下一章节
- 章节移动到不同卷 — 验证文件系统移动

### Automation Status

**Status:** Partially Automated
**Automation File:** `tests/api/api.spec.ts` (API level), `tests/e2e/novel-editor.spec.ts` — TC-E2E-011

---

## TC-MANUAL-004: AI 连接设置

**Priority:** P0 (Critical)
**Type:** Functional / Integration
**Status:** Not Run
**Estimated Time:** 5 minutes
**Created:** 2026-06-12

### Objective

验证 AI 提供商选择、API Key 输入、连接测试和预设管理的完整流程。

### Preconditions

- 已进入工作区
- 拥有有效的 AI 服务 API Key（Anthropic 或 DeepSeek）

### Test Steps

1. 切换到右侧 "AI" 面板
   **Expected:** 显示 AI 工具面板，有 "续写正文" 按钮和连接设置

2. 选择提供商 "Claude (Anthropic)"
   **Expected:** 下拉框值变为 "anthropic"

3. 在 API Key 输入框粘贴有效 Key
   **Expected:** 输入框接受并隐藏显示（password 类型）

4. 点击 "测试连接"
   **Expected:** 状态栏显示 "✅ 连接成功!"，连接徽章变为绿色

5. 输入无效 Key 再测试
   **Expected:** 状态栏显示 "❌ ..." 错误信息

6. 点击 "保存" 配置方案按钮
   **Expected:** 弹出提示或自动保存

7. 刷新页面
   **Expected:** API Key 通过 `/api/ai-secrets/status` 恢复，连接状态显示已保存

### Test Data

- 有效 API Key: `${TEST_ANTHROPIC_API_KEY}`（环境变量）
- 无效 API Key: `invalid-key-12345`

### Edge Cases

- Ollama 提供商不需要 API Key
- 自定义 API 端点 + Key 的组合
- API Key 的 provider 切换时 Key 清空

### Automation Status

**Status:** Partially Automated
**Automation File:** `tests/e2e/novel-editor.spec.ts` — TC-E2E-020/021/022

---

## TC-MANUAL-005: 世界书导入与管理

**Priority:** P1 (High)
**Type:** Functional
**Status:** Not Run
**Estimated Time:** 10 minutes
**Created:** 2026-06-12

### Objective

验证 SillyTavern 格式世界书 JSON 文件的导入、条目查看、搜索、分组筛选、批量管理功能。

### Preconditions

- 已进入工作区
- 准备好 SillyTavern 格式的世界书 JSON 文件（可从 `data/default-user/worlds/` 获取测试文件）

### Test Steps

1. 切换到右侧 "世界书" 面板
   **Expected:** 空列表，显示 "尚未导入世界书"

2. 点击 "导入" 按钮选择世界书 JSON 文件
   **Expected:** 导入成功提示，显示条目数

3. 查看世界书条目列表
   **Expected:** 每个条目显示名称、关键词、状态（待触发/触发中/始终激活）

4. 点击某条目查看详情
   **Expected:** 展开条目详情面板

5. 在编辑器正文中输入世界书条目的关键词
   **Expected:** 对应条目状态变为 "触发中"（●）

6. 使用分组筛选
   **Expected:** 可按来源分组筛选条目

7. 切换写作参考模式："参考全部设定" → "只参考选中分组" → "不参考世界书"
   **Expected:** 条目状态和参考标记相应变化

8. 使用批量管理模式
   **Expected:** 可多选、全选、批量删除

### Test Data

- 测试世界书文件: `${TEST_WORLDBOOK_JSON}`

### Edge Cases

- 导入格式不正确的 JSON — 应有错误提示
- 世界书条目数为 0 — 空列表正常渲染
- 特殊字符关键词匹配

### Automation Status

**Status:** Not Yet Automated

---

## TC-MANUAL-006: 角色卡导入与管理

**Priority:** P1 (High)
**Type:** Functional
**Status:** Not Run
**Estimated Time:** 10 minutes
**Created:** 2026-06-12

### Objective

验证 SillyTavern v2/v3 格式角色卡的导入、查看、写作参考功能。

### Preconditions

- 已进入工作区
- 准备好 SillyTavern 角色卡 PNG 或 JSON 文件

### Test Steps

1. 切换到右侧 "角色" 面板
   **Expected:** 空列表，显示 "尚未导入角色"

2. 点击 "导入" 按钮选择角色卡 PNG 文件
   **Expected:** 自动解析 PNG 内嵌的 chara 数据，导入成功

3. 导入多个角色卡
   **Expected:** 列表显示所有角色

4. 点击某角色查看详情
   **Expected:** 展开角色详情面板（名称、描述、性格等）

5. 在编辑器正文中提及角色名称
   **Expected:** 角色状态变为 "触发中"

6. 切换字符参考模式：自动识别 → 只参考选中 → 不参考
   **Expected:** 角色状态相应变化

### Test Data

- 测试角色卡 PNG: `${TEST_CHARACTER_PNG}`
- 测试角色卡 JSON: `${TEST_CHARACTER_JSON}`

### Edge Cases

- 导入非角色卡 PNG（无 chara 数据）— 应有错误提示
- 导入超大角色卡（>5MB）— 性能正常
- 角色名称含特殊字符

### Automation Status

**Status:** Not Yet Automated

---

## TC-MANUAL-007: 文档导入与自动分章

**Priority:** P1 (High)
**Type:** Functional / Integration
**Status:** Not Run
**Estimated Time:** 5 minutes
**Created:** 2026-06-12

### Objective

验证 TXT/DOCX 文档导入功能，包括自动分章。

### Preconditions

- 已进入工作区
- 准备好 TXT 测试文件（内容需有章节标记如 "第X章" 或 "Chapter X"）

### Test Steps

1. 在欢迎页点击 "↗ 导入文档"
   **Expected:** 弹出文件选择对话框

2. 选择 TXT 文件
   **Expected:** 弹出工作区命名对话框

3. 输入工作区名称并确认
   **Expected:** 自动创建章节，每个章节显示在树中

4. 点击各章节查看内容
   **Expected:** 章节内容已正确拆分

5. 测试 DOCX 格式导入
   **Expected:** 自动转换并分章

### Test Data

- TXT 测试文件: `${TEST_TXT_FILE}`
- DOCX 测试文件: `${TEST_DOCX_FILE}`

### Edge Cases

- 空文件 — 应正常处理
- 超大文件 (>50MB) — 应有提示或超时处理
- 编码检测 (GBK/UTF-8) — 中文字符不乱码

### Automation Status

**Status:** Not Yet Automated

---

## TC-MANUAL-008: 大纲管理

**Priority:** P2 (Medium)
**Type:** Functional
**Status:** Not Run
**Estimated Time:** 5 minutes
**Created:** 2026-06-12

### Objective

验证大纲节点的创建、编辑、树形展开/折叠功能。

### Preconditions

- 已进入工作区

### Test Steps

1. 切换到左侧 "大纲" 面板
   **Expected:** 显示空大纲树

2. 点击 "新节点" 创建大纲节点
   **Expected:** 弹出节点编辑对话框

3. 输入标题和描述，保存
   **Expected:** 节点出现在大纲树中

4. 创建子节点
   **Expected:** 子节点缩进在父节点下

5. 标记节点为完成
   **Expected:** 节点有完成标记

### Edge Cases

- 最大嵌套深度 — 5 层以上应正常
- 删除父节点 — 子节点处理逻辑

### Automation Status

**Status:** Not Yet Automated

---

## TC-MANUAL-009: 聊天/正文模式切换

**Priority:** P2 (Medium)
**Type:** Functional
**Status:** Not Run
**Estimated Time:** 5 minutes
**Created:** 2026-06-12

### Objective

验证三种模式的切换：正文模式、情节研讨、设定制作。

### Preconditions

- 已进入工作区
- AI 连接已配置并且可用

### Test Steps

1. 在聊天面板确认默认模式为 "正文模式"
   **Expected:** 模式描述显示 "正文模式 — AI 协作续写"

2. 点击模式选择器切换到 "情节研讨"
   **Expected:** 模式描述更新；快捷命令按钮可能变化

3. 切换到 "设定制作"
   **Expected:** 模式描述更新

4. 测试快捷命令按钮（续/析/改）
   **Expected:** 点击后在输入框写入对应命令

### Edge Cases

- 未连接 AI 时切换模式 — 正常切换，后续连接时可用

### Automation Status

**Status:** Partially Automated
**Automation File:** `tests/e2e/webapp.spec.ts` — TC-WEB-032/033

---

## TC-MANUAL-010: 数据持久化验证

**Priority:** P0 (Critical)
**Type:** Integration
**Status:** Not Run
**Estimated Time:** 8 minutes
**Created:** 2026-06-12

### Objective

验证章节、设置、工作区配置在刷新/重启后正确恢复。

### Preconditions

- 已创建工作区、章节、输入正文内容

### Test Steps

1. 创建章节并输入正文，保存
   **Expected:** 保存成功

2. 刷新浏览器页面
   **Expected:** 欢迎页显示，之前的工作区出现在 "最近" 列表中

3. 点击工作区卡片进入
   **Expected:** 章节树恢复，之前编辑的章节内容正确加载

4. 检查 AI 设置是否恢复
   **Expected:** provider、model、temperature 恢复为上次的值

5. 检查世界书和角色卡是否恢复
   **Expected:** 世界书条目和角色卡列表恢复

6. 手动检查数据文件
   **Expected:** `data/novels/<id>/chapters/` 下有对应章节 JSON 文件

### Test Data

- 测试正文内容

### Edge Cases

- 服务器重启 — 数据不丢失
- localStorage 清理 — 本地 UI 设置重置但不影响文件数据

### Automation Status

**Status:** Partially Automated
**Automation File:** `tests/api/api.spec.ts` (API level persistence)

---

## Test Execution Summary

| TC-ID            | Title                      | Priority | Auto Status     |
| ---------------- | -------------------------- | -------- | --------------- |
| TC-MANUAL-001    | 欢迎页加载                 | P0       | Automated       |
| TC-MANUAL-002    | 创建工作区 → 进入编辑器    | P0       | Automated       |
| TC-MANUAL-003    | 章节管理 CRUD              | P0       | Partially       |
| TC-MANUAL-004    | AI 连接设置                | P0       | Partially       |
| TC-MANUAL-005    | 世界书导入与管理           | P1       | Not Automated   |
| TC-MANUAL-006    | 角色卡导入与管理           | P1       | Not Automated   |
| TC-MANUAL-007    | 文档导入与自动分章         | P1       | Not Automated   |
| TC-MANUAL-008    | 大纲管理                   | P2       | Not Automated   |
| TC-MANUAL-009    | 聊天/正文模式切换          | P2       | Partially       |
| TC-MANUAL-010    | 数据持久化验证             | P0       | Partially       |
