# Agent 后端领域

该模块只负责与具体 Runtime 无关的 Agent 数据能力：

- `context/`：把项目、章节、大纲、世界书、角色卡和作者预设规范化为唯一的 `cuigenji-canonical-v1` 热快照与只读资料目录；其中包含当前大纲 revision，供无副作用提案绑定版本。
- `sessions/`：催更姬自身的通用会话数据服务；不拥有 DSH 进程。
- `runtime/dsh/`：仅保留边界说明，实际 Electron Runtime 适配器位于 `electron/intelligence/agent/dsh`。

依赖方向为 `DSH Gateway -> Agent Context -> Project/Knowledge`。Project/Knowledge 不反向依赖 DSH。提案的实际应用由 Project Outline 领域的原子命令负责，不由 Agent Runtime 写文件。Obsidian 后续作为独立 Knowledge Source 接入，不写进 DSH 模块。

外部格式兼容属于 `interchange/exchange`。酒馆 marker、宏插槽和注入顺序不属于 Agent Context；导入后的预设只提供作者规范与验收规则，世界书和人物卡只提供项目事实。Electron 侧的 Agent 功能清单统一由 `electron/intelligence/agent/dsh/dsh-plugin-bundle.js` 组合。
