# 前端与接口最终模块地图

> 代码事实基线：2026-08-18，P7。

## 前端：按可见页面检索

```text
public/js/
├─ app/
│  ├─ bootstrap.js                 # 启动与装配
│  ├─ app-context.js               # 跨页面协调状态
│  └─ composition/                 # 打开项目、保存工作区、全局事件
├─ pages/
│  ├─ welcome/                     # 欢迎页与项目列表
│  ├─ workspace/
│  │  ├─ chapters/                 # 卷章树、创建、排序
│  │  ├─ editor/                   # 正文、标题、保存、格式化
│  │  ├─ outline/                  # 大纲树
│  │  ├─ worldbook/                # 世界书与引用选择
│  │  ├─ characters/               # 角色卡列表与编辑器
│  │  ├─ agent/                    # DSH 原生侧栏
│  │  ├─ automation/               # 续写、灵感、提取、Job
│  │  └─ status-bar/               # 字数、保存和连接状态
│  └─ settings/                    # 一般、模型、Prompt、预设
├─ dialogs/                        # 导入导出、Prompt、正则、联系作者
└─ shared/                         # desktop/ui/state/formatting/security
```

`bootstrap.js` 不持有页面业务；具体功能先按页面，再按工作区可见区域定位。
提取结果是 Automation 区域内部的覆盖层，不再保留独立空壳 dialog 模块。

## 接口：按业务能力检索

| 模块 | Facade | IPC | 后端目标 |
| --- | --- | --- | --- |
| app | `DesktopApi.app` | `electron/ipc/app` | `foundation/platform` |
| project | `DesktopApi.project` | `electron/ipc/project` | `domains/project` |
| knowledge | `DesktopApi.knowledge` | `electron/ipc/knowledge` | `domains/knowledge` |
| configuration | `DesktopApi.configuration` | `electron/ipc/configuration` | `foundation/configuration` |
| models | `DesktopApi.models` | `electron/ipc/models` | `intelligence/models` |
| agent | `DesktopApi.agent` | `electron/ipc/agent` | `intelligence/agent` + DSH Gateway |
| automation | `DesktopApi.automation` | `electron/ipc/automation` | `intelligence/automation` |
| exchange | `DesktopApi.exchange` | `electron/ipc/exchange` | `interchange/exchange` |

每个模块在 `shared/desktop-api/<module>` 维护 channel、DTO、schema；在 `electron/preload-src/<module>.cjs` 维护 Renderer facade；在 `electron/ipc/<module>` 持有 handler。

## 重要边界

- Agent 管交互会话、历史、流式事件和 DSH 生命周期。
- Automation 管一次性写作/灵感/提取任务及 Job，不复用 Agent session。
- Knowledge 管当前 JSON 世界书/角色卡；未来 Obsidian 作为独立 source adapter 接入。
- Renderer 只能消费 facade，不得直接引用 contract channel、IPC、后端或 DSH。
- `core` 是协议内核，不是第九个业务模块。

## 检索顺序

1. 先从 `public/index.html` 找到用户看到的页面区域。
2. 进入 `public/js/pages/<page>/<area>` 查 UI 行为。
3. 根据 facade 名进入 `shared/desktop-api/<module>` 查输入输出。
4. 进入 `electron/ipc/<module>` 查边界校验和后端映射。
5. 最后进入 `src/backend/<group>/<module>` 查业务实现。
