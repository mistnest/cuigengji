# 催更姬 v1.0 项目结构说明

## 项目定位

催更姬是一个面向长篇小说创作的本地 AI 编辑器，把正文编辑、章节管理、世界书、角色卡、预设系统和流式 AI 写作整合在一个应用里。

运行形态：

- 后端：Express 本地服务。
- 前端：`public/` 下的原生 HTML/CSS/JavaScript 单页应用。
- 桌面端：Electron 启动内嵌 Express 并加载本地页面。
- 数据：保存在本机 `data/` 或 Electron 用户数据目录，不上传服务器。

## 顶层目录

```text
cuigengji/
├── electron/              Electron 桌面入口
├── public/                前端页面、样式、JS、图片资源
├── scripts/               启动脚本
├── src/                   Express 后端、服务层、AI 适配
├── docs/                  项目文档
├── package.json           npm 脚本、依赖、electron-builder 配置
├── README.md              入口说明
├── LICENSE                许可证
├── NOTICE                 项目声明
└── CONTRIBUTING.md        贡献说明
```

以下目录是本地产物，已由 `.gitignore` 排除，不在仓库中：

```text
data/
debug/
dist/
node_modules/
test-results/
playwright-report/
```

## 启动方式

```bash
npm install
npm start            # 启动 Express → http://127.0.0.1:8765
npm run start:electron  # 启动 Electron 桌面端
```

`npm start` 执行 `node src/server.js`，Electron 入口在 `electron/index.js`。

## 前端结构

入口：`public/index.html`

脚本：

```text
public/js/app.js                         主应用状态、项目切换、章节编辑、世界书、角色卡、预设、AI 设置、导入
public/js/ai/chat-panel.js               聊天面板，三种模式（正文/研讨/设定），SSE 流式显示
public/js/core/api-client.js             浏览器端请求封装（超时、队列、JSON 解析）
public/js/editor/chapter-tree.js         章节树 / 大纲树 UI，拖拽排序
public/js/editor/resizable-panels.js     可拖拽面板宽度
public/js/ai/plot-candidates.js          情节候选展示弹窗
public/js/app-signature.js               构建溯源签名
```

## 后端入口

主入口：`src/server.js`

挂载的 API 路由：

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
/api/update        src/endpoints/update.js
```

`src/endpoints/` 下还保留了一些未挂载的旧端点（`characters.js`、`worldinfo.js`、`settings.js`、`openai.js`、`openrouter.js`、`backends/` 等），维护时不要把它们误认为主链路。

## 服务层

关键服务：

```text
src/services/ai-client.js            AI 模型调用统一入口
src/services/writing-service.js      正文写作流处理
src/services/context-orchestrator.js 上下文编排
src/services/preset-orchestrator.js  预设拼装
src/services/project-data.js         项目数据加载
src/services/writing-output-guard.js 输出清理
src/services/chat-tools.js           import_data 等工具
src/services/reference-summaries.js  世界书/角色摘要
src/services/api-call-logger.js      API 调用日志
```

目录：

```text
src/services/ai-tools/reference/     reference tools（search_reference 等）
src/services/context-chains/         native / ST 兼容链路
src/services/native/                 世界书层、角色层
src/services/st/                     ST 格式化和工具
```

## 主写作链路

```text
public/js/ai/chat-panel.js
→ POST /api/chat/write
→ src/endpoints/chat.js
→ src/services/writing-service.js
→ src/services/context-orchestrator.js
→ src/services/preset-orchestrator.js
→ src/services/ai-client.js
```

## 聊天模式

| 模式 | 接口 |
|---|---|
| write 正文 | `POST /api/chat/write` |
| plan 研讨 | `POST /api/chat/plan` |
| assist 设定 | `POST /api/chat` |
| infill 补写 | `POST /api/chat/infill` |
| import 导入结果 | `POST /api/chat/import-data` |

## 数据结构

```text
DATA_ROOT/novels/<novelId>/
├── novel.json              项目基础信息
├── workspace.json          工作区状态（世界书、角色、预设、布局等）
├── chapters/               卷和章节 JSON
├── assets/
│   ├── worldbooks/         世界书 JSON
│   ├── characters/         角色卡 JSON/PNG
│   └── presets/            预设 JSON
├── sessions/               聊天会话
└── memory/                 项目记忆
```

路径安全由 `src/lib/project-paths.js` 和 `src/lib/json-store.js` 处理。

## 上下文系统

由 `src/services/context-orchestrator.js` 编排，`src/services/preset-orchestrator.js` 拼装最终 prompt。

native 模式（催更姬自有链路）和 ST 兼容模式（SillyTavern 预设兼容）的入口分别位于 `src/services/context-chains/`。

## 导入系统

入口：`src/endpoints/import.js`

支持：世界书 JSON、角色卡 PNG/JSON、预设 JSON、TXT/DOCX 文档、文件夹批量导入。

## 流式输出

聊天接口使用 SSE（`text/event-stream`），事件类型：`chunk`、`reasoning`、`tool_start`、`tool_call`、`tool_result`、`meta`、`done`、`error`。

前端流式渲染在 `public/js/ai/chat-panel.js`。

## Debug 接口

```text
GET /api/debug/last-prompt
GET /api/debug/last-api-call
GET /api/debug/api-calls
GET /api/debug/recent-api-calls
```

调试数据写入本地 `data/debug/`，可能包含完整 prompt 和用户正文，公开前必须脱敏。

## 维护要点

1. `src/server.js` 挂载的接口才是主链路，未挂载的端点不要当主链路。
2. `/api/chat/write` 是当前正文写作主入口。
3. 设定提取后台任务存于进程内存，重启不保留。
4. `data/`、`debug/`、`dist/`、`node_modules/` 等不应提交到仓库。

## 文档维护原则

以后更新文档时应以源码为准：
- 后端入口看 `src/server.js`
- 前端入口看 `public/index.html`、`public/js/app.js`
- 写作链路看 `src/endpoints/chat.js`、`src/services/writing-service.js`
- 上下文链路看 `src/services/context-orchestrator.js`、`src/services/preset-orchestrator.js`
