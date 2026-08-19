# Phase 4：原生侧栏流式交互接管

> 状态：待评审  
> 前置条件：[Phase 3](./phase-3-native-ui-shell.md) 视觉评审通过  
> 后续阶段：[Phase 5 移除 Web UI](./phase-5-remove-web-ui.md)

## 1. 阶段目标

把 Phase 3 的原生侧栏连接到 Phase 2 的 Desktop API，完成真实 session、history、流式回复、工具活动、queue/steer、cancel 和错误恢复。阶段通过后，普通用户不再使用 DSH 官方 GUI，但旧视图宿主仍保留一个版本作为内部诊断回退。

## 2. 核心状态模型

`agent-store` 是唯一 UI 状态来源：

```js
{
  runtime: { state, ready, hasCredential, message, generation },
  project: { projectId, chapterId, contextState, generatedAt },
  sessions: Map<sessionId, SessionSummary>,
  activeSessionId: string | null,
  histories: Map<sessionId, {
    eventsBySeq,
    orderedSeqs,
    hasMore,
    loading,
    lastSeq
  }>,
  conversation: {
    items,
    activeTurn,
    running,
    pendingPrompts,
    toolsByCallId
  },
  composer: { text, submitting, mode, error }
}
```

Store 不保存 DOM、AbortController、Electron listener 或 DSH 原始 frame。相同 history + live events 必须得到相同 conversation 投影。

## 3. 初始化时序

为避免“先取历史还是先订阅”造成事件缺口，顺序固定：

1. Workbench mount 时注册一次 `agent.onEvent`。
2. 项目有效且 Agent 标签启用时调用 `agent.openProject`。
3. 收到 project/session DTO 后，将 generation 和 activeSessionId 写入 store。
4. 调用 `agent.getHistory` 读取尾页。
5. 初始化期间到达的 live event 先进入按 session/seq 排序的缓冲区。
6. history 归并完成后，再按 seq 归并缓冲事件。
7. 重复 `(generation, sessionId, seq)` 幂等忽略。
8. 组件从 store 投影，不直接处理 IPC 回调。

Gateway 已负责 WebSocket 缺口补齐，Renderer 仍必须处理 history/live 同一事件重复到达。

## 4. 事件归并规则

### runtime.state

- generation 较旧：忽略。
- starting/reconnecting：保留已有对话，只改变状态栏。
- failed：结束当前 UI streaming 状态，显示可重试错误，不删除历史。
- ready：允许发送；如 generation 变化，重新 open/history 对齐。

### message.user

- 以 seq 为历史身份。
- 与 `pendingPrompts` 按提交顺序和文本内容匹配，替换 optimistic item，而不是再插入一条。
- 无匹配 pending 时按普通历史事件插入，例如另一路 queue/恢复事件。

### assistant.delta

- 使用 `(sessionId, turn, step, kind)` 找到正在增长的临时块。
- text/reasoning 分开累加。
- seq 只用于去重和顺序，不把每个 chunk 渲染成独立消息。
- 每个 animation frame 最多提交一次 DOM 更新。

### assistant.completed

- 使用最终 message 校正对应 turn/step 的 chunk 累计内容。
- 标记 answer 完成并记录 usage 的安全摘要。
- 最终文本与 chunk 不一致时以 completed 为准，记录一次诊断。

### tool.started / tool.completed

- callId 是工具卡片身份。
- 只渲染 Gateway 提供的安全名称和摘要。
- tool completed 更新原卡片，不新增重复卡片。
- 未收到 started 的 completed 也能恢复出完整卡片，以支持 history 截断页。

### turn.completed / turn.failed

- 清除 activeTurn/running。
- cancel 显示“已停止”，Provider 错误显示可操作错误。
- 队列仍有输入时保持队列提示，等待下一 turn.started。

## 5. Prompt 与 optimistic UI

发送过程：

1. 输入 trim 后生成 Renderer 内部 `clientPromptId`。
2. 立即加入 pending user item，清空 composer，保留撤回前文本。
3. 调用 `agent.prompt`。
4. IPC 接受后等待 `message.user` 对账。
5. IPC 拒绝时，将 pending item 标记失败并提供“恢复到输入框”。

DSH 当前 prompt response 不保证返回 durable messageId，因此不能把 clientPromptId 写成 DSH 消息身份。对账使用“同 session、pending 顺序、规范化文本”；相同文本连续提交也按队列顺序匹配。

## 6. queue、steer 与 cancel 交互

### 空闲时

- 主发送按钮固定使用 `mode: queue`。
- 用户无需理解 DSH 术语。

### 正在生成时

- 默认主操作显示“加入队列”，仍使用 queue。
- 次级明确操作“调整当前回复”使用 steer，不把普通 Enter 隐式变成 steer。
- 若 Phase 0 证明当前版本 steer 不稳定，则第一版隐藏 steer，只保留 queue/cancel，并在实现记录中说明。
- 停止按钮调用 cancel，点击后进入 cancelling，避免重复请求；结果幂等。

### 快捷键

- Enter：按当前明确选定模式发送。
- Shift+Enter：换行。
- IME composition 中不提交。
- Escape 不直接 cancel，避免中文输入和弹层误触；停止使用可见按钮。

## 7. 会话管理

### 恢复

- 默认恢复项目最近使用且非 subagent 的 session。
- active session 只保存安全 sessionId/projectId 关联；DSH 仍是会话权威来源。
- session 不存在时清除本地选择，创建或选择 DSH 返回的可用 session。

### 新建

- 运行中默认禁用；允许时先 cancel 并等待 turn 结束，再创建。
- 新 session 固定使用 `cuigenji` preset，Renderer 不能选任意 preset。
- 创建后立即切 active session，显示空状态，不影响旧 session history。

### 历史列表

- 展示更新时间、运行状态和首条 user 文本的安全截断预览。
- 如果 list DTO 没有标题/预览，只在打开弹层时按需取轻量 history，不给所有会话同时加载完整历史。
- 当前阶段不实现删除、fork、rename；这些是独立需求，不能顺手扩大接口。

### 历史分页

- 初始加载最近约 30 条消息对应的事件。
- 用户滚动到顶部时用 beforeSeq 加载更早页。
- 插入旧页后保持当前滚动锚点，不突然跳到顶部或底部。

## 8. 上下文刷新

上下文仍由项目/章节模块触发，不由 Agent 读取 Renderer DOM：

- 打开/切换项目：`openProject`，可能切换 Runtime。
- 切章节：debounce 后 `refreshContext`。
- 保存当前章节、项目摘要或当前 JSON 资料：按现有保存成功事件 refresh。
- refresh 期间允许阅读历史；发送按钮可以保持可用，但状态栏显示“上下文同步中”。
- refresh 失败不清空会话，下一轮发送前提示“本轮可能仍使用旧上下文”，允许重试。
- Obsidian 不在触发源列表中。

## 9. 渲染性能

### 增量 DOM

- conversation item 使用稳定 key，只更新变化的 assistant text node/tool card。
- 不在每个 delta 上 `innerHTML = ...` 或重绘整个消息列表。
- delta 先写内存 buffer，再通过 `requestAnimationFrame` 批量刷新。
- 长历史可先按页渲染；超过明确阈值后再评估虚拟列表，不在第一版过度设计。

### 自动滚动

- 用户距底部小于约 80 px 时跟随流式输出。
- 用户主动上翻后停止自动跟随，显示“回到底部”按钮。
- 新 user prompt 发出时回到底部。
- reasoning 折叠/展开后保持用户视口意图。

### Markdown

- 流式阶段先以纯文本显示。
- assistant.completed 后可转换为安全 Markdown。
- 如引入 renderer，必须禁用原始 HTML、限制 `http/https` 链接并通过 `app.openExternal` 打开。
- Markdown 转换不得改变 store 中的原始文本，也不得阻塞下一个 delta。

## 10. 错误状态

| 场景 | UI 行为 |
|---|---|
| 未配置 Key | composer 禁用，提供“前往 AI 设置” |
| DSH starting | 保留内容，显示启动中 |
| WebSocket reconnecting | 保留内容，暂缓发送或明确提示 |
| Provider 失败 | turn 卡片显示失败，可恢复输入重试 |
| DSH crash | Agent 面板 failed，可重启；编辑器不受影响 |
| history 失败 | 保留已收到 live 状态，允许单独重试历史 |
| context refresh 失败 | 不清会话，显示上下文可能过期 |
| prompt rejected | optimistic item 标错并可恢复到输入框 |

不再用同一个“桌面端操作失败”覆盖上述状态。

## 11. 生命周期与标签切换

- Agent 标签隐藏时不销毁 store、不停止 DSH、不调用任何 bounds IPC。
- 标签再显示时只恢复 DOM/滚动位置；事件订阅一直由 mounted workbench 管理。
- 项目关闭时取消当前 UI 订阅投影、清 project/session 状态；是否 stop DSH 由 Main 生命周期策略决定。
- window visibility 不影响 DSH 连接，只影响是否立即做 DOM batch；恢复可见后一次性刷新。
- workbench unmount 必须注销 `agent.onEvent`、DOM listener、timer 和 animation frame。

## 12. 测试计划

### Store 重放

- 普通文字、reasoning、工具、多 step、cancel、失败。
- history 先到/live 后到、live 先到/history 后到。
- 重复 seq、乱序缓冲、旧 generation、未知事件。
- assistant completed 校正 chunk。
- optimistic user 对账与 prompt rejection。
- 同一事件序列重放两次结果深相等。

### UI 行为

- IME、快捷键、queue/steer/cancel 状态。
- streaming 时切标签、拖侧栏、切章节。
- 用户上翻时不抢滚动，回到底部按钮有效。
- session 切换不会把 A 的 delta 写入 B。
- 历史向上分页保持滚动锚点。

### Electron E2E

使用真实 DSH + mock Provider：

1. 打开 fixture 项目。
2. 原生侧栏自动 ready。
3. 发送并看见 user optimistic item。
4. 看见 reasoning/text delta 和最终回答。
5. 触发资料工具并看见工具卡片。
6. 回复中 queue/cancel。
7. 切章节并确认下一轮 context 更新。
8. reload 窗口并恢复 history。
9. 杀掉 DSH child，确认编辑器仍可保存并可重启 Agent。

## 13. 性能验收

相对 Phase 0 基线至少满足：

- Agent 不再增加第二个页面渲染与 bounds 同步负担。
- 用户点击发送后，optimistic item 在一个动画帧内出现。
- Provider chunk 到达 Main 后，UI 批量绘制附加延迟可单独测量且无持续长任务。
- 10,000 字历史与连续回复时，输入框仍可响应。
- 标签切换不触发网络 reload 或 DSH 页面重新布局。

具体数值以 Phase 0 实测环境记录为对照，不用网络首字时间冒充 UI 性能。

## 14. 阶段产物

- 连接真实 Desktop API 的原生 Agent 侧栏。
- 幂等可重放 `agent-store`。
- session/history/prompt/queue/steer/cancel 完整交互。
- 上下文同步、错误恢复和崩溃隔离。
- Store、UI 与 Electron 真实流式测试。

## 15. 验收清单

- [ ] 普通用户路径默认进入原生侧栏，不显示 DSH 官方页面。
- [ ] user、reasoning、answer、tool 和 turn 状态按真实事件正确显示。
- [ ] history + live 任意到达顺序都不丢失、不重复。
- [ ] queue/cancel 可用；steer 只在已由 Phase 0 证明稳定时开放。
- [ ] 切章节刷新上下文但不清空 session。
- [ ] 标签切换、窗口缩放不再调用视图 bounds IPC。
- [ ] DSH 崩溃不影响章节保存和其他模块。
- [ ] 性能相对嵌入方案有可复测的改善证据。
- [ ] 人工完成一次真实写作对话并确认可用。

## 16. 回退方法

一个版本内保留 Main 控制的内部 `legacy embedded view` 诊断开关。回退时切回旧 workbench/open/layout/hide 路径，新 Desktop API 和 Gateway 可以保留但不驱动 UI。不得同时显示两个 Agent UI，也不删除任何 DSH session 数据。

## 17. 进入下一阶段的条件

原生侧栏完成真实写作验收、错误恢复和性能对比，评审者确认不再需要官方 GUI 作为普通用户入口。之后才能删除 WebContentsView 生产路径。
