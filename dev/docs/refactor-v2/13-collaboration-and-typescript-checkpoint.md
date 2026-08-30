# 协作内核与 TypeScript 迁移 checkpoint

状态：可运行的第一阶段实现（2026-08-30）

## 这次交付解决什么

项目现在有一条统一的“提交—广播—同步”链路：

```text
Renderer / Agent 申请写入
        │ expectedRevision（CAS）
        ▼
Main + domain service ── 原子 JSON 写入
        │ revision + updatedAt + contentHash
        ▼
DomainEventBus ── project.changed(seq, streamId, actor)
        ├── Renderer：干净视图自动同步；脏视图显示重新加载选择
        └── AgentCoordinator：标记运行过期，通知 DSH 刷新私有上下文
```

时间戳只用于诊断和排序，不能作为并发写入的唯一判断。真正的写入门闩是服务端单调递增的 `revision`；`contentHash` 用于确认内容，`streamId + seq` 用于断线回放和进程重启识别。

## 数据与权限边界

- `project / workspace / chapter / outline / worldbook / character` 都返回版本元数据。
- 所有会改变上述聚合的入口都接受 `expectedRevision`；版本不一致返回 `REVISION_CONFLICT`，并携带当前版本信息，不会覆盖新内容。
- DSH 当前仍是只读 Agent：可以读取热上下文、按需查询知识、搜索/安全抓取公开网页、提出大纲 patch；不能直接写文件、执行 Shell 或自行应用提案。
- 大纲提案必须由用户在现有 Agent 侧栏中明确应用，应用时再次进行 revision 校验。没有新增侧栏或第二套任务面板。
- Agent 上下文是项目数据的派生快照，包含 `snapshotId`、`streamId`、`projectChangeSeq` 和每个来源的版本指纹；快照不是权威存储。

## Renderer 体验

- 收到外部章节修改时，如果当前章节没有本地未保存编辑，自动刷新；有未保存编辑时只提示，不静默覆盖。
- 世界书、角色卡、工作区等聚合使用现有底部状态栏提示“重新加载 / 稍后”，不增加新的导航入口。
- 窗口加载完成后通过 `projects.changes` 回放最近事件，避免错过短暂断线期间的变更。

## TypeScript 迁移策略

本 checkpoint 采用可回滚的双轨方式：

1. `shared/contracts/collaboration.ts` 是跨层共享的类型词汇（Actor、VersionStamp、DomainChangeEvent、AgentRunSnapshot）。
2. 版本服务、事件总线、Agent 协调器已迁移为 `.ts` 源文件；`dev/scripts/build-typescript.mjs` 在启动、测试和打包前生成同目录的 ESM `.js` 兼容产物。
3. `npm run typecheck` 对这些边界执行 strict 检查，`npm run ts:check-generated` 防止生成产物过期。
4. 现有页面、Electron IPC 和历史业务文件暂时保留 JS 运行兼容层；后续按“shared contracts → IPC DTO → domain service → Renderer feature”顺序逐模块迁移，不进行一次性重写。

## 交付前硬化（2026-08-30）

- DSH stream 增加代际令牌；旧 WebSocket 的迟到回调不会污染新会话，项目切换和失败重连也会清理旧状态。
- 项目创建/删除使用项目级生命周期锁；旧导入路径（角色、世界书、预设）改走版本化 CAS，不会绕过协作事件链路。
- Renderer 增加工作区级脏状态与稳定基线指纹；延迟自动保存或弹窗编辑尚未提交时，外部资料变更不会静默覆盖，用户确认重载后旧异步回调会失效。
- 现有 SiliconFlow、MiniMax、Z.AI 区域/接口选择同时作用于写作和 DSH，手工代理地址仍优先于区域默认值。
- Agent 冷资料在进入上下文前做有界复制和敏感字段剔除；如果快照期间项目持续变化，会返回 `AGENT_CONTEXT_STALE`，要求重新取快照，而不是拼接不一致的数据。
- 单节点大纲编辑与批量提案都执行父子图校验；RPC 只允许干净的 loopback HTTP 端点，并覆盖异常响应体清理。
- 已知边界：TypeScript 目前是增量迁移；章节文件的进程内写入队列不替代跨进程文件锁；DSH 只读/提案式写入仍须用户在现有 Agent 侧栏确认。

## 验收命令

```bash
npm run typecheck
npm run ts:check-generated
npm run build:preload
npm run lint
npm run architecture:check
npm test -- --reporter=line
```

新增的协作契约测试覆盖：原子版本冲突、事件顺序与回放、断线 stream 重置、IPC 到 Renderer 的 changed 通知、上下文脱敏/一致性、大纲图校验、Google AI Studio provider 桥接、区域端点映射和 loopback RPC 校验。当前全量回归为 89/89。
