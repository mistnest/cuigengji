# Renderer 目录约定

Renderer 只服务 Electron 界面，按用户看见的页面检索：

```text
app/       启动、应用上下文和跨页面用例
pages/     welcome、workspace、settings
dialogs/   独立生命周期弹窗
shared/    无小说领域语义的 UI/状态/格式化/安全工具
```

工作区继续按可见区域拆为 `chapters/editor/outline/worldbook/characters/agent/automation/status-bar`。页面通过 `window.DesktopApi` 使用八个正式接口模块，不得使用业务 `fetch`、浏览器存储、Node API、DSH 内部协议或绝对路径。

`app/bootstrap.js` 只能启动和装配。移动运行文件时必须同步 `public/index.html`、`dev/architecture/frontend-runtime-scripts.json` 和运行闭包门禁。
