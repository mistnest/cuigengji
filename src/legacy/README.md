# Legacy compatibility area

`http/` 仅保存 Automation 模块暂时进程内复用的旧 Router 算法与服务。它不是对外 HTTP API，也不是正式后端模块；新代码必须进入 `src/backend` 的四类八模块。

Renderer 和静态资源服务器均不得挂载这里的路由。Automation 完成原生 service 改造后，应删除整个 `legacy/http`。
