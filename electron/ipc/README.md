# Electron IPC 接口

IPC 固定为八个平级业务模块：

```text
app  project  knowledge  configuration
models  agent  automation  exchange
```

每个 `index.js` 是唯一注册入口。handler 只负责：

1. 验证调用来自主窗口 main frame；
2. 使用对应 contract schema 校验 payload；
3. 调用 `src/backend` 模块公开入口或受控 Electron Gateway；
4. 返回统一 result/error envelope。

`core` 是接口内核，不算业务模块。禁止恢复按后端分组复制的 `domains/foundation/intelligence/interchange` 旧 IPC 目录。
