# DSH Main 适配器

本目录是 DeepSeek Harness 的唯一 Electron 适配层。DSH 作为私有 loopback API Host 运行，不加载官方 Web UI，也不创建额外的 `WebContents`。

## 子模块

- `dsh-supervisor.js`：生成 overlay 和上下文快照，启动、复用、重启、停止固定版本的 DSH 子进程。
- `dsh-rpc-client.js`：只允许 workspace/session 所需的固定 RPC 白名单。
- `dsh-event-stream.js`：仅在 Main 中连接 `events.mux` WebSocket，并负责重连。
- `dsh-event-mapper.js`：把 DSH 原始事件清洗为稳定的 Agent UI 事件，禁止暴露工具参数、结果、路径和 runtime URL。
- `dsh-session-registry.js`：维护 project/workspace/session/generation 关系与事件去重。
- `dsh-gateway.js`：对 IPC 暴露 open/session/history/prompt/cancel/context/restart/stop 语义操作。
- `plugins/`：项目热上下文、只读资料工具、工具权限审计和小说会话压缩。

打包时应用源码仍在 `app.asar`；DSH 依赖树放在 `app.asar.unpacked/node_modules`，supervisor 会让 DSH bin 与自定义插件使用同一份物理模块实例。这是 Windows 子进程从用户运行目录加载 profile 时的必要边界，不代表 Renderer 可以访问这些模块。

## 边界

Renderer 只能通过 `shared/desktop-api/agent` 调用语义 IPC，不得知道 DSH 端口、RPC 路由或原始事件。允许工具固定为 `search_project_knowledge` 与 `get_project_knowledge`；文件沙箱为 `read-only`，未知工具失败即关闭。

Obsidian 不属于本适配器。未来 Vault 数据只能经独立 Knowledge Source 转成只读快照，再由 Agent Context 消费。
