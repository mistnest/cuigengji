# Phase P6 结果：Automation 正式接口

- 建立 writing、ideas、extraction、jobs、summary、cancel 正式 contract 和 facade。
- Renderer Automation 由 HTTP adapter 改为 Electron IPC adapter，业务 `fetch` 清零。
- `/api/ai`、`/api/chat`、`/api/debug` 不再挂载并由集成测试锁定 404。
- Automation 具有独立 operationId、取消控制器和错误封装，不依赖 Agent session。
- 内部旧算法暂由正式后端 adapter 进程内调用，不经过网络。
