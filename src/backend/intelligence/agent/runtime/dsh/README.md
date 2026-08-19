# DSH 运行时边界

后端领域层不包含 DSH 生命周期或传输实现。Electron 专属实现统一位于：

`electron/intelligence/agent/dsh/`

本目录只用于声明依赖方向，避免把 Electron child process、loopback RPC 或 WebSocket 混入可复用的后端领域代码。
