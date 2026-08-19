# Phase 0 结果：DSH 协议实证与基线冻结

> 状态：待人工验收  
> 实施日期：2026-08-18  
> 固定依赖：`@deepseek-ai/dsh@0.1.0-rc.7`  
> 对应计划：[phase-0-protocol-baseline.md](./phase-0-protocol-baseline.md)

## 1. 结论

Phase 0 的自动化验收项已完成，可以进入人工 Review。当前改动没有替换官方 DSH 页面、没有修改 Renderer/preload/公共 IPC，也没有接入 Obsidian。

真实 DSH 子进程已经证明以下链路成立：

```text
生产 overlay/preset
  -> DSH Host
  -> workspace/session
  -> WebSocket events.mux
  -> mock DeepSeek Provider
  -> 两个只读资料工具
  -> history 与同 session 下一轮热刷新
```

## 2. 工具缺失的原因与修复

### 原因

原策略在 preset scope 调用 `ctx.tools.restrict({ allow: [] })`。在当前固定 DSH 版本中，这不只隐藏上游工具，也会让同组合中的催更姬工具从最终 Provider request 消失。因此插件内“注册成功”与模型实际“看得见工具”并不等价。

### 修复

1. 两个资料工具改用官方 `@deepseek-ai/dsh-tools` 的 `defineTool` 和当前参数 DSL。
2. 催更姬 preset 本身不组合上游 Shell、文件、网页或子 Agent 工具。
3. `cuigenji-tool-policy` 在 Agent scope 读取最终 `schemas(scope)`，要求工具名精确等于：
   - `search_project_knowledge`
   - `get_project_knowledge`
4. 工具缺失或出现额外工具时，preset 挂载失败；guard 同时拒绝白名单外执行。
5. DSH 文件 sandbox 继续固定为 `read-only`。
6. Contract Test 以 mock Provider 收到的最终 `tools` 为权威断言，不再只检查插件注册表。

真实请求中最终只有上述两个工具；Shell、任意文件系统、网页、子 Agent 和写入工具均不存在。

## 3. Prompt 与上下文结果

真实请求曾暴露 DSH 默认的编程 Agent 身份、implementation checkout、Web GUI 和 deliverables 提示。生产 overlay 现在关闭这些面向编程/Web UI 的提示贡献，同时保留催更姬 persona 与动态 runtime context。

同一 session 的验证结果：

- 第一轮读取章节版本 A。
- 原子刷新 `project-context.json` 与 `project-knowledge.json` 后不重启 DSH。
- 第二轮读取章节版本 B，且 history 仍保留第一轮。
- 系统提示包含“催更姬”，不再包含 `coding agent`、`DeepSeek Harness Web GUI` 或 `implementation checkout`。

## 4. 实际协议基线

### 4.1 传输

- RPC：`POST /api/<method>`，使用 `client-request` envelope 和 rpcId 对账。
- 实时事件：`WebSocket /api/events.mux`；普通 HTTP 访问返回 426，不是 SSE。
- 历史：`session.history`。
- WebSocket 与 history 使用同一 sessionId/seq；本次测试中的实时 seq 单调递增且无重复。

### 4.2 已验证事件

```text
permission/preset
sandbox/mode
approval/policy
agent/inbox/spliced
turn/start
user/message
step/start
request/header
request/context
assistant/chunk
assistant/message
tool/call
tool/result
step/end
turn/end
```

关键结束形状：

| 场景 | `turn/end.data.reason.kind` | 其他证据 |
|---|---|---|
| 正常/工具/排队/转向 | `completed` | 最终 assistant message 进入 history |
| 用户取消 | `aborted` | `reason.reason.kind=user` |
| Provider 401 | `error` | `assistant/chunk` 的 finish reason 同为 `error` |

当前 DSH 没有为 Provider 失败单独持久化 `request/error`；Phase 1 mapper 应读取 finish chunk 和 turn/end，而不能等待不存在的事件。

### 4.3 Queue、Steer、Cancel

- 正在生成时发送 queue：当前轮完成后按下一轮继续。
- 正在生成时发送 steer：在当前轮的下一 step 被消费。
- cancel：当前轮稳定结束为 `aborted`，同 session 可继续使用。

已知限制：在本次 rc.7 实测中，“先 queue、再 cancel”会产生 `aborted`，但取消前排队的消息没有自动触发下一次 Provider 请求。这与 Host 接口注释中的自动恢复表述不完全一致。Phase 4 不应承诺“停止后自动续跑已有队列”；可以选择停止时明确保留为待处理状态，或在网关层制定经测试的唤醒策略，但不得伪造已发送状态。

## 5. 生命周期结果

`dsh-supervisor` 的公开生命周期操作现在进入同一 Promise 串行链：

- 同 project/chapter 的并发 open 合并为同一个 Promise，只创建一个 child。
- open 与 restart 不再重叠启动子进程。
- 配置签名改变或密钥配置失效后，下一次 open 会替换旧 Runtime。
- stop 可重复调用，并真正等待 exit；旧实现把 `kill()` 的同步返回值放进 `Promise.race`，实际不会等待子进程退出。
- generation 继续阻止旧 child 的 exit 事件覆盖新 Runtime 状态。
- prepare、ready probe、workspace 初始化可注入，生命周期接口测试不依赖真实端口。

## 6. 当前 Web UI 嵌入基线

采样环境为当前 Windows 开发机、Electron `43.2.0`、无真实 API Key。数值用于 Phase 5 同机相对比较，不作为跨机器性能承诺。

| 指标 | 打开 Agent 前 | 官方 DSH GUI ready 后 | 增量 |
|---|---:|---:|---:|
| BrowserWindow | 1 | 1 | 0 |
| WebContents | 1 | 2 | +1 |
| Electron `app.getAppMetrics()` 工作集合计 | 471,864 KB | 819,864 KB | +348,000 KB |
| DSH 页面 Tab 工作集 | 0 | 165,908 KB | +165,908 KB |

补充观察：

- 同次暖启动中，从确认创建项目到 DSH ready 为 2,361 ms。
- 首次冷运行中，从应用启动到 DSH ready 观察到约 18,637 ms；该值包含应用启动和测试 UI 操作，只作上界样本。
- GPU 工作集在前后样本中从 140,752 KB 变为 291,188 KB，波动较大，不能全部归因于 DSH。
- 当前右栏默认宽度 420 px，代码最小宽度 320 px，没有独立最大宽度，只受窗口和中间编辑区布局约束。

## 7. 新增或加强的测试

| 文件 | 覆盖内容 |
|---|---|
| `dev/tests/helpers/dsh-contract-runtime.js` | 真实 DSH child、WebSocket mux、RPC、mock DeepSeek SSE Provider |
| `dev/tests/integration/dsh-runtime-contract.spec.js` | 最终 tools、实际工具执行、热刷新、seq、queue/steer/cancel、Provider 401 |
| `dev/tests/interface/dsh-agent-plugins.spec.js` | 两个工具、guard、额外工具失败即关闭、小说 compaction |
| `dev/tests/interface/dsh-supervisor.spec.js` | 并发 open、restart 串行、配置失效、refresh、等待退出与幂等 stop |

阶段定向测试命令：

```powershell
npx playwright test dev/tests/interface/dsh-supervisor.spec.js dev/tests/interface/dsh-agent-plugins.spec.js dev/tests/integration/dsh-runtime-contract.spec.js --reporter=list
npx playwright test dev/tests/electron/dsh-workbench.spec.js --reporter=list
```

最终验证结果：

- `npm test -- --reporter=list`：41 项全部通过。
- `npm run architecture:check`：通过，生产闭包为 69 个 active src 文件，22 个 legacy src 文件保持不可达。
- `npm run lint`：0 error；仓库其余旧模块仍有 25 个 `no-unused-vars` warning，本阶段修改文件没有新增 lint warning。
- Electron DSH 冒烟测试：通过，仍只有一个 BrowserWindow，现有官方嵌入回退路径可用。

## 8. 人工验收点

1. 接受当前工具安全策略为“隔离 preset + 最终工具面精确审计 + guard + read-only sandbox”，不再使用会遮蔽自定义工具的空 restriction。
2. 接受 Phase 1 的实时客户端按 WebSocket 实现，不按旧计划中的 SSE 实现。
3. 接受 rc.7 的取消前队列自动恢复限制，在 Phase 4 只暴露经过真实测试的行为。
4. 确认 Phase 0 后可以开始 [Phase 1 Main 语义网关](./phase-1-main-gateway.md)。
