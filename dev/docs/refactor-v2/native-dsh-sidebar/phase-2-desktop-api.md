# Phase 2：Desktop API 与 Agent 事件契约

> 状态：待评审  
> 前置条件：[Phase 1](./phase-1-main-gateway.md) 全部通过  
> 后续阶段：[Phase 3 原生侧栏视觉壳](./phase-3-native-ui-shell.md)

## 1. 阶段目标

把 Main 内部 Gateway 变成 Renderer 可安全使用的稳定语义接口。完成后，自动化测试可以只通过 `window.cuigengji.agent` 完成对话，但生产 UI 暂时仍不切换。

## 2. 命名与模块边界

现有 `sessions.contract.js` / `sessions.handlers.js` 承担催更姬业务 content session，不在本阶段重命名，也不与 DSH runtime session 合并。

DSH 会话能力统一放在 `agent.*` 命名空间：

```text
shared/desktop-api/intelligence/agent/agent.contract.js
shared/desktop-api/intelligence/agent/agent-events.contract.js  # 需要时新增
electron/ipc/intelligence/agent/agent.handlers.js
electron/preload.cjs
```

这样避免“一个 sessions API 同时代表写作业务会话和 DSH event-log session”。

## 3. 公共命令契约

建议频道：

```js
status:         'cgj:v1:agent:status'
openProject:    'cgj:v1:agent:open-project'
listSessions:   'cgj:v1:agent:list-sessions'
createSession:  'cgj:v1:agent:create-session'
getHistory:     'cgj:v1:agent:get-history'
prompt:         'cgj:v1:agent:prompt'
cancel:         'cgj:v1:agent:cancel'
refreshContext: 'cgj:v1:agent:refresh-context'
restart:        'cgj:v1:agent:restart'
stop:           'cgj:v1:agent:stop'
event:          'cgj:v1:agent:event'
```

旧视图频道在本阶段保留但标记 deprecated：

```text
openWorkbench
setViewLayout
hideView
```

Phase 4 后不再调用，Phase 5 物理删除。

## 4. 输入 DTO 与验证

### openProject / refreshContext / restart

```js
{
  projectId: string,
  chapterId?: string
}
```

- projectId 必须非空并通过现有项目 ID 规则。
- chapterId 存在时必须属于 projectId。
- 不接受 workspace path、runtime root 或自定义 preset path。

### listSessions / createSession

```js
{ projectId: string }
```

Main 自己决定 workspace 和 preset，Renderer 不能指定任意 DSH preset。

### getHistory

```js
{
  projectId: string,
  sessionId: string,
  beforeSeq?: integer >= 0,
  maxMessages?: integer 1..100
}
```

默认 `maxMessages` 建议 30；Gateway 必须再次校验 session/project 归属。

### prompt

```js
{
  projectId: string,
  sessionId: string,
  text: string,
  mode: 'queue' | 'steer'
}
```

- text trim 后不能为空。
- 第一版限制 50,000 Unicode code points，避免超大 IPC payload；后续根据附件方案调整。
- Renderer 不传 DSH `content` block，不传 system、tools、provider 或 key。
- clientTimeZone 由 preload/Main 从受信环境补充，不信任页面任意值。

### cancel

```js
{ projectId: string, sessionId: string }
```

cancel 可重复调用；“当前没有运行 turn”返回幂等结果或明确的非错误状态。

## 5. 输出 DTO

### AgentStatusDto

```js
{
  kind: 'deepseek-harness',
  version: string,
  state: 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed',
  ready: boolean,
  hasCredential: boolean,
  retryable: boolean,
  message: string
}
```

不返回 child pid、runtime URL、配置签名或内部异常。

### AgentProjectDto

```js
{
  projectId: string,
  sessionId: string,
  status: AgentStatusDto,
  context: {
    chapterId?: string,
    generatedAt: string,
    knowledgeEntries: number
  }
}
```

### AgentSessionSummaryDto

```js
{
  sessionId: string,
  updatedAt: number,
  running: boolean,
  blank: boolean,
  active: boolean
}
```

不直接透传 DSH projections、cwd、parent internal metadata。

### AgentHistoryPageDto

```js
{
  sessionId: string,
  events: AgentUiEvent[],
  hasMore: boolean,
  oldestSeq?: number,
  newestSeq?: number
}
```

历史与实时事件使用同一 `AgentUiEvent`，Renderer 不维护两套 reducer。

## 6. 事件契约

统一外层：

```js
{
  schemaVersion: 1,
  type: string,
  projectId: string,
  sessionId?: string,
  generation: number,
  seq?: number,
  time: number,
  data: object
}
```

允许类型固定为：

```text
runtime.state
session.ready
turn.started
message.user
assistant.delta
assistant.completed
tool.started
tool.completed
turn.completed
turn.failed
```

Renderer 对未知 `type` 忽略并记录一次诊断，不崩溃；Main 默认不转发未知 DSH 原始事件。

## 7. preload API

```js
window.cuigengji.agent = {
  status(),
  openProject(input),
  listSessions(input),
  createSession(input),
  getHistory(input),
  prompt(input),
  cancel(input),
  refreshContext(input),
  restart(input),
  stop(),
  onEvent(listener),
}
```

`onEvent` 规则：

- 只监听固定 `AGENT_EVENT_CHANNEL`。
- 先验证 listener 是函数。
- 传给页面的是清洗后的 plain object，不传 Electron event。
- 返回 unsubscribe 函数。
- 多次 unsubscribe 无副作用。
- 页面 reload/窗口销毁后 Main 取消对应订阅。

## 8. Main 事件派发

事件只发给当前主窗口：

1. Main 注册一次 Gateway listener。
2. 每次发送前检查 `mainWindow` 与 `webContents` 未销毁。
3. project 已切换时，不发送旧 project 普通会话事件；runtime 崩溃状态可以按当前 active project 发送。
4. restart generation 变化后，旧 generation 事件被 Gateway/handler 丢弃。
5. 应用退出先注销 Gateway listener，再 stop Runtime。

不开放 Renderer 任意 subscribe(sessionId/channel) 能力，避免频道注入和跨项目监听。

## 9. 错误映射

沿用统一 Desktop API result envelope。公共错误至少包括：

| code | 用户含义 | retryable |
|---|---|---|
| `VALIDATION_ERROR` | 输入无效 | false |
| `AGENT_CREDENTIAL_MISSING` | 未配置 DeepSeek Key | false |
| `AGENT_RUNTIME_START_FAILED` | DSH 无法启动 | true |
| `AGENT_RUNTIME_UNREACHABLE` | 本机 Runtime 暂不可达 | true |
| `AGENT_SESSION_NOT_FOUND` | 会话不存在或已失效 | true |
| `AGENT_SESSION_PROJECT_MISMATCH` | 会话不属于当前项目 | false |
| `AGENT_PROMPT_REJECTED` | 当前输入未被接收 | true |
| `AGENT_STREAM_DISCONNECTED` | 实时流断开，正在恢复 | true |

公共 message 使用中文可操作说明，details 只放安全字段。

## 10. 测试计划

### Contract/IPC

- 每个频道注册一次且只能由主窗口调用。
- 所有 DTO 边界值、错误枚举和 prompt 长度。
- session/project 不匹配由 Main 拒绝。
- 任意 method、preset、endpoint、tool 参数不能从 Renderer 传入。
- 错误响应不含 URL、Key、绝对路径和原始堆栈。

### preload

- 方法名和 payload 映射正确。
- `onEvent` 不暴露 Electron event，unsubscribe 有效。
- 不存在通用 `invoke(channel)` 或通用 `on(channel)`。

### Electron 集成

- 测试页面只使用 `window.cuigengji.agent` 完成 open/prompt/event/history/cancel。
- 页面 reload 后没有双倍 listener。
- 主窗口关闭后 Gateway 继续产生事件也不会发送到销毁的 webContents。

### Architecture

Renderer 源码禁止出现：

```text
127.0.0.1:<DSH port>
/api/session.
/api/events.mux
EventSource/WebSocket 直连 DSH
@deepseek-ai/dsh-* runtime import
```

## 11. 阶段产物

- 版本化的 Agent 命令与事件契约。
- preload 安全 API 和可注销事件订阅。
- guarded IPC handlers 和错误清洗。
- 契约、preload、Electron 与架构测试。
- deprecated 视图接口清单及 Phase 5 删除标记。

## 12. 验收清单

- [ ] 只通过 Desktop API 可以完成一轮真实对话和历史读取。
- [ ] Renderer 不知道 DSH runtime URL 和原始 RPC/event schema。
- [ ] history 与 live 使用相同事件 DTO。
- [ ] session/project 隔离、payload 限制和窗口来源校验全部通过。
- [ ] listener 在 reload、unmount 和 window close 后无泄漏。
- [ ] 旧嵌入 UI 尚未删除，仍可整体回退。
- [ ] content sessions API 未与 DSH agent session 混合。

## 13. 回退方法

停止调用新频道，preload 恢复只暴露旧 open/layout/hide；Gateway 留在 Main 内但不连接 Renderer。回退不修改 DSH session 数据，也不需要迁移项目文件。

## 14. 进入下一阶段的条件

确认公共契约足以支持计划中的 UI 状态，且不需要为了视觉组件再暴露 DSH 原始字段。之后才制作原生侧栏视觉壳。

