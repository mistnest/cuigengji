# Phase P4 结果：Welcome、Settings、Dialogs 与 Shared

- 欢迎页、设置页和五类独立弹窗按所有权迁移。
- 公共 desktop、UI、格式化、安全和状态工具进入 `shared`。
- 原约 5,900 行单体 Renderer 被拆到 36 个所有权文件。
- `app/bootstrap.js` 收缩为不足 80 行，只保留初始化和启动失败处理。
