# Test Plan: 催更姬 v0.1.0 — 全面质量保障

**Version:** 1.0
**Created:** 2026-06-12
**Author:** QA Automation Engineer (基于 fugazi/test-automation-skills-agents)
**Status:** Draft

---

## Executive Summary

- **Feature/Product:** 催更姬 (Cuigengji) — AI 小说创作助手，Electron 桌面应用
- **Testing Objectives:**
  1. 验证 Express 后端 API 全部端点的功能正确性
  2. 验证 Electron 前端 UI 的交互逻辑和用户流程
  3. 验证 AI 续写/情节/灵感/摘要等核心生成功能的稳定性
  4. 验证数据持久化（本地文件系统）的可靠性
  5. 建立可复用的自动化回归测试套件
- **Key Risks:**
  1. AI API 连接不稳定（依赖外部服务 Anthropic/OpenAI/DeepSeek 等 15+ 提供商）
  2. 本地文件系统操作在 Electron 环境下的跨平台兼容性
  3. 前端无框架 SPA 的状态管理复杂度（Vanilla JS 全局 state 对象）
  4. 大数据量场景下（长篇小说章节/大量世界书条目）的内存和性能
- **Timeline Overview:** 2026-06-12 → 2026-06-19 (7 天)

---

## Document Control

| Version | Date       | Author              | Changes           |
| ------- | ---------- | ------------------- | ----------------- |
| 1.0     | 2026-06-12 | QA Automation Engineer | Initial draft     |

---

## Test Scope

### In Scope

- [x] **后端 API 端点** — 11 个路由模块，40+ 个端点
- [x] **前端 UI** — Electron 窗口中的欢迎页、编辑器、侧边栏、设置对话框
- [x] **AI 生成功能** — 续写、情节候选、灵感、摘要、记忆提取、连接测试
- [x] **数据管理** — 小说项目 CRUD、章节卷 CRUD、世界书/角色卡导入导出
- [x] **持久化** — 本地文件系统读写、localStorage 状态保存
- [x] **导入功能** — TXT/DOCX 文档导入、SillyTavern 世界书/角色卡/预设导入
- [x] **Electron 主进程** — 窗口创建、菜单栏、IPC 通信

**Test Types:**
- Functional testing (API + UI)
- UI/Visual testing
- Integration testing (前后端集成)
- Regression testing
- Error handling / Negative testing
- Boundary value testing

**Platforms & Environments:**
- Operating Systems: Windows 10/11 (primary), macOS, Linux
- Runtime: Node.js >= 20, Electron 33.x
- Browsers (渲染): Chromium (Electron 内嵌)
- Environments: Local development (localhost:8765)

**Critical User Flows:**
1. 启动应用 → 创建/打开工作区 → 编写章节 → AI 续写 → 保存
2. 导入小说文档 → 自动分章 → 设定世界书 → 角色卡管理 → AI 协作写作
3. 配置 AI 连接 → 选择模型 → 测试连接 → 情节研讨 → 正文续写

### Out of Scope

- [x] **AI 模型响应质量评估** — 由人工评审，自动化仅验证结构和状态码
- [x] **性能压力测试** — 本期聚焦功能正确性
- [x] **安全渗透测试** — 本期仅基础 API key 安全处理验证
- [x] **Electron 打包/DMG/AppImage** — 本期聚焦开发环境 (npm start)

---

## Test Strategy

### Test Levels

| Level       | Description                   | Scope                     |
| ----------- | ----------------------------- | ------------------------- |
| Unit        | 工具函数、服务层逻辑          | Developer responsibility  |
| Integration | API 端点 + 前后端交互         | QA responsibility         |
| System      | Electron 端到端用户流程       | QA responsibility         |
| Acceptance  | 用户验收标准                  | Stakeholder validation    |

### Test Types

| Type        | Focus                  | Tools                       | Owner            |
| ----------- | ---------------------- | --------------------------- | ---------------- |
| Functional  | 业务逻辑正确性         | Manual + Playwright         | QA Team          |
| UI/Visual   | 界面布局和外观         | Playwright + Playwright MCP | QA Team          |
| Integration | API 调用链验证         | Playwright request fixture  | QA Team          |
| Regression  | 已有功能不受影响       | Playwright suite            | QA Team          |
| Exploratory | 自由探索式测试         | Manual                      | QA Team          |

### Test Approach

**Black Box Testing:**
- Positive testing (有效输入)
- Negative testing (无效输入、缺失参数)
- Boundary value analysis (字数为 0、超长标题)
- Equivalence partitioning (不同 AI provider 等价类)

**Gray Box Testing:**
- API testing with knowledge of endpoint internals
- 文件系统状态验证（章节文件是否正确持久化）

---

## Test Environment

### Software Requirements

| Component     | Version          |
| ------------- | ---------------- |
| Node.js       | >= 20            |
| Electron      | 33.4.11          |
| npm           | 最新稳定版       |
| Playwright    | @playwright/test |
| OS (primary)  | Windows 11       |
| OS (secondary)| macOS, Linux     |

**Server:** `http://127.0.0.1:8765` (Express, launched via `node src/server.js`)

### Test Data Requirements

- [ ] 测试用小说项目（通过 `/api/novels` POST 创建）
- [ ] 测试用章节数据（通过 `/api/chapters` POST 创建）
- [ ] SillyTavern 格式的世界书 JSON 文件
- [ ] SillyTavern 格式的角色卡 PNG/JSON 文件
- [ ] 测试用 TXT/DOCX 文档文件
- [ ] AI API 连接使用环境变量 `${TEST_API_KEY}` (绝不硬编码)

---

## Entry Criteria

- [x] 项目代码可获取，依赖安装完成 (`npm install`)
- [x] 服务器可启动 (`node src/server.js`)
- [x] Electron 窗口可创建 (`node scripts/start-electron.js`)
- [ ] 测试数据准备完成
- [ ] 测试环境配置完成 (Playwright 安装)

---

## Exit Criteria

- [ ] 所有 P0 测试用例执行通过
- [ ] 90%+ P1 测试用例执行通过
- [ ] API 端点 100% 覆盖（至少 happy path + 错误处理）
- [ ] 核心用户流程 E2E 测试通过
- [ ] 无阻塞级别 bug
- [ ] 回归测试套件建立并至少执行一次

---

## Risk Assessment

| Risk                              | Probability | Impact | Mitigation Strategy                          |
| --------------------------------- | ----------- | ------ | -------------------------------------------- |
| AI API 不可用 (外部服务)          | Medium      | High   | Mock AI 响应进行独立测试；test-connection 端点验证 |
| 文件系统操作跨平台不一致          | Low         | Medium | 使用 Node.js path.join；多平台 CI 验证      |
| Electron 版本兼容性问题           | Low         | Medium | 固定 Electron 版本；关注 breaking changes    |
| 前端状态管理 bug                  | Medium      | Medium | 全面的 UI 交互测试；验证 state 一致性       |
| 长时间运行内存泄漏                | Low         | Low    | 基础内存监控；大章节加载测试                 |
| 用户提供的世界书/角色卡格式异常   | Medium      | Medium | 导入时 schema 校验；错误提示友好性            |

---

## Test Deliverables

| Deliverable           | Description                        | Due Date  |
| --------------------- | ---------------------------------- | --------- |
| Test Plan             | 本文档                             | 2026-06-12|
| API Test Specs        | Playwright API 自动化测试          | 2026-06-13|
| E2E Test Specs        | Playwright E2E 自动化测试          | 2026-06-14|
| Test Cases (Manual)   | 核心功能手动测试用例               | 2026-06-14|
| Regression Suite      | 回归测试套件策略 + 实现            | 2026-06-16|
| Bug Reports           | 缺陷文档 (发现时生成)              | Ongoing   |

---

## Schedule & Milestones

| Milestone                   | Target Date | Status  |
| --------------------------- | ----------- | ------- |
| Test Plan Approval          | 2026-06-12  | Pending |
| API Test Specs Complete     | 2026-06-13  | Pending |
| E2E Test Specs Complete     | 2026-06-14  | Pending |
| Manual Test Cases Complete  | 2026-06-14  | Pending |
| Regression Suite Complete   | 2026-06-16  | Pending |
| Automated Test Execution    | 2026-06-18  | Pending |
| Sign-off                    | 2026-06-19  | Pending |

---

## Approvals

| Role             | Name | Signature | Date |
| ---------------- | ---- | --------- | ---- |
| QA Lead          |      |           |      |
| Project Owner    |      |           |      |

---

## Appendices

### Appendix A: Project Architecture Overview

```
novel-ai-editor/
├── src/                    # Express 后端
│   ├── server.js           # 入口，挂载路由
│   ├── endpoints/          # API 端点 (11 个模块)
│   │   ├── ai.js           # AI 续写/情节/灵感/摘要
│   │   ├── chapters.js     # 章节 CRUD
│   │   ├── novels.js       # 小说项目管理
│   │   ├── chat.js         # 聊天功能
│   │   ├── import.js       # 文档导入
│   │   ├── outline.js      # 大纲管理
│   │   ├── persistence.js  # /api/save/*
│   │   ├── sessions.js     # 会话管理
│   │   ├── debug.js        # 调试工具
│   │   ├── ai-secrets.js   # API Key 安全存储
│   │   └── ...
│   └── services/           # 业务逻辑层
├── electron/               # Electron 主进程
│   └── main.js             # 窗口创建 + 菜单
├── public/                 # 前端 SPA
│   ├── index.html          # 主页面 (496 行)
│   └── js/
│       ├── app.js          # 主逻辑 (~4019 行)
│       ├── ai/             # AI 交互模块
│       └── editor/         # 编辑器模块
├── shared/schemas.js       # 前后端共享数据模型
└── data/                   # 本地文件存储
```

### Appendix B: API Endpoint Inventory

| Route               | Methods        | Module        |
| ------------------- | -------------- | ------------- |
| `/api/ping`         | GET            | server.js     |
| `/api/version`      | GET            | server.js     |
| `/api/novels`       | GET, POST      | novels.js     |
| `/api/chapters`     | GET, POST, PUT, DELETE | chapters.js |
| `/api/chapters/:id` | GET, PUT, DELETE | chapters.js |
| `/api/outline`      | GET, POST, PUT, DELETE | outline.js |
| `/api/ai/continue`  | POST           | ai.js         |
| `/api/ai/plot-suggestions` | POST    | ai.js         |
| `/api/ai/inspire`   | POST           | ai.js         |
| `/api/ai/summarize` | POST           | ai.js         |
| `/api/ai/extract-memories` | POST   | ai.js         |
| `/api/ai/list-models` | POST         | ai.js         |
| `/api/ai/test-connection` | POST     | ai.js         |
| `/api/ai/preview`   | POST           | ai.js         |
| `/api/ai/memory-status` | POST       | ai.js         |
| `/api/chat/*`       | POST           | chat.js       |
| `/api/import/*`     | POST           | import.js     |
| `/api/save/*`       | GET, POST      | persistence.js |
| `/api/sessions/*`   | GET, POST, DELETE | sessions.js |
| `/api/debug/*`      | GET            | debug.js      |
| `/api/ai-secrets/*` | GET, POST, DELETE | ai-secrets.js |
