# Phase 5：移除 DSH Web UI 生产路径

> 状态：待评审  
> 前置条件：[Phase 4](./phase-4-streaming-takeover.md) 原生侧栏已完成人工验收  
> 后续阶段：[Phase 6 稳定化](./phase-6-stabilization.md)

## 1. 阶段目标

结束双轨运行，彻底删除官方 DSH 页面在产品中的加载、嵌入、显隐和布局同步逻辑。完成后，主窗口只有催更姬 Renderer；DSH 是后台 Runtime/API，不再是第二套 GUI。

本阶段不更换 DSH Agent Loop，不迁移 session 数据，也不强制把 `dsh web` Host 重新组装成另一种进程。是否换成纯 Headless Host 留在 Phase 6 用数据评估。

## 2. 删除范围清单

### Electron Main

删除：

- `electron/intelligence/agent/dsh/dsh-view-host.js`
- Electron 入口中的 WebContentsView 创建、attach、detach、hide、destroy。
- window resize/move 时向 DSH 子视图同步 bounds 的逻辑。
- `registerAgentIpcHandlers` 的 `viewHost` 依赖。
- restart/stop 为隐藏视图添加的旁路操作。
- DSH 导航、新窗口、权限和同源限制中只服务该子视图的代码。

保留：

- 主 BrowserWindow 的安全配置。
- supervisor、Gateway、RPC、WebSocket、context/plugins。
- 应用退出时 Gateway stop 和 DSH child 清理。

### Shared contract 与 preload

删除：

```text
agent.openWorkbench
agent.setViewLayout
agent.hideView
```

其中 open 的业务含义已由 `agent.openProject` 取代，不留下两个同义入口。

### Renderer

删除：

- `syncLayout`、`scheduleLayout` 和 layout animation frame。
- host ResizeObserver -> Main 的调用。
- 标签隐藏/页面 hidden 时调用 `hideView`。
- `.is-ready` 只为露出底层 WebContents 的占位切换。
- “启动 DSH 网页工作台”相关文字和重试按钮逻辑。

保留：

- 原生侧栏 mount/unmount、事件订阅和 Runtime 重试。
- Agent 标签本身及与项目/章节上下文的连接。

### CSS/HTML

删除只为透明/覆盖嵌入页面存在的样式：

```text
.dsh-agent-host 的透明窗口占位行为
.dsh-agent-placeholder
.dsh-workbench-btn
WebContentsView 层级规避样式
```

将遗留 `dsh-*` 的可见产品类名改为语义中性的 `agent-*`；后台 adapter 文件仍保留 `dsh-*`，因为它确实属于 DSH。

## 3. 允许修改的文件

```text
electron/index.js
electron/ipc/intelligence/agent/agent.handlers.js
electron/intelligence/agent/dsh/dsh-view-host.js      # 删除
electron/intelligence/agent/dsh/README.md
electron/preload.cjs
shared/desktop-api/intelligence/agent/agent.contract.js
public/index.html
public/css/editor.css
public/js/modules/intelligence/agent/**
dev/tests/interface/dsh-view-host.spec.js                 # 删除或由新测试替换
dev/tests/interface/agent-ipc.spec.js
dev/tests/electron/dsh-workbench.spec.js                  # 改为原生侧栏 E2E
dev/tests/electron/app-smoke.spec.js
dev/architecture/**
dev/docs/**
```

不修改项目领域数据、Obsidian 边界或 Automation Runtime。

## 4. 实施顺序

### 4.1 先证明新入口是唯一生产入口

- 默认构建不再读取内部 legacy UI 开关。
- Electron E2E 断言 Agent 标签中存在 `.agent-sidebar`，不存在 DSH 页面导航。
- Main 启动后 Gateway 可工作，且没有创建 Agent WebContentsView。

完成这些断言后再删除旧文件，避免先删回退路径再发现新 UI 未进入打包闭包。

### 4.2 删除视图 IPC

按依赖方向删除：

1. Renderer 不再调用 openWorkbench/layout/hide。
2. preload 删除对应方法。
3. shared contract 删除频道。
4. Main handler 删除注册。
5. Electron 入口删除 viewHost 注入。

每一步运行 contract/architecture test，防止保留半截 API。

### 4.3 删除视图宿主

- 删除 `dsh-view-host.js` 和专属单元测试。
- 搜索 `WebContentsView`，确认 Agent 路径零引用。
- 搜索 `setViewLayout`、`hideView`、`openWorkbench`，确认生产闭包零引用。
- 搜索旧 DSH DOM ID/class，确认 HTML/CSS/JS 没有孤儿。

如果项目其他非 Agent 功能使用 WebContentsView，只能保留其自身代码，不能用全局禁词误删。

### 4.4 收紧 DSH Host 使用方式

即使进程当前仍由 `dsh web --port 0` 启动，也必须满足：

- runtime URL 只保存在 Main 私有对象。
- 没有 BrowserWindow/WebContents 导航到该 URL。
- Renderer、preload 返回值和日志不包含 URL。
- Host 只绑定 `127.0.0.1` 随机端口。
- Main 只调用固定 RPC allowlist 和固定 WebSocket path。
- 应用退出、项目切换和重启时连接与 child 都按策略释放。

这里把 Host 当本机进程传输层，而不是产品网页。

### 4.5 清理启动/退出顺序

建议退出顺序：

1. 标记应用 shutting down，拒绝新 prompt。
2. Renderer 事件派发停止。
3. Gateway 关闭 WebSocket 和重连 timer。
4. supervisor stop DSH child。
5. 销毁主 BrowserWindow/退出应用。

启动时不自动加载 DSH 页面；可以按现有产品策略在项目打开或 Agent 首次使用时启动 Runtime。

### 4.6 更新文档和运行闭包

必须修改所有仍声称“DSH 官方 GUI 是最终入口”的文档，至少包括：

```text
dev/docs/refactor-v2/README.md
dev/docs/refactor-v2/07-implementation-status.md
dev/docs/refactor-v2/08-dsh-handoff.md
dev/docs/PROJECT_STRUCTURE.md
electron/intelligence/agent/dsh/README.md
public/js/pages/workspace/agent/
```

历史决策可以保留，但要明确标为旧阶段，不得与当前状态冲突。

## 5. 架构检查

新增或更新静态规则：

- Agent Renderer 不出现 `WebContentsView`、runtime URL、DSH `/api/*`。
- preload 不出现通用 Agent channel 调用。
- Main 只有 RPC/WebSocket adapter 能访问 runtime endpoint。
- 生产运行闭包不含 `dsh-view-host.js`。
- HTML 不加载 DSH 静态资源。
- `src/legacy/http` 不能重新成为 Agent fallback。

## 6. 测试替换

旧测试与新测试映射：

| 旧测试关注点 | 新测试关注点 |
|---|---|
| WebContentsView 创建 | 原生 `.agent-sidebar` 存在 |
| DSH URL 加载 | Desktop API openProject ready |
| bounds 同步 | 360/419/520 响应式布局 |
| tab hide/show 子视图 | tab 切换保持 store/history |
| 子视图导航限制 | Renderer 不知道 URL + RPC allowlist |
| 子视图销毁 | event listener/WebSocket/child 正确清理 |

不能简单删除覆盖率而不建立等价的新边界测试。

## 7. 冒烟场景

### 启动与项目

- 无项目启动：DSH 不必启动，Agent 显示选择项目。
- 打开项目：编辑器先可用，Agent 可独立进入 starting/ready。
- 无 Key：编辑器可用，Agent 提示设置，不创建失控重启循环。

### 交互

- 正常发送、工具、cancel、历史恢复。
- Agent 标签隐藏/显示，无页面 reload、无 bounds IPC。
- 窗口最大化、恢复、侧栏拖动，无 DSH 子视图错位。

### 故障与退出

- Runtime crash，正文仍可保存。
- Main restart Agent 后原生 UI 恢复。
- 退出应用后无 DSH child、WebSocket 和 timer 残留。
- 连续启动/退出至少 10 次无端口占用累积。

## 8. 阶段产物

- 删除 WebContentsView Agent 宿主及三项视图 IPC。
- 原生侧栏成为唯一生产 Agent UI。
- 更新后的 Electron 启停链和生产运行闭包。
- 替代旧嵌入测试的新 E2E/架构测试。
- 与真实现状一致的交接文档。

## 9. 验收清单

- [ ] Agent 生产代码不创建任何 WebContentsView。
- [ ] 应用不加载 DSH HTML、JS、CSS 或字体资源。
- [ ] `openWorkbench`、`setViewLayout`、`hideView` 零生产引用。
- [ ] Renderer 和 preload 无 runtime URL 与 DSH 原始 API。
- [ ] 标签切换、拖宽度、最大化不产生 Agent 视图错位或 reload。
- [ ] 原生对话、工具、取消、历史和错误恢复 E2E 通过。
- [ ] 应用退出无 DSH 子进程和连接残留。
- [ ] 架构检查、单测、lint、Electron smoke 全部通过。
- [ ] 当前文档不再把官方 GUI 描述成最终入口。

## 10. 回退方法

这是删除阶段，回退必须整体恢复该阶段提交：视图宿主、旧频道、preload 方法和 Renderer 回退逻辑一起恢复。禁止只恢复 `dsh-view-host.js` 而缺失布局 IPC，也禁止在生产中长期保留两套入口。

DSH session/runtime 数据未迁移，因此回退不需要转换用户数据。

## 11. 进入下一阶段的条件

旧 Web UI 生产路径零引用，完整自动化检查通过，并经过一次实际 Electron 安装/启动/退出验收。之后进入长期稳定化，而不是继续新增侧栏功能。
