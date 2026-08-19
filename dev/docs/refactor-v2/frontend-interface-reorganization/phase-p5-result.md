# Phase P5 结果：八个 IPC 模块归位

- app/project/knowledge/configuration/models/agent/exchange handler 由平级目录实际持有。
- 测试和 Electron Main 均只导入新的模块公开入口。
- knowledge、models、agent、exchange 补齐运行时 schema。
- 分组式 IPC 目录不再是实现所有者。
