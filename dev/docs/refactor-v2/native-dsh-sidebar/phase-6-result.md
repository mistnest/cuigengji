# Phase 6 结果：稳定化、打包与升级护栏

> 状态：自动化验收完成；30 分钟人工耐久会话待产品验收
> 实施日期：2026-08-18
> 固定依赖：`@deepseek-ai/dsh@0.1.0-rc.7`
> 对应计划：[phase-6-stabilization.md](./phase-6-stabilization.md)

## 1. 收口结论

Phase 0—5 的原生 DSH 侧栏链路已经完成 Phase 6 的自动化收口：Electron 只有一个主窗口和一个 Renderer，DSH 在 Main 进程监督下作为私有 loopback API Host 运行，Renderer 不加载 DSH 页面，也不接触 DSH 端口、RPC、WebSocket 或原始事件。

本阶段没有接入 Obsidian，也没有改变世界书/角色卡的 JSON 数据权威位置。后续 Obsidian 必须作为独立 Knowledge Source 立项。

## 2. 本阶段实际修复

### 2.1 打包版 DSH 模块解析

开发版使用 Node 模块目录时正常，但 `asar` 中的 DSH 子进程会从项目运行目录加载 profile 插件；Windows junction 不能把外部 profile 解析到 `app.asar` 虚拟路径，导致打包版缺少 DSH peer/dev 模块或出现 scope 单例不一致。

当前方案：

- 保留 `asar: true`，应用源码继续封装在 `app.asar`。
- `asarUnpack: ["node_modules/**"]`，将 DSH 所需依赖放到物理的 `app.asar.unpacked/node_modules`，避免子进程跨越虚拟文件边界。
- `dsh-supervisor` 在打包环境把 DSH bin 和自定义插件引用统一解析到 unpacked 依赖；开发环境仍使用普通 `node_modules`。
- 将自定义插件实际使用的 `dsh-compaction-basic`、`dsh-llm`、`dsh-scope`、`dsh-tools` 声明为精确版本的直接依赖，避免 electron-builder 只按生产依赖图裁剪后漏包。

这同时解决了 `dsh-scope` 双实例导致的 preset scope 校验失败。最终 DSH preset 能创建 session，工具权限和 compaction 行为与开发版一致。

### 2.2 打包数据目录

`src/server.js` 在打包环境不再尝试写入 `app.asar/src/server.js` 下的 `data`。默认数据根目录改为平台用户数据目录下的 `cuigengji/data`，测试和部署仍可用 `CUIGENGJI_DATA_ROOT` 显式覆盖。

## 3. 自动化验证结果

### 3.1 全量测试

在清理 `ELECTRON_RUN_AS_NODE` 临时诊断环境变量后，从干净进程状态运行：

```powershell
npm.cmd test -- --reporter=list
```

结果：`51 passed`（约 37.8 秒），包含：

- 7 项架构/运行闭包门禁。
- Electron smoke 与原生 DSH 侧栏 E2E。
- DSH Gateway、真实 runtime contract、工具权限与 compaction。
- IPC/preload/security/store 和旧 HTTP baseline 回归。

### 3.2 打包版完整流程

打包命令：

```powershell
$env:HTTP_PROXY='http://127.0.0.1:7890'
$env:HTTPS_PROXY='http://127.0.0.1:7890'
npm.cmd run package:win
```

打包结果：`../cuigengji-build/dist/win-unpacked` 生成成功，`app.asar` 保留，依赖位于 `resources/app.asar.unpacked`。

使用打包可执行文件运行同一原生 E2E：

```powershell
$env:ELECTRON_RUN_AS_NODE=$null
$env:CUIGENGJI_PACKAGED_EXECUTABLE=(Resolve-Path '..\cuigengji-build\dist\win-unpacked\催更姬.exe').Path
npx.cmd playwright test dev/tests/electron/dsh-workbench.spec.js --reporter=list
```

结果：`1 passed`。该流程实际覆盖：创建项目、章节、世界书和角色卡，保存 DeepSeek 配置，重启 DSH，读取历史，工具调用，推理与最终文本流，取消慢请求，单窗口/单 Renderer 拓扑，热上下文文件生成和密钥不落日志。

### 3.3 静态质量

```powershell
npm.cmd run architecture:check
npm.cmd run lint
```

- 架构运行闭包检查通过：69 个 active src 文件，22 个 legacy src 文件保持不可达。
- ESLint：0 error；剩余 warning 为迁移前旧模块的既有 `no-unused-vars`，本阶段没有新增 error。

## 4. 安全与隐私结果

- Renderer 只收到稳定的 Desktop API 结果和 `AgentUiEvent`，没有 DSH URL、RPC body、工具参数/结果、绝对路径或 Authorization。
- E2E 只使用本地 mock Provider 和测试密钥；测试结束会删除临时数据根目录。
- DSH supervisor 的诊断详情由 `CUIGENGJI_DSH_DIAGNOSTICS=1` 显式开启，且只保留脱敏、截断后的错误片段；默认关闭。
- 本轮没有把用户提供的真实 API key 写入仓库、测试快照、报告或日志，也没有提交任何密钥文件。

## 5. 当前契约与升级护栏

| 层 | 当前固定项 | 升级触发的审阅范围 |
|---|---|---|
| DSH Wire | RPC allowlist、`events.mux` envelope、事件 mapper | `electron/intelligence/agent/dsh` |
| Gateway | project/session/history/prompt/cancel/context/restart/stop DTO | Main IPC contract 与 gateway tests |
| Desktop/UI | `DesktopApi.agent`、`AgentUiEvent`、store projection | preload、Renderer store/workbench、UI tests |

DSH 版本必须继续使用精确版本。升级时先改独立分支和 lockfile，再依次通过 Wire、Gateway、Interface、Electron packaged E2E；工具集合扩大、历史丢失、cancel 失效或需要向 Renderer 暴露内部字段时，立即回退到上一精确版本。

当前保留 `dsh web --port 0` 作为 API Host 入口，是因为它是 rc.7 中已经实证的 Host 组合；产品不加载 Web UI。切换真正 headless 组合需要另做隔离 spike，不能在本阶段凭偏好替换。

## 6. 性能与人工验收边界

本阶段确认了拓扑和可运行性，但没有伪造跨机器性能承诺。当前打包目录样本约为 `app.asar 13.7 MB + app.asar.unpacked 204.6 MB`；这是依赖物理化换取打包子进程稳定性的成本。

仍需产品人工验收的项目：

1. 至少一次 30 分钟真实写作会话（长回复、停止、继续、切章节、恢复历史）。
2. 无 Key、错误 Key、网络中断/恢复和 Runtime 重启时的用户提示。
3. 退出仍有运行 turn 时无残留 DSH 子进程和 loopback 端口。
4. 人工查看诊断导出不含正文、reasoning 或密钥。

这些是发布前的人工门槛，不影响当前自动化流程已能完整跑通的结论。

## 7. 回退

- DSH 上游回退：恢复 `package.json`、`package-lock.json` 的上一精确版本，并保留失败 contract 报告。
- 打包模块解析回退：保留 `asar: true`，撤销 `resolveModuleFile` 与 direct peer dependencies 前，必须先确认开发版和 packaged E2E 均通过。
- UI 回退：只回到 Phase 5 的原生侧栏，不恢复 WebContentsView、完整 DSH GUI 或旧 Agent HTTP/SSE。

## 8. 交接结论

本轮 DSH 接管可进入稳定维护；前端/接口的现状地图见 [frontend-interface-final-layout.md](../frontend-interface-final-layout.md)。Obsidian 仍是下一轮独立模块，不属于 DSH Runtime、Agent Gateway 或本阶段目录。
