# Agent 后端领域

该模块只负责与具体 Runtime 无关的 Agent 数据能力：

- `context/`：把项目、章节、大纲与当前 JSON 世界书/角色卡构造成受限热快照和只读资料目录。
- `sessions/`：催更姬自身的通用会话数据服务；不拥有 DSH 进程。
- `runtime/dsh/`：仅保留边界说明，实际 Electron Runtime 适配器位于 `electron/intelligence/agent/dsh`。

依赖方向为 `DSH Gateway -> Agent Context -> Project/Knowledge`。Project/Knowledge 不反向依赖 DSH。Obsidian 后续作为独立 Knowledge Source 接入，不写进 DSH 模块。
