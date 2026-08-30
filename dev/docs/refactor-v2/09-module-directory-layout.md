# 四类八模块目录基线

> 状态：后端四类八模块基线已落地。前端和接口已采用各自更适合检索的分类，见 [frontend-interface-final-layout.md](./frontend-interface-final-layout.md)。  
> 基线日期：2026-08-18。

## 1. 分类与模块

正式业务目录统一为四个分类、八个模块：

```text
domains
  project
  knowledge

intelligence
  agent
  models
  automation

interchange
  exchange

foundation
  configuration
  platform
```

`domains` 保存小说业务数据，`intelligence` 保存 AI/自动化能力，`interchange` 处理外部格式，`foundation` 提供配置和系统基础设施。

## 2. 层级规则

从业务根目录以下计算：

```text
第 1 级：分类
第 2 级：正式模块
第 3 级：模块能力
第 4 级：外部适配器或具体实现
```

普通功能停在第三级；DSH、Obsidian、Provider、格式解析器等允许达到第四级。不得继续建立第五级目录。

```text
intelligence/agent/runtime/dsh
domains/knowledge/sources/obsidian
```

实际 DSH Electron 适配器位于 `electron/intelligence/agent/dsh`；`dsh` 与 `obsidian` 是两条独立路径，禁止直接互相依赖。

## 3. 后端

```text
src/backend/
├─ domains/
│  ├─ project/
│  │  ├─ lifecycle/
│  │  ├─ chapters/
│  │  ├─ outlines/
│  │  └─ migrations/
│  └─ knowledge/
│     ├─ references/
│     ├─ summaries/
│     ├─ worldbooks/
│     └─ sources/{json,obsidian}/
├─ intelligence/
│  ├─ agent/{context,sessions,runtime}/
│  ├─ models/providers/
│  └─ automation/
├─ interchange/
│  └─ exchange/{importers,exporters}/
└─ foundation/
   ├─ configuration/{preferences,presets,secret-references}/
   └─ platform/{storage,paths,security,diagnostics,events,identity,runtime}/
```

每个正式模块必须有：

```text
index.js       唯一公开入口
module.json    ID、分类、允许依赖和数据所有权
MODULE.md      Review 导航、职责和非职责
```

跨模块只能导入对方 `index.js`，架构测试会拒绝深层导入和未声明依赖。

允许依赖：

| 模块 | 允许依赖 |
| --- | --- |
| platform | 无 |
| configuration | platform |
| knowledge | platform |
| project | knowledge、configuration、platform |
| models | configuration、platform |
| agent | project、knowledge、models、configuration、platform |
| automation | project、knowledge、agent、models、platform |
| exchange | project、knowledge、configuration、platform |

`project → knowledge/configuration` 当前只用于旧 `workspace.json` 迁移协调；workspace 淘汰后应移除这两项依赖。

## 4. Desktop API 与 IPC

契约和 Handler 使用八个平级业务模块：

```text
shared/desktop-api/{app,project,knowledge,configuration,models,agent,automation,exchange}/
electron/ipc/{app,project,knowledge,configuration,models,agent,automation,exchange}/
```

模块内可以保留多个能力文件。例如 `project` 包含 projects、chapters、outlines、workspaces 四组契约，但它们只通过模块 `index.js` 导出。`electron/ipc/core` 和 `shared/desktop-api/core` 是跨模块协议内核，不计入八个业务模块。

## 5. Renderer

```text
public/js/
├─ app/                         # 启动与跨页面组合
├─ pages/{welcome,workspace,settings}/
├─ dialogs/
└─ shared/
```

前端按用户看到的页面定位：章节 UI 在 `pages/workspace/chapters`，Agent UI 在 `pages/workspace/agent`，Provider 设置在 `pages/settings/model-settings.js`。

## 6. DSH 与 Obsidian

```text
Obsidian
  → knowledge/sources/obsidian
  → KnowledgeSnapshot
  → agent/context
  → AgentContextSnapshot
  → agent/runtime/dsh
```

- 当前阶段只继续 DSH，Obsidian 目录只保留边界说明。
- DSH 不读取项目 JSON 或 Obsidian Vault。
- Obsidian 不依赖 Agent、模型或 DSH。
- 更换任一适配器不得修改另一侧代码。
- DSH supervisor 只管理生命周期；Agent 功能由 `electron/intelligence/agent/dsh/dsh-plugin-bundle.js` 组合，项目写作数据只能通过一个版本化上下文插件进入 Prompt。

## 7. 兼容区

旧 HTTP/SSE Router 与 Agent 服务统一隔离在：

```text
src/legacy/http/
```

它不是正式模块，禁止新增功能。DSH 已接管 Agent；Automation 的旧 HTTP 路由已经关闭，正式后端 adapter 仅在进程内复用尚未抽出的算法实现。该兼容区后续只能缩小。
