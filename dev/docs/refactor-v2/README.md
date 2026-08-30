# 催更姬 Electron 模块化重构设计

> 状态：后端四类八模块、原生 DSH 侧栏、前端页面化和接口八模块整理均已完成；旧版 Web UI 嵌入描述均为历史记录  
> 基线日期：2026-08-19  
> 事实来源：当前仓库源码、`package.json` 和实际数据目录；未采用既有软件设计文档。

当前物理目录以 [frontend-interface-final-layout.md](./frontend-interface-final-layout.md) 和 [项目结构](../PROJECT_STRUCTURE.md) 为准；后端四类八模块规则见 [09-module-directory-layout.md](./09-module-directory-layout.md)。更早的路径示例只用于解释迁移背景。

## 已确定的架构决策

1. 产品只面向 Electron，不再保留可独立运行的网页版。
2. Renderer 只负责界面和临时交互状态，不直接访问文件、密钥、网络模型或 Node API。
3. 原来的 HTTP/Express 业务接口已经迁移为 `preload + IPC` 类型化接口；本地 Express 只提供 Renderer 静态资源，不挂载业务 API。
4. Main Process 只负责桌面生命周期、安全边界、接口路由与 DSH 进程监督；Agent 执行发生在隔离的 DSH 子进程。
5. 业务按项目、章节、大纲、资料、预设、会话、导入导出、模型、Agent 等领域纵向拆分。
6. 同一份业务数据只有一个权威存储位置；缓存、UI 布局和派生摘要不得反向覆盖领域数据。
7. Agent 以官方 DeepSeek Harness 为唯一交互运行时；Renderer 只通过 `DesktopApi.agent` 控制启动、会话和消息，不直接依赖 Harness 内部类型。
8. 重构采用渐进迁移和双轨验证，不做一次性重写。

## 当前落地结果

- Electron 已升级并固定为 `43.2.0`（Node 24），构建链固定为 `electron-builder 26.15.3`。
- 只保留 `electron/index.js` 一个主入口和 `electron/preload.cjs` 一个 sandbox preload。
- 前端已按 `app/pages/dialogs/shared` 页面化；Desktop API 与 IPC 固定为八个平级能力模块；后端保持四类八模块。
- Renderer 的领域数据访问不再经过 HTTP，也不再使用 `localStorage/sessionStorage` 作为权威或回退存储。
- 生产 `src` 与 Renderer 源码均已清除不可达文件；运行闭包门禁要求 `unreachableSrcFiles` 恒为零。
- API Key 和 Vertex Service Account 由 Electron `safeStorage` 加密；旧明文密钥首次读取后自动迁移并删除旧文件，Renderer 无密钥回显能力。
- DSH 官方 GUI 不再嵌入；DSH 仅作为 Main 进程管理的私有 API Host，右侧 Agent 使用原生 Renderer 侧栏，主窗口生命周期内只有一个 `BrowserWindow` 和一个 Renderer。
- 旧聊天面板和 `window.AgentRuntimePort` 已退出生产闭包；Automation 已接入独立 Electron IPC，不属于 Agent，也不复用 Agent session。
- 旧数据目录与 JSON 结构保持兼容，本轮未读写真实小说正文进行批量迁移。
- 仓库已分为根目录产品运行层和 `dev/` 开发层；构建与测试产物统一输出到同级 `../cuigengji-build/`。

## 文档导航

- [网文开发助手 v0.1 产品基线与实施计划](../web-fiction-development-assistant-v0.1.md)：已落地的 Agent 行为、Skills、Web Search、Safe Fetch 和大纲提案产品基线及验收记录。
- [07-implementation-status.md](./07-implementation-status.md)：当前实施进度、验证命令与下一批工作。
- [08-dsh-handoff.md](./08-dsh-handoff.md)：DSH 侧栏接管的实际结构、上下文链路和维护边界。
- [frontend-interface-final-layout.md](./frontend-interface-final-layout.md)：P7 完成后的前端与接口权威模块地图。
- [frontend-interface-reorganization-plan.md](./frontend-interface-reorganization-plan.md)：前端按页面/区域、接口按八个业务能力模块整理的分阶段计划。
- [frontend-interface-reorganization/README.md](./frontend-interface-reorganization/README.md)：P0–P7 实施状态与逐阶段结果。
- [09-module-directory-layout.md](./09-module-directory-layout.md)：已经落地的前端、接口和后端物理目录及依赖规则。
- [10-native-dsh-agent-sidebar-plan.md](./10-native-dsh-agent-sidebar-plan.md)：保留 DSH 后台能力、移除完整 Web UI 嵌入并重做原生侧栏的分阶段实施计划。
- [11-repository-runtime-development-layout.md](./11-repository-runtime-development-layout.md)：运行层、开发层、本地资料和外部构建目录的最终划分。
- [13-collaboration-and-typescript-checkpoint.md](./13-collaboration-and-typescript-checkpoint.md)：协作 revision/CAS 内核与 TypeScript 增量迁移 checkpoint。
- [14-iterative-writing-quality-research.md](./14-iterative-writing-quality-research.md)：基于预设的生成—审阅—改写循环、DSH subagent 插件边界与朱雀观测实验。
- [15-dsh-0.1.1-rc.2-migration.md](./15-dsh-0.1.1-rc.2-migration.md)：DSH rc.7 → rc.2 的破坏点、依赖门禁、协议边界和 alpha 后续迁移清单。
- [native-dsh-sidebar/README.md](./native-dsh-sidebar/README.md)：Phase 0–6 的逐阶段详细任务、接口、测试、验收与回退文档。

## 当前停止点

- DSH 已接管右侧 Agent，旧聊天 UI 与完整 DSH Web UI 已移出生产闭包。
- `src/legacy/http` 仍有部分被正式后端 adapter 进程内复用的算法实现；旧 AI/chat/debug HTTP 路由已不可达，兼容区禁止新增业务。
- 本地静态资源服务对所有 `/api/*` 返回 404；项目、资料、配置、模型、Agent、Automation 和交换能力只通过八模块 Desktop API 暴露。
- 未强制切换项目数据 schema，也未批量改写真实用户项目。
- Obsidian 只保留 `knowledge/sources/obsidian` 边界，本阶段没有实现或引入任何耦合。
