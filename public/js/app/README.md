# App composition

`bootstrap.js` 是当前 Renderer 组合入口，负责连接各功能模块并启动界面。它仍包含尚未完成物理提取的旧 UI 协调代码；维护时应把功能下沉到 `modules/<category>/<module>`，这里只保留启动、模块装配和跨模块用例编排。
