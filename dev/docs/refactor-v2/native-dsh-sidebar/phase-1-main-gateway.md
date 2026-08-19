# Phase 1：Electron Main DSH 语义网关

> 状态：待评审  
> 前置条件：[Phase 0](./phase-0-protocol-baseline.md) 全部通过  
> 后续阶段：[Phase 2 Desktop API](./phase-2-desktop-api.md)

## 1. 阶段目标

在 Electron Main 内建立 DSH 的唯一可信客户端，使一整轮对话不再依赖官方网页。该阶段只形成内部 JavaScript API，不切换 Renderer 公共接口。

Gateway 对上提供“打开项目、管理 Agent 会话、发送、取消、取历史、订阅语义事件”，对下组合 supervisor、RPC、WebSocket 和 context refresh。

## 2. 组件职责

```text
dsh-supervisor
  只负责进程状态、配置签名、启停和 runtime endpoint 的内部所有权

dsh-rpc-client
  只负责 /api/<method> 请求信封、超时、响应解析和 DSH 错误

dsh-event-stream
  只负责 /api/events.mux WebSocket、重连、frame 解析和连接状态

dsh-event-mapper
  只负责 DSH frame/event -> AgentRuntimeEvent

dsh-session-registry
  只负责当前 project/workspace/session 关系和最后消费 seq

dsh-gateway
  编排以上组件，提供 Main 内稳定用例
```

不把这些职责重新堆回一个 supervisor 文件，也不让每个 IPC handler 自己拼 DSH RPC。

## 3. 允许修改的文件

```text
electron/intelligence/agent/dsh/dsh-supervisor.js
electron/intelligence/agent/dsh/dsh-gateway.js          # 新增
electron/intelligence/agent/dsh/dsh-rpc-client.js       # 新增
electron/intelligence/agent/dsh/dsh-event-stream.js     # 新增
electron/intelligence/agent/dsh/dsh-event-mapper.js     # 新增
electron/intelligence/agent/dsh/dsh-session-registry.js # 按需要新增
electron/intelligence/agent/dsh/README.md
dev/tests/interface/dsh-gateway.spec.js                      # 新增
dev/tests/integration/dsh-gateway-runtime.spec.js            # 新增
```

不修改 Renderer 和 preload。当前 Agent IPC 仍可继续走旧 `openWorkbench`。

## 4. 内部 API 草案

```js
gateway.status()
gateway.openProject({ projectId, chapterId })
gateway.listSessions({ projectId })
gateway.createSession({ projectId })
gateway.getHistory({ projectId, sessionId, beforeSeq, maxMessages })
gateway.prompt({ projectId, sessionId, text, mode, clientTimeZone })
gateway.cancel({ projectId, sessionId })
gateway.refreshContext({ projectId, chapterId })
gateway.restart({ projectId, chapterId })
gateway.stop()
gateway.subscribe(listener)
```

所有返回值都是催更姬内部 DTO，不暴露 `runtimeUrl`。只有 RPC client 和 event stream 能读取 runtime endpoint。

## 5. 工作分解

### 5.1 抽出 RPC Client

统一完成：

- 每次调用生成 rpcId。
- POST `/api/<allowlisted-method>`。
- 默认 10 秒超时；启动/历史等特殊方法可由调用方提供受限策略。
- 校验 HTTP 状态、rpcId 对应和 `result.ok`。
- 把 DSH 错误码映射为内部 `DshRpcError`，保留可测试 code，不透传敏感 message。
- 只实现固定 allowlist，禁止接受 Renderer 提供的任意 method。

初始 allowlist：

```text
workspace.create
workspace.rename
session.list
session.create
session.history
session.prompt
session.cancel
```

未进入产品需求的方法不提前暴露。

### 5.2 接入 WebSocket 事件流

DSH 当前 Host 的 `events.mux` 是 WebSocket；以普通 HTTP 请求访问会返回 426。实现要求：

1. Electron Main 使用 Node 24 的标准 `WebSocket` 管理一条活动连接。
2. 只接受文本消息，逐帧解析 JSON；拒绝二进制和畸形 frame。
3. 校验外层 envelope 和 payload 基本字段。
4. 只处理当前注册 project 对应 session；其他 session frame 不进入 UI 事件订阅者。
5. 断线采用有上限的退避重连；stop/restart 主动 abort 不计为失败。
6. 恢复后读取 session.history，从 `lastSeq + 1` 补齐再继续实时事件。
7. 对 `(sessionId, seq)` 去重，未知事件记录诊断但不使流退出。

### 5.3 建立会话注册表

DSH 自己仍是 workspace/session 权威来源，注册表只保存当前进程内的路由状态：

```text
projectId
workspaceId
activeSessionId
knownSessionIds
lastSeqBySession
runtimeGeneration
```

禁止另建一份永久 JSON session 数据库。重启后通过项目 runtime workspace path 调用幂等 `workspace.create`，再从 DSH workspace/session 信息恢复。

注册表必须校验：Renderer 以后提供的 sessionId 必须属于当前 project，不能跨项目读取或发送。

### 5.4 定义语义事件映射

内部事件建议为：

| DSH 输入 | 催更姬事件 | 主要字段 |
|---|---|---|
| runtime start/stop/error | `runtime.state` | state、retryable、message |
| session/subscribed | `session.ready` | projectId、sessionId、lastSeq |
| turn/start | `turn.started` | sessionId、turn、seq |
| user/message | `message.user` | messageId、content、seq |
| assistant text delta | `assistant.delta` | turn、step、kind=text、text、seq |
| assistant reasoning delta | `assistant.delta` | kind=reasoning |
| assistant/message | `assistant.completed` | message、usage、seq |
| tool/call | `tool.started` | callId、name、safeSummary、seq |
| tool/result | `tool.completed` | callId、name、status、safeSummary、seq |
| turn/end | `turn.completed` 或 `turn.failed` | reason、seq |

映射规则：

- 工具 raw arguments 默认不进入 Renderer，只生成白名单工具的安全摘要。
- assistant 最终 message 用于收敛 chunk；UI 可用它校正流式拼接结果。
- 未知 DSH event 不向 UI 伪装成错误，只进入诊断计数。
- 所有事件附带 `schemaVersion`、projectId、sessionId 和 runtime generation。

### 5.5 Gateway 编排

`openProject` 的确定顺序：

1. 校验 projectId/chapterId。
2. 生成最新上下文快照和 DSH launch 配置。
3. supervisor 启动或按配置签名复用 Runtime。
4. 建立 WebSocket 连接。
5. 幂等创建/恢复 workspace。
6. 恢复一个可用 session；没有则创建 `cuigenji` preset session。
7. 拉取尾部 history，设置 lastSeq。
8. 返回清洗后的 project/session/status DTO。

`prompt` 必须先验证 runtime generation、project/session 归属和非空文本，再调用 DSH。最大文本长度在 Phase 2 对外契约处固定，Gateway 也做第二层防御。

### 5.6 错误与恢复

内部错误至少区分：

```text
AGENT_RUNTIME_START_FAILED
AGENT_RUNTIME_UNREACHABLE
AGENT_CREDENTIAL_MISSING
AGENT_SESSION_NOT_FOUND
AGENT_SESSION_PROJECT_MISMATCH
AGENT_STREAM_DISCONNECTED
AGENT_PROMPT_REJECTED
AGENT_CANCEL_REJECTED
```

Provider 错误、Runtime 崩溃和 WebSocket 临时断线不能混成一个“桌面端操作失败”。错误对象不得带 DSH URL、API Key、request body 或绝对项目路径。

## 6. 测试计划

### 单元/接口测试

- RPC allowlist、rpcId mismatch、超时、非 JSON、DSH error。
- WebSocket 文本 frame、二进制拒绝、坏 JSON、主动 close。
- mapper 的所有已知事件、未知事件和敏感工具参数。
- registry 的跨项目 session 拒绝、generation 切换和 seq 去重。

### 真实 Runtime 集成测试

- 不创建 WebContentsView，Gateway 完成 open -> prompt -> stream -> history。
- WebSocket 在回复中断开后重连，history 补齐且事件恰好一次。
- DSH child 崩溃后状态变 failed；restart 后旧 generation 事件被忽略。
- 两个项目先后打开时 session 不串线。
- 取消后可在同 session 继续下一轮。

## 7. 阶段产物

- Main 内可独立使用的 DSH Gateway。
- 受测的 RPC allowlist 和 WebSocket 消费器。
- 稳定的内部 AgentRuntimeEvent 结构。
- 跨项目隔离与 seq 补齐策略。
- 更新后的 DSH adapter 维护说明。

## 8. 验收清单

- [ ] 无 Renderer、无官方 DSH 页面时可完成完整流式对话。
- [ ] Runtime endpoint 只存在于 supervisor/RPC/WebSocket 私有边界。
- [ ] WebSocket 断线补齐测试无丢失、无重复。
- [ ] sessionId 不能跨 project 使用。
- [ ] mapper 不向上透传 DSH 原始工具参数和敏感错误。
- [ ] Gateway stop 后没有连接、timer、listener 或 child 残留。
- [ ] 当前生产 IPC 和官方嵌入 UI 仍可作为回退路径。

## 9. 风险与回退

- WebSocket 长连接在 Electron Main 环境不稳定时，可短期降级为增量 history polling；必须保留相同 Gateway API。
- DSH workspace.list 不足以恢复 project 映射时，使用项目专属 runtime root + 幂等 workspace.create，不新增第二权威存储。
- mapper 遇到上游未知事件只记录，不阻塞基础文字回复。

回退时移除新 Gateway 组合和测试，IPC 继续调用现有 supervisor/openWorkbench；不改变数据格式。

## 10. 进入下一阶段的条件

Gateway 在真实 Runtime 测试中完成对话、取消、重连、恢复和跨项目隔离，并确认公共契约不需要暴露任何 DSH URL 或原始 frame。
