# 催更姬 v1.0 项目结构说明

本文档按当前源码整理，作为开源仓库的结构说明和维护入口。旧实验文档、旧上下文链路说明、阶段性测试报告不再作为事实来源。

## 项目定位

催更姬是一个面向长篇小说创作的本地 AI 编辑器。它把正文编辑、项目管理、世界书、角色卡、预设、章节记忆、流式写作和设定提取整合在一个本地应用里。

当前运行形态是：

- 后端：Express 本地服务。
- 前端：`public/` 下的原生 HTML/CSS/JavaScript 单页应用。
- 桌面端：Electron 启动内嵌 Express，并加载本地页面。
- 数据：默认保存在本机 `data/` 或 Electron 用户数据目录，不上传到项目服务器。

## 顶层目录

```text
cuigengji/
├── electron/              Electron 桌面入口
├── public/                前端页面、样式、浏览器端 JS、图片资源
├── scripts/               启动、封包、构建、诊断脚本
├── src/                   Express 后端、服务层、导入解析、AI 适配
├── tests/                 Playwright API/E2E/记忆系统测试
├── docs/                  当前可信项目文档
├── package.json           npm 脚本、依赖、electron-builder 配置
├── README.md              面向用户和开发者的入口说明
├── LICENSE                自定义社区许可证
├── NOTICE                 项目声明与来源标识说明
└── CONTRIBUTING.md        贡献说明
```

以下目录是本地运行产物或个人材料，不应进入开源仓库：

```text
data/
debug/
dist/
node_modules/
test-results/
playwright-report/
.cache/
.private/
.claude/
author/
qa-deliverables/
```

这些目录已由 `.gitignore` 排除。

## 启动方式

### Web 本地服务

```bash
npm install
npm start
```

`npm start` 会启动：

```text
node src/server.js
```

默认监听：

```text
http://127.0.0.1:8765
```

### Electron 桌面端

```bash
npm run start:electron
```

Electron 入口是：

```text
electron/index.js
```

它会启动内嵌 Express 服务，然后加载本地应用 URL。

开发环境下，数据目录优先使用仓库内 `data/`。打包后，数据目录使用 Electron 的 `userData/data`。

### Windows 封包

```bash
npm run package:win
```

统一封包入口：

```text
scripts/package-win.js
```

封包入口会清理 `dist/`、生成项目指纹清单、调用 Windows 构建脚本并列出产物。

需要先跑 smoke 测试时：

```bash
npm run package:win:test
```

底层 Windows 构建脚本：

```text
scripts/build-win.js
```

构建配置在 `package.json` 的 `build` 字段里，当前 Windows 目标包括：

```text
nsis
portable
```

## 后端入口

主入口：

```text
src/server.js
```

职责：

- 解析 CLI 参数：`--port`、`--host`、`--dataRoot`。
- 设置 `globalThis.DATA_ROOT`。
- 初始化基础数据目录。
- 挂载静态资源 `public/`。
- 挂载当前实际使用的 API 路由。
- 提供 `/api/ping` 和 `/api/version`。

当前实际挂载的路由是：

```text
/api/chapters      src/endpoints/chapters.js
/api/outline       src/endpoints/outline.js
/api/ai            src/endpoints/ai.js
/api/import        src/endpoints/import.js
/api/chat          src/endpoints/chat.js
/api/save          src/endpoints/persistence.js
/api/novels        src/endpoints/novels.js
/api/sessions      src/endpoints/sessions.js
/api/debug         src/endpoints/debug.js
/api/ai-secrets    src/endpoints/ai-secrets.js
```

`src/endpoints/` 里还保留了一些 SillyTavern 或旧后端兼容文件，例如 `characters.js`、`worldinfo.js`、`settings.js`、`openai.js`、`openrouter.js`、`backends/`。这些文件当前没有在 `src/server.js` 中挂载，维护时不要把它们误认为主链路。

## 数据结构

项目数据位于：

```text
DATA_ROOT/novels/<novelId>/
```

常见结构：

```text
novels/<novelId>/
├── novel.json              项目基础信息
├── workspace.json          前端工作区状态、世界书、角色、预设、布局等
├── chapters/               卷和章节 JSON
├── assets/
│   ├── worldbooks/         导入或保存的世界书 JSON
│   ├── characters/         导入或保存的角色卡 JSON/PNG
│   └── presets/            导入或保存的预设 JSON
├── sessions/               聊天会话
└── memory/                 项目记忆相关文件
```

路径安全由以下模块处理：

```text
src/lib/project-paths.js
src/lib/json-store.js
```

`project-paths.js` 负责限制项目路径不能逃逸出数据根目录。
`json-store.js` 负责 JSON 原子写入、写入队列和删除项目时的写入屏障。

## 前端结构

前端入口：

```text
public/index.html
```

主要脚本：

```text
public/js/app.js
public/js/ai/chat-panel.js
public/js/core/api-client.js
public/js/editor/chapter-tree.js
public/js/editor/resizable-panels.js
public/js/ai/plot-candidates.js
public/js/app-signature.js
```

职责划分：

- `app.js`：主应用状态、项目切换、章节编辑、世界书、角色卡、预设、AI 设置、导入、设定提取、布局保存。
- `chat-panel.js`：右侧聊天面板，支持正文、研讨、设定三种模式，负责 SSE 流式显示、消息编辑、会话保存、上下文打包入口。
- `api-client.js`：浏览器端请求封装，支持超时、队列和 JSON 解析。
- `chapter-tree.js`：章节树和大纲树 UI。
- `resizable-panels.js`：可拖拽面板宽度。

前端核心状态在 `app.js` 的 `state` 对象中维护，包含当前项目、章节、世界书、角色、预设、AI 配置、工作区布局和会话状态。

## 主写作链路

当前推荐写作入口是聊天面板的正文模式：

```text
public/js/ai/chat-panel.js
→ POST /api/chat/write
→ src/endpoints/chat.js
→ src/services/writing-service.js
→ src/services/context-orchestrator.js
→ src/services/preset-orchestrator.js
→ src/services/ai-client.js
```

流程：

1. 前端收集当前模式、用户消息、历史消息、当前正文、章节信息、预设、AI 配置。
2. `/api/chat/write` 建立 SSE 流。
3. `generateWritingStream` 清理历史消息。
4. `buildWritingContext` 加载项目数据并构建上下文。
5. `buildWritePromptFromPreset` 按 native 或 ST 兼容模式拼装 messages。
6. `ai-client` 调用模型并把流式 chunk/reasoning/tool 事件传回前端。
7. `writing-output-guard` 清理伪工具调用、禁词等异常输出。
8. 前端收到什么显示什么，并在完成后保存会话。

`/api/ai/continue` 仍存在，但它是较旧的续写接口，使用 `MemoryManager` 和 `callAIText` 的非主链路。新功能优先接入 `/api/chat/write`。

## 聊天模式

聊天面板有三种模式：

```text
write   正文模式
plan    情节研讨
assist  设定制作
```

对应接口：

```text
write   POST /api/chat/write
plan    POST /api/chat/plan
assist  POST /api/chat
```

补写接口：

```text
POST /api/chat/infill
```

设定制作结果导入接口：

```text
POST /api/chat/import-data
```

## 记忆和上下文系统

当前写作上下文由 `src/services/context-orchestrator.js` 统一编排，再交给 `src/services/preset-orchestrator.js` 拼成最终 prompt。

### 数据来源

`project-data.js` 会加载：

- `workspace.json`
- `novel.json`
- `assets/worldbooks/`
- `assets/characters/`
- `chapters/`
- 请求上下文里的 fallback 数据

世界书和角色卡导入时会补充摘要字段，摘要工具在：

```text
src/services/reference-summaries.js
```

### native 模式

native 模式是催更姬自己的长篇写作链路，主要用于“催更姬 v1.0”这类官方预设和 reference tool 模式。

判断入口：

```text
src/services/context-chains/native-writing-chain.js
src/services/context-orchestrator.js
```

当前 native 拼接顺序大致是：

```text
systemPrompt:
  平台规则
  预设里的 system 内容
  作者偏好（当前默认不注入）

messages:
  世界书简略摘要
  角色卡简略摘要
  预设参考消息
  远期章节摘要
  近期章节全文
  最近几轮用户/AI交互
  当前正文快照
  当前作者要求
```

注意：

- 历史正文快照会保存在本地聊天记录里，但当前不会默认注入模型。
- 当前正文快照只注入当前轮。
- 远期章节使用摘要。
- 近期章节使用全文，但会排除当前正在编辑的章节。
- 章节窗口由 `chapterWindowAnchor` 控制，原则是新会话或上下文打包时更新，普通对话不频繁移动。

native 世界书层：

```text
src/services/native/world-layer.js
```

native 角色层：

```text
src/services/native/character-layer.js
```

### ST 兼容模式

ST 兼容模式用于导入和运行 SillyTavern 风格预设。

相关文件：

```text
src/services/context-chains/st-compatible-chain.js
src/services/st/formatters.js
src/services/worldbook-engine.js
```

特点：

- 使用 ST marker 和宏。
- 世界书按关键词匹配。
- 角色字段按 description/personality/scenario/dialogue 等 ST 字段注入。
- 不使用 native 的官方层 fallback。

这个模式优先保证预设兼容，不保证最佳缓存命中率。

### Reference Tools

模型可调用的资料查询工具定义在：

```text
src/services/ai-tools/reference/schemas.js
src/services/ai-tools/reference/reference-store.js
src/services/ai-tools/reference/index.js
```

当前工具：

```text
search_reference       搜索角色、世界书、章节、记忆、场景资料
get_reference_detail   按 id 读取资料详情
get_scene_context      获取当前写作现场
```

工具是否启用由以下模块判断：

```text
src/services/reference-tool-policy.js
```

设定制作还会使用：

```text
import_data
```

定义在：

```text
src/services/chat-tools.js
```

## 预设系统

预设导入接口：

```text
POST /api/import/preset
```

前端保存到工作区：

```text
workspace.presets
workspace.presetName
workspace.promptTemplates
workspace.promptOrder
workspace.enabledTemplates
workspace.specialPrompts
workspace.formatStrings
workspace.regexBindings
```

最终拼接逻辑：

```text
src/services/preset-orchestrator.js
```

要点：

- system 类型模板进入 system prompt。
- 非 system 的预设规则进入“预设参考”消息。
- native 模式会使用 native marker 和官方层 fallback。
- ST 模式会使用 ST marker，不走 native fallback。
- `promptOrder` 会控制模板启用和顺序。

## 世界书与角色卡

导入接口：

```text
POST /api/import/worldbook
POST /api/import/character-png
POST /api/import/character-json
POST /api/import/batch
```

项目级保存接口：

```text
POST /api/save/worldbook
POST /api/save/character
GET  /api/save/worldbooks
GET  /api/save/characters
POST /api/save/worldbook-entry
```

世界书来源：

- `workspace.worldBook`
- `assets/worldbooks/**/*.json`
- 请求 fallback

角色卡来源：

- `workspace.characters`
- `assets/characters/*.json`
- 请求 fallback

导入时会兼容 ST 的启用/禁用字段：

```text
disable
disabled
enabled
```

催更姬自有角色卡扩展字段使用：

```text
extensions.cuigengji
```

旧版本写入的 `extensions.novel_ai_editor` 只作为兼容读取保留。

native 模式主要使用条目正文和摘要。ST 专用字段，例如排序、扫描深度、注入位置、触发关键词、次级关键词等，主要服务 ST 兼容链路。

## 章节和卷

章节接口：

```text
GET    /api/chapters?novelId=<id>
GET    /api/chapters/:id?novelId=<id>
POST   /api/chapters
PUT    /api/chapters/:id
DELETE /api/chapters/:id
```

章节保存为 JSON 文件。卷当前以 `chapters/` 下的目录表达，卷 id 格式为：

```text
vol_<folderName>
```

章节删除前会复制到：

```text
DATA_ROOT/backups/
```

## 导入系统

导入接口集中在：

```text
src/endpoints/import.js
```

支持：

- 世界书 JSON
- 角色卡 PNG
- 角色卡 JSON
- 预设 JSON
- TXT/DOCX 文档导入
- 文件夹导入
- 批量导入

文档导入支持章节识别，核心函数：

```text
splitTextIntoChapters
isChapterHeading
normalizeChapterTitle
```

编码读取优先尝试 UTF-8，失败后检测旧编码，并对中文 TXT 常见 GBK 做兜底。

## 设定提取和摘要

摘要接口：

```text
POST /api/ai/summarize
```

摘要类型：

```text
chapter
worldbook
character
```

设定提取接口：

```text
POST /api/ai/extract
POST /api/ai/extract-project
POST /api/ai/extract-project-stream
```

后台任务接口：

```text
GET    /api/ai/extract-jobs
GET    /api/ai/extract-jobs/:jobId
POST   /api/ai/extract-jobs
DELETE /api/ai/extract-jobs/:jobId
```

逐章扫描会：

1. 读取选定章节范围。
2. 每章调用大模型提取角色、世界书候选和章节摘要。
3. 把章节摘要写回章节 JSON。
4. 聚合角色和世界书候选。
5. 把进度保存在内存任务表里供前端轮询。

注意：任务表是进程内存结构，应用重启后未完成任务不会恢复。

## AI 配置和密钥

AI 调用统一走：

```text
src/services/ai-client.js
```

支持的 provider 由 `ai-client.js` 内部适配。

API Key 存取：

```text
src/services/ai-secrets.js
src/endpoints/ai-secrets.js
```

前端可以：

- 保存 API Key。
- 检查某 provider/profile 是否已有密钥。
- 显示或隐藏密钥。
- 测试模型连接。

测试连接接口：

```text
POST /api/ai/test-connection
```

模型列表接口：

```text
POST /api/ai/list-models
```

## 流式输出

主聊天接口使用 SSE：

```text
Content-Type: text/event-stream; charset=utf-8
```

常见事件：

```text
chunk          正文增量
reasoning      思考增量
tool_start     工具调用开始
tool_call      工具调用详情
tool_result    工具结果
tool_end       工具调用结束
meta           上下文和 debug 信息
done           本轮完成
error          错误
```

前端流式渲染在：

```text
public/js/ai/chat-panel.js
```

它会把收到的文本平滑显示，并尽量避免用户手动滚动查看上文时被强行拉到底部。

## Debug 和日志

Debug 接口：

```text
GET /api/debug/last-prompt
GET /api/debug/last-api-call
GET /api/debug/api-calls
GET /api/debug/recent-api-calls
```

API 调用日志服务：

```text
src/services/api-call-logger.js
```

调试数据默认写入：

```text
data/debug/
```

调试日志可能包含完整 prompt、用户正文、设定资料和模型返回内容，开源或反馈 issue 前必须脱敏。

## 测试

测试框架：

```text
@playwright/test
```

常用命令：

```bash
npm test
npm run test:api
npm run test:e2e
npm run test:smoke
npm run test:regression
```

测试目录：

```text
tests/api/       API 和流式接口测试
tests/e2e/       用户级浏览器流程测试
tests/import/    导入和章节拆分测试
tests/memory/    记忆、reference tools、摘要、写作流测试
```

## 当前维护边界

下面这些点是当前源码的真实状态，维护时需要特别注意：

1. `src/server.js` 挂载的接口才是当前主应用接口。未挂载的 ST 兼容端点不要直接当成主链路。
2. `/api/chat/write` 是当前正文写作主入口，`/api/ai/continue` 是旧式续写接口。
3. `MemoryManager` 仍被部分旧接口和上下文检索使用，但 native 世界书/角色卡注入已经由 `src/services/native/` 负责。
4. native 和 ST 兼容链路已经在模块上拆出一部分，但总编排仍在 `context-orchestrator.js` 和 `preset-orchestrator.js`。
5. 历史正文快照可以保存在本地会话里，但当前 native prompt 不再默认注入历史快照。
6. 设定提取后台任务存在于进程内存中，重启不保留。
7. `data/`、`debug/`、`.private/`、`author/`、`.claude/` 等目录不应提交。

## 文档维护原则

以后更新文档时，应优先引用源码事实：

- 后端入口看 `src/server.js`。
- 前端入口看 `public/index.html`、`public/js/app.js`、`public/js/ai/chat-panel.js`。
- 写作链路看 `src/endpoints/chat.js` 和 `src/services/writing-service.js`。
- 上下文链路看 `src/services/context-orchestrator.js` 和 `src/services/preset-orchestrator.js`。
- 数据路径看 `src/lib/project-paths.js`。
- JSON 写入看 `src/lib/json-store.js`。

不要直接复制旧实验记录、聊天结论或阶段性测试报告作为架构事实。
