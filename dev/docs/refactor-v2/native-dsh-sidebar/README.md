# DSH 原生 Agent 侧栏：阶段文档

> 状态：Phase 0—6 自动化验收完成；Phase 6 的人工耐久会话待产品验收  
> 总览：[10-native-dsh-agent-sidebar-plan.md](../10-native-dsh-agent-sidebar-plan.md)

本目录把 DSH 原生侧栏改造拆成七个可以独立实施、验收和回退的阶段。阶段编号代表依赖顺序，不允许跳过验收门槛直接合并后续阶段。

| 阶段 | 文档 | 主要产物 | 用户可见变化 |
|---|---|---|---|
| 0 | [协议实证与基线](./phase-0-protocol-baseline.md) / [结果](./phase-0-result.md) | 真实 DSH Contract Test、工具链与生命周期修复 | 完成 |
| 1 | [Main 语义网关](./phase-1-main-gateway.md) | RPC、WebSocket、事件映射、会话注册表 | 完成 |
| 2 | [Desktop API 契约](./phase-2-desktop-api.md) | 受控 IPC、preload API、事件订阅 | 完成 |
| 3 | [原生侧栏视觉壳](./phase-3-native-ui-shell.md) | 可审阅的窄栏界面和静态状态 | 完成 |
| 4 | [流式交互接管](./phase-4-streaming-takeover.md) | 真实对话、历史、queue/steer/cancel | 完成 |
| 5 | [移除 Web UI](./phase-5-remove-web-ui.md) | 删除 WebContentsView 与布局 IPC | 完成 |
| 6 | [稳定化与升级护栏](./phase-6-stabilization.md) / [结果](./phase-6-result.md) | Contract Suite、打包验证与升级流程 | 自动化完成 |

## 共同规则

每个阶段都遵守以下规则：

1. 只修改该阶段“允许修改”的文件范围；发现需要越界时先更新计划。
2. 阶段开始前记录基线，结束后给出命令、结果和已知限制。
3. 不用单元 mock 代替真实 DSH 请求验证；两类测试都要保留。
4. 不把 API Key、DSH 端口、绝对用户路径或原始异常栈发送给 Renderer。
5. 不接入 Obsidian，不让 DSH 直接访问 Vault。
6. 不恢复旧 Agent HTTP/SSE，不向 `src/legacy/http` 增加聊天能力。
7. 不在本计划中升级 DSH 大版本或重写整个 Renderer 技术栈。
8. 上一阶段的验收项没有全部通过时，下一阶段保持未开始。

## 阶段状态定义

- `待评审`：只有设计文档，没有实现授权。
- `进行中`：已获授权，正在实施，尚未通过全部门槛。
- `待验收`：实现和自动化检查完成，等待效果或行为确认。
- `完成`：自动化检查与人工评审均通过。
- `已回退`：阶段改动已整体撤销，产品回到上一阶段。

当前 Phase 0—5 已落地并通过自动化门禁；Phase 6 的自动化结果见 [phase-6-result.md](./phase-6-result.md)。发布前仍需完成文档中列出的人工耐久验收，不以未执行的人工项目冒充性能结论。

## 固定评审顺序

1. Phase 0 提交真实协议和工具权限报告。
2. Phase 1–2 提交无 UI 的端到端语义接口结果。
3. Phase 3 提交三种侧栏宽度的视觉效果供人工确认。
4. Phase 4 提交真实流式交互效果供人工确认。
5. Phase 5 删除旧视图路径前，再做一次回退确认。
6. Phase 6 完成后，DSH 接入才进入稳定维护状态。
