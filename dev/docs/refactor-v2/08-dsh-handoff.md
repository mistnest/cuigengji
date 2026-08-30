# DeepSeek Harness 接管交接说明

> 实施状态：Phase 0–6 已完成自动化验收。本文只描述当前落地结构；早期“嵌入 DSH 官方 GUI”的方案已废弃。
>
> 相关结果：[native-dsh-sidebar/phase-6-result.md](./native-dsh-sidebar/phase-6-result.md)；前端和接口模块地图：[frontend-interface-final-layout.md](./frontend-interface-final-layout.md)。

## 1. 接管结果

- 交互式 Agent 的产品入口是催更姬自己的原生 Renderer 侧栏，不加载 DSH HTML/CSS/JS。
- Electron 生命周期内只创建一个 `BrowserWindow` 和一个 Renderer；DSH 只作为 Main 进程管理的私有 loopback API Host。
- Renderer 不知道 DSH URL、端口、RPC、WebSocket 或内部类型，只调用 `window.cuigengji.agent`（`DesktopApi.agent`）和接收 `AgentUiEvent`。
- DSH 进程、preset、工具白名单、上下文快照和恢复策略集中在 `electron/intelligence/agent/dsh/`。
- Obsidian 尚未接入，未来作为独立 Knowledge Source 模块接入，不属于 DSH Runtime。

## 2. 当前运行链路

```text
Renderer: AgentWorkbenchFeature
  → DesktopApi.agent.open({ projectId, chapterId })
  → preload 暴露的固定方法
  → Main IPC handler（受信任 frame 校验、输入校验）
  → AgentGateway
  → DshSupervisor
       ├─ 生成 project-context.json / project-knowledge.json
       ├─ 启动或复用固定版本 DSH 子进程
       ├─ 初始化 cuigenji preset 与 session
       └─ 通过 DSH loopback API 完成 prompt、history、cancel、restart
  → AgentEventStream / event mapper
  → Main IPC 推送 AgentUiEvent
  → AgentStore → Conversation / Workbench UI
```

关键文件：

| 职责 | 文件 |
| --- | --- |
| DSH 进程、版本、workspace、打包解析 | `electron/intelligence/agent/dsh/dsh-supervisor.js` |
| Agent 插件目录与组合 | `electron/intelligence/agent/dsh/dsh-plugin-bundle.js` |
| DSH RPC、事件流和结果映射 | `electron/intelligence/agent/dsh/dsh-rpc-client.js`、`dsh-event-stream.js`、`dsh-event-mapper.js` |
| 催更姬 preset 与上下文/知识/权限插件 | `electron/intelligence/agent/dsh/plugins/*.mjs` |
| Agent Gateway 与会话注册 | `electron/intelligence/agent/agent-gateway.js`、`session-registry.js` |
| Agent IPC | `electron/ipc/agent/agent.handlers.js` |
| 稳定契约 | `shared/desktop-api/agent/agent.contract.js` |
| preload facade | `electron/preload-src/agent.cjs`、`electron/preload.cjs` |
| 原生侧栏 UI | `public/js/pages/workspace/agent/{workbench,conversation,composer,state}` |

## 3. 上下文语义

接管保留“当前项目 + 当前章节 + 项目资料”的语义，但不复用旧聊天 Prompt 拼装器。所有写作入口只接受 `cuigenji-canonical-v1`，不存在可切换的酒馆注入链。上下文分为热、冷两层：

1. `buildAgentProjectContextArtifacts({ projectId, chapterId })` 从后端公开模块读取权威数据。
2. 热上下文写入项目隔离的 `project-context.json`，包含项目元数据、当前章节摘录、邻近章节索引、大纲摘要及相关资料索引。
3. 世界书与角色卡写入独立的 `project-knowledge.json`，不在每轮 system prompt 中整体注入。
4. `cuigenji-writing-context` 是 DSH 唯一 Prompt 注入插件：作者预设提供写作规范，项目热快照提供事实索引；需要冷资料时只使用 `search_project_knowledge` 和 `get_project_knowledge`。
5. 章节或工作区保存后，通过 `agent.refreshContext` 原子刷新两份快照，不重启 DSH，也不清空会话。

上下文文件不得包含 API Key。密钥只由可信 Main 进程通过受控环境变量传给 DSH 子进程，Renderer 和日志均不接触明文密钥。

DSH 自带的 session event log、重放、token meter 和 compaction 生命周期继续保留；催更姬只替换小说语义的 compaction 摘要模板。

外部世界书、人物卡和预设仍可导入，但酒馆 marker、宏、前后置插槽及全文注入开关只被当作过期兼容字段丢弃，不能改变运行时顺序或重复注入数据。

## 4. 生命周期与错误边界

- Agent 标签打开时启动或复用 DSH；首次打开会准备当前项目的上下文快照。
- 当前章节变化或章节/工作区保存时热刷新上下文；项目或模型配置变化时才重启 DSH。
- prompt、流式事件、工具调用、推理文本、最终文本和取消结果统一映射为 `AgentUiEvent`，Renderer 不依赖 DSH 原始事件格式。
- DSH 崩溃、启动失败或 API 错误只影响 Agent 会话；章节保存、编辑器和其他领域 IPC 保持独立。
- Main 退出时停止 DSH 子进程并清理临时 workspace；Electron 关闭后不得遗留 DSH 进程或 loopback 端口。

## 5. 与 Automation 的边界

续写、补写、灵感候选、提取和摘要等非交互式快捷能力已经通过 `DesktopApi.automation` 和 `electron/ipc/automation` 接入独立后端模块。它不提供聊天、会话或 DSH UI，也不能被 Agent 模块导入；Renderer 中不存在 Automation HTTP 例外。

## 6. 打包与升级约束

- DSH 固定为 `@deepseek-ai/dsh@0.1.0-rc.7`，并锁定其直接插件依赖版本。
- 生产代码保持 `asar: true`；`node_modules/**` 使用 `asarUnpack` 放在物理目录，避免 DSH 子进程和插件跨 `app.asar` 加载出错。
- supervisor 的 `resolveModuleFile()` 确保 DSH bin 和自定义插件解析到同一份物理依赖实例，避免 `dsh-scope` 等单例身份不一致。
- 打包环境的数据根目录使用平台用户数据目录下的 `cuigengji/data`，可用 `CUIGENGJI_DATA_ROOT` 显式覆盖；不能写入 `app.asar`。
- 升级必须先在独立分支更新 lockfile，再依次通过 Wire、Gateway、接口测试和 packaged Electron E2E；失败时整体回退 DSH 版本和对应 lockfile。

## 7. 当前验收状态

- `npm test -- --reporter=line`：`93 passed`。
- `npm.cmd run architecture:check`：架构门禁通过。
- `npm.cmd run lint -- --quiet`：0 errors。
- `npm.cmd run package:win`：打包成功。
- 使用打包版 `催更姬.exe` 的原生 DSH E2E：`1 passed`，覆盖工具调用、推理/最终文本、取消、大纲提案、统一上下文文件、单窗口/单 Renderer 和无密钥泄漏。
- 仍待产品验收：至少一次 30 分钟真实写作会话，以及真实 API Key/网络中断场景。真实密钥未写入仓库、测试或日志。

## 8. 维护入口

先读 [native-dsh-sidebar/README.md](./native-dsh-sidebar/README.md) 了解阶段验收，再读 [phase-6-result.md](./native-dsh-sidebar/phase-6-result.md) 了解打包、诊断和回退规则。前端或接口变更先对照 [frontend-interface-final-layout.md](./frontend-interface-final-layout.md)。
