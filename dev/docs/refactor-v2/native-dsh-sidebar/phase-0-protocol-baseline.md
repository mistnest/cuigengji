# Phase 0：DSH 协议实证与基线冻结

> 状态：待验收  
> 前置条件：当前 `WebContentsView` 方案可以启动并完成一次基本模型请求  
> 后续阶段：[Phase 1 Main 语义网关](./phase-1-main-gateway.md)

## 1. 阶段目标

在改 UI 和公共接口之前，用真实 DSH 子进程证明后台基底满足催更姬要求，并修复已经暴露的两个基础问题：

1. 自定义项目资料工具在插件测试中存在，但没有进入实际模型请求。
2. start/open/restart/stop、密钥刷新和视图打开之间存在并发竞态。

本阶段不新增用户功能，不改变 Agent 侧栏外观。

## 2. 已知事实与待验证假设

已确认：

- 固定版本 `@deepseek-ai/dsh@0.1.0-rc.7` 可以启动本机 Host。
- DSH 的 `session.prompt` 接受 queue/steer，`session.history` 返回事件页，`events.mux` 提供 WebSocket 事件流。
- 本地 mock provider 能收到 DSH 发出的流式模型请求并返回内容。
- 实施前的真实请求 `tools` 为空，不能把当时的工具权限测试视为通过。
- 重启与初次自动启动重叠时可能返回通用桌面错误；运行时恢复后嵌入视图也可能保持隐藏。

需要在本阶段得到证据的假设：

- 工具缺失来自 plugin scope、restriction 顺序或 ToolDefinition 形状，而不是模型 Provider 本身。
- DSH history 与 WebSocket 对同一事件使用相同 sessionId/seq，可以做确定性的断线补齐。
- 热上下文文件在下一次 step 组装系统提示时会重新读取，而不要求重启 session。
- DSH 的 cancel、queue、steer 在当前固定版本的事件顺序稳定可映射。

## 3. 允许修改的文件

```text
electron/intelligence/agent/dsh/dsh-supervisor.js
electron/intelligence/agent/dsh/plugins/*.mjs
dev/tests/interface/dsh-agent-plugins.spec.js
dev/tests/integration/dsh-runtime-contract.spec.js       # 新增
dev/tests/helpers/dsh-contract-runtime.js                 # 新增
dev/docs/refactor-v2/native-dsh-sidebar/phase-0-*.md      # 结果记录
```

不修改 Renderer、preload、公共 IPC 和 `dsh-view-host.js`。

## 4. 工作分解

### 4.1 冻结当前性能和运行基线

记录同一开发机、同一测试项目下的：

- 打开 Agent 前后的进程数和 WebContents 数。
- Agent 标签首次可交互耗时。
- 空闲与一次流式回复后的主进程、Renderer、DSH 子进程内存。
- 当前侧栏的最小、常用和最大宽度。
- 当前启动、切标签、拖宽度和退出过程的错误日志。

结果只记录数值和环境，不保存用户正文、密钥或模型完整请求。

### 4.2 建立真实 DSH Contract Test

测试启动真实 DSH 子进程，但 Provider 指向进程内或本机 mock server：

1. 准备隔离的临时 `DSH_HOME`、workspace 和项目快照。
2. 通过与生产一致的 overlay/preset 启动 DSH。
3. 调用 `workspace.create`、`session.create`、`session.prompt`。
4. 同时通过 WebSocket 消费 `events.mux`，并在结束后读取 `session.history`。
5. 捕获 mock provider 收到的 request header、system、messages、tools 与 stream 标志。
6. 正常停止 DSH，断言没有遗留子进程和占用端口。

fixture 中只使用虚构项目数据和假 API Key。

### 4.3 定位并修复工具缺失

按以下顺序缩小原因，禁止直接放宽权限掩盖问题：

1. 记录 preset 最终加载顺序和 DSH 启动错误。
2. 暂时在 Contract Test 组合中移除 tool restriction，比较最终 request tools。
3. 比较 `ctx.tools.register` 原始对象与 DSH 官方 `defineTool` 生成对象。
4. 检查工具注册 scope 是否与 session/agent preset scope 一致。
5. 检查 restriction 是只过滤全局工具，还是也过滤催更姬作用域工具。
6. 使用最小修复让最终请求恰好包含：
   - `search_project_knowledge`
   - `get_project_knowledge`
7. 故意请求一个未授权工具，确认 guard 会拒绝而不是静默执行。

最终安全断言看真实 Provider request，不看插件内的注册表快照。

### 4.4 验证上下文读取时机

使用同一 session 连续发送两轮：

1. 第一轮断言 system prompt 含版本 A 的当前章节标记。
2. 原子更新热上下文与冷资料快照为版本 B。
3. 不重启 DSH，不新建 session，发送第二轮。
4. 断言第二轮 system prompt 与工具查询结果使用版本 B。
5. 断言 history 仍包含第一轮，说明刷新没有清空会话。

### 4.5 验证事件协议

至少保存以下事件的脱敏结构样例：

```text
session/subscribed
turn/start
user/message
step/start
request/header
assistant/chunk(text-delta)
assistant/chunk(reasoning-delta，如 Provider 支持)
assistant/message
tool/call
tool/result
step/end
turn/end
```

分别跑：普通回复、工具回复、cancel、回复中 queue、回复中 steer、Provider 错误。记录每种情况下 `turn/end.reason` 以及 history/WebSocket 的 seq 连续性。

### 4.6 生命周期串行化

`dsh-supervisor` 只允许一个生命周期操作链修改以下状态：

```text
idle -> starting -> ready -> stopping -> stopped
                    \-> failed
```

实现要求：

- 同配置的并发 open 合并为同一个 Promise。
- restart 必须等待正在进行的 start 完成或明确取消旧 generation 后再启动。
- stop 可重复调用，且不会让旧 child 的 exit 事件污染新 generation。
- 配置签名变化时，下一次 open 必须重启；签名包含 project、model、endpoint 和密钥摘要，但日志中不出现密钥。
- 保存/删除密钥只使当前配置失效；真正 restart 在串行链中完成。
- 启动失败、Host 未就绪、Provider 无密钥分别映射为不同内部错误。

本阶段仍可保留 `showWorkbench`，但 supervisor 的正确性不能再依赖视图是否显示。

## 5. 必须新增或加强的测试

| 用例 | 关键断言 |
|---|---|
| real prompt | mock Provider 收到 stream 请求且返回内容进入 history |
| exact tools | 最终 request 恰好有两个允许工具 |
| tool execution | search/get 读取隔离的冷资料 fixture |
| denied tool | 非白名单工具不能执行 |
| hot refresh | 同 session 第二轮读取新快照 |
| cancel | 出现确定的结束状态，进程仍可继续下一轮 |
| queue/steer | 输入进入 DSH 对应模式且事件无重复 |
| concurrent open | 只创建一个 child |
| restart during start | 最终只有最新 generation ready |
| credential invalidation | 新 open 使用新配置签名 |
| cleanup | 测试退出后无子进程和端口残留 |

## 6. 阶段产物

- 可重复运行的真实 DSH Contract Test。
- 工具缺失原因与最小修复。
- 生命周期竞态修复及状态测试。
- 一份脱敏协议样例和事件顺序报告。
- 当前嵌入方案的性能/进程基线。
- 实施结果：[phase-0-result.md](./phase-0-result.md)。

## 7. 验收清单

- [x] 真实模型请求中恰好存在两个项目资料工具。
- [x] Shell、任意 FS、网页、子 Agent 和写入工具均不存在。
- [x] 热上下文与冷资料可以在同 session 下一轮生效。
- [x] history 和 WebSocket 的 sessionId/seq 对齐规则已由测试固定。
- [x] cancel、queue、steer 和 Provider 错误都有真实事件样例。
- [x] open/restart/stop 并发测试没有多进程、假 ready 或旧状态覆盖。
- [x] 测试不依赖官方 DSH 页面 DOM。
- [x] 现有 Agent 侧栏行为没有发生用户可见变化。

## 8. 风险与处理

- 如果两个工具无法在不放宽全局工具的前提下进入请求：停止阶段，保留当前实现，不进入 Phase 1；重新评估 preset scope 组合。
- 如果 WebSocket 与 history 的 seq 不能可靠对齐：Phase 1 改用 history 轮询作为临时正确性方案，但必须在文档中明确性能代价。
- 如果当前固定版本的 queue/steer 不稳定：第一版 UI 只开放普通 queue 与 cancel，不伪造 steer 行为。
- 如果修复必须修改 DSH 上游包：优先用催更姬插件/adapter 修复；确需 fork 时另写依赖决策，不直接改 `node_modules`。

## 9. 回退方法

本阶段不改公共接口和 UI。回退时整体撤销 supervisor/plugin 的阶段改动和新 Contract Test，恢复原有嵌入路径。临时目录由测试清理，不迁移或删除任何真实项目数据。

## 10. 进入下一阶段的条件

验收清单全部通过，并由评审者确认：真实请求的工具权限、上下文刷新和生命周期证据足以支撑无网页的 Main 客户端。
