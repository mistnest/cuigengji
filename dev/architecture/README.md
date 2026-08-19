# Architecture baselines

本目录保存可由测试读取的架构事实，不包含运行时代码。

| 文件 | 职责 | 当前阶段 |
| --- | --- | --- |
| `runtime-closure.json` | 当前生产入口可达文件闭包 | 已启用 |
| `frontend-pages.json` | 页面式 Renderer 目标、工作区区域及允许的接口模块 | P0 基线，P1 起逐步启用 |
| `interface-modules.json` | 八个展平接口模块、当前兼容路径和目标路径 | P0 基线，P1 起逐步启用 |
| `frontend-bootstrap-ownership.json` | `bootstrap.js` 228 个顶层函数的唯一迁移归属 | P0 已启用 |

后端模块事实仍由 `src/backend/**/module.json` 持有。Frontend/Interface 迁移期间，当前兼容路径和目标路径会短暂并存；每个 Phase 必须更新目录状态和架构测试，禁止长期维持双轨实现。
