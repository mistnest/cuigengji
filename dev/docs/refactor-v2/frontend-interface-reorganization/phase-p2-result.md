# Phase P2 结果：Contract、Preload 与 Schema

- 八个 contract 模块持有自己的 channel、DTO 和 input schema。
- Sandbox preload 拆为十个维护源并生成单文件 `electron/preload.cjs`。
- 新 facade 与旧调用别名并存；Renderer 不获得通用 invoke。
- IPC guard 统一执行主窗口校验、schema 解析和结果封装。
