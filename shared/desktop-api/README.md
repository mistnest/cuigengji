# Desktop API contracts

正式业务接口固定为八个平级模块：

```text
app  project  knowledge  configuration
models  agent  automation  exchange
```

每个模块通过自己的 `index.js` 导出 channel、DTO 和运行时 input schema。`core` 仅提供版本、错误码和 schema 工具，不算业务模块；统一结果封装由可信 Main 进程的 `electron/ipc/core` 持有。

契约不得导出 Electron 对象、DSH 内部类型、密钥、绝对路径或通用 `invoke(channel)`。Sandbox preload 在 `electron/preload-src` 维护 facade，并生成单文件 `electron/preload.cjs`。
