# Phase 6：稳定化、性能与 DSH 升级护栏

> 状态：待评审  
> 前置条件：[Phase 5](./phase-5-remove-web-ui.md) 完成  
> 阶段性质：收口；完成后本轮 DSH 侧栏改造结束

## 1. 阶段目标

把 DSH 从“当前版本能运行的依赖”变成“可以安全维护和升级的 Agent 基底”。重点不是新增 UI 功能，而是固定兼容契约、量化性能、完善故障诊断和建立升级流程。

Obsidian 不在本阶段接入；只有本阶段完成后，才另开 Knowledge Source 设计。

## 2. DSH Contract Suite

Contract Suite 必须使用固定版本真实 DSH Runtime + 本地 mock Provider，覆盖以下行为：

### Runtime

- 启动 ready 探测。
- 同配置复用、配置变化重启。
- start/restart/stop 并发串行化。
- child crash、超时、非零退出和正常退出。
- 应用退出后无残留。

### Session

- workspace 幂等创建。
- 空 session 创建与恢复。
- session.list 与 project 隔离。
- history 尾页、beforeSeq 分页、hasMore。
- event seq 连续、断线补齐和重复去除。
- restart 后 session replay。

### Prompt/Turn

- 普通 queue。
- 回复中 queue。
- steer（只有 Phase 0 证明稳定才作为强契约）。
- cancel 与 cancel 后继续对话。
- 多 step 工具回路。
- Provider error、无 Key、超时和畸形流。

### Content

- text delta 与 final message 一致。
- reasoning delta 可选且不影响无 reasoning Provider。
- Unicode、中文标点、emoji、超长段落和空 delta。
- usage 存在/缺失两种情况。

### Tools/Permissions

- 最终 Provider request 恰好包含允许工具。
- search/get 对快照 fixture 返回确定结果。
- 越权工具、任意 FS、Shell、网页、子 Agent、项目写入不可用。
- guard 拒绝未知调用。
- 错误和工具摘要不泄露绝对路径或快照全文。

### Context/Compaction

- 热上下文同 session 下一轮更新。
- 冷资料更新与工具读取。
- compaction 触发、事务提交和 session replay。
- 小说连续性摘要包含既定栏目，不退回编程任务模板。
- compaction 前后人物/世界观关键 fixture 信息不丢失。

## 3. 兼容契约分层

必须区分三层，测试失败时才能知道改哪里：

```text
DSH Wire Contract
  /api method、WebSocket envelope、event type/data

Gateway Contract
  open/session/history/prompt/cancel、AgentRuntimeEvent

Desktop/UI Contract
  DesktopApi.agent、AgentUiEvent、store projection
```

规则：

- 上游 DSH 变化只允许影响 Wire Adapter 与 mapper。
- Gateway DTO 变化需要 Main contract review。
- Desktop/UI Contract 变化需要前端与接口共同 review，并升级 schemaVersion。
- 不允许为了快速适配上游而让 Renderer读取原始 DSH event.data。

## 4. 固定版本与升级流程

当前项目继续使用精确版本，不使用 `^`、`~` 或浮动 tag。

升级步骤固定为：

1. 单独分支修改 DSH 精确版本和 lockfile。
2. 阅读目标版本官方变更与相关包版本图。
3. 只调整 `electron/intelligence/agent/dsh` adapter/plugin。
4. 运行 DSH Wire Contract，记录所有变化。
5. 运行 Gateway、Desktop API、store、Electron E2E。
6. 比较工具权限和最终 Provider request。
7. 比较 Phase 0 性能基线和最近稳定版本。
8. 全部通过后才更新固定版本与兼容记录。

以下任一情况阻止升级：

- 允许工具集合扩大或无法证明。
- session/history/replay 出现数据损失。
- cancel 或基本文字流失败。
- Renderer 契约被迫暴露 DSH 内部字段。
- 出现明显内存/进程残留回归。

## 5. 私有 API Host 与纯 Headless 决策

Phase 5 后，即使命令仍为 `dsh web --port 0`，只要没有页面加载，它在产品中承担的是 loopback API Host。不要仅因为命令名含 `web` 就立即重组 DSH 内核。

是否换成真正的 Headless 组合，需要做一个隔离 spike，比较：

| 维度 | 私有 API Host | 纯 Headless 组合 |
|---|---|---|
| 上游支持程度 | 是否是官方稳定入口 | 是否需要自行组合 Cordis 插件 |
| 兼容成本 | RPC/WebSocket 是否较稳定 | 内部 service API 是否频繁变化 |
| 隔离性 | 独立 child 崩溃隔离 | utility/child 组合方式 |
| 资源 | 未加载页面时的实际开销 | 组合后的实际开销 |
| 安全 | loopback + Main 私有 URL | 无 HTTP 后的攻击面变化 |
| 测试 | 现有 Contract Suite 复用 | 是否需重写 host 测试 |

只有纯 Headless 在资源、安全或维护上有可测收益，并且不依赖大量不稳定内部 API 时才迁移。该 spike 不与 UI 项目捆绑，也不能直接修改生产路径。

## 6. 性能验证

### 指标

- 冷启动到 Gateway ready。
- 已启动时 openProject 到 session ready。
- prompt 接受耗时。
- WebSocket frame 到 Main mapper、Main 到 Renderer、Renderer 到下一次绘制的分段耗时。
- 10,000/50,000 字历史加载与投影耗时。
- 连续 30 分钟 streaming 的主线程长任务和内存趋势。
- 100 次 session 切换后的 listener/timer 数量。
- 10 次应用启动/退出后的子进程和端口残留。

### 方法

- 使用相同 mock Provider 控制网络变量。
- 开发诊断计时只记录阶段耗时和事件类型，不记录正文。
- 与 Phase 0 嵌入基线比较 WebContents 数、内存和侧栏交互延迟。
- 门槛数值在 Phase 0 取得真实基线后填写到结果报告，避免先写无法验证的数字。

### 失败处理

- delta 频率过高：调整 batch frame，不丢 durable event。
- history 投影慢：分页和增量 fold，先不引入复杂虚拟列表。
- Main WebSocket 消息处理形成长任务：检查单帧上限与映射批处理。
- 内存持续增长：分别检查 Gateway subscriber、preload listener、store history、DOM item 和 reconnect timer。

## 7. 故障注入与耐久测试

至少覆盖：

- 回复前、首 chunk 后、tool call 中、turn end 前杀死 Provider。
- 回复中杀死 DSH child。
- WebSocket 断开但 RPC 仍可用。
- RPC 超时但 WebSocket 后续到达事件。
- 快速切换两个项目和多个 session。
- 保存 Key 时恰逢 start/restart。
- 系统睡眠/唤醒或网络断开/恢复。
- 应用退出时仍有运行 turn。
- history 中存在未知上游事件。
- 快照暂时不可读或 JSON 损坏。

预期都是可恢复状态或明确错误，不能拖垮编辑器和项目保存。

## 8. 诊断与隐私

### 可以记录

- requestId/rpcId 的短期关联值。
- DSH 固定版本、runtime generation、事件 type/seq。
- 各阶段耗时、状态转换和脱敏错误 code。
- 工具名称与成功/失败，不记录完整 args/result。
- sessionId 可使用日志内短 hash，避免直接暴露完整 ID。

### 禁止记录

- API Key、Authorization、完整环境变量。
- 用户正文、完整 prompt、system prompt、reasoning 正文。
- 冷资料快照全文。
- 用户目录绝对路径、runtime URL 和随机端口。
- 未清洗的 Provider/DSH response body。

诊断导出必须由用户主动触发，并在 UI 中说明包含哪些元数据。

## 9. 文档与维护交接

最终至少维护：

- 当前架构图与目录边界。
- Desktop API/AgentUiEvent schemaVersion。
- DSH 固定版本与已验证能力矩阵。
- 工具权限清单。
- 上下文热/冷路径和 compaction 说明。
- 常见错误 code、用户提示和排查方法。
- 升级步骤与回退版本。
- “Obsidian 不属于 DSH”的后续接入边界。

旧 Web UI 文档保留为历史记录时，标题或首段必须明确“已废弃”，不能被接手者误当现状。

## 10. 发布门槛

### 自动化

- DSH Contract Suite 全部通过。
- Gateway、IPC、preload、store、UI 测试通过。
- Architecture/runtime closure 检查通过。
- lint 无新增 error。
- Electron smoke/E2E 通过。
- 打包后安装运行验证通过。

### 人工

- 完成至少一次 30 分钟真实写作会话。
- 验证长回复、停止、继续、切章节、恢复历史。
- 验证无 Key、错误 Key、网络中断、Runtime 重启。
- 验证退出后无残留进程。
- 验证日志与诊断导出不含正文和密钥。

## 11. 阶段产物

- 完整 DSH Contract Suite 和升级矩阵。
- 性能基线/对比报告。
- 故障注入与耐久测试结果。
- 安全日志与诊断策略。
- 当前有效的维护/升级/回退文档。
- 私有 API Host 是否继续保留的证据化决策。

## 12. 验收清单

- [ ] 三层兼容契约均有自动化覆盖。
- [ ] DSH 依赖为精确版本，升级流程可重复。
- [ ] 工具权限由真实 Provider request 持续验证。
- [ ] 30 分钟流式和长历史测试无明显泄漏或失去响应。
- [ ] 故障注入不影响编辑器和项目保存。
- [ ] 日志/诊断不含密钥、正文、reasoning 和用户绝对路径。
- [ ] 私有 API Host/纯 Headless 决策有实测数据，不凭偏好切换。
- [ ] 当前文档、代码目录和生产运行闭包一致。
- [ ] Obsidian 仍未与 DSH Runtime 耦合。

## 13. 回退方法

稳定化阶段以测试、诊断和文档为主。若某项性能优化或 Host 变更引入回归，单独撤销该优化/变更，回到 Phase 5 已验证的 Gateway + 原生侧栏，不回退到官方 Web UI。

DSH 上游升级失败时恢复上一精确版本与 lockfile，并保留失败兼容报告供下次处理。

## 14. 本轮完成定义

本阶段验收后，本轮工作结束。后续 Obsidian 应从 `domains/knowledge/sources/obsidian` 单独立项，经 `KnowledgeSnapshot -> agent/context` 接入；不得直接修改 DSH Gateway 或让 DSH 读取 Vault。
