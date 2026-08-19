# 重构实施状态

> 更新时间：2026-08-19。前端与接口 P1–P7、仓库运行/开发分层均已完成；Obsidian 尚未接入。

## 当前结果

- 产品入口仅支持 Electron；网页版不再作为产品入口。
- 后端保持四类八模块。
- 前端改为 `app/pages/dialogs/shared`，工作区按八个可见区域拆分。
- 原 5,900 行级 `public/js/app/bootstrap.js` 已收缩为不足 80 行的启动编排。
- 接口改为八个平级模块；contract、preload facade、IPC 目录一致。
- Sandbox preload 由十个源文件生成单一 `preload.cjs`，启动、测试和打包前校验。
- IPC 已接入 input schema；Renderer 不获得通用 invoke、ipcRenderer、密钥或内部路径。
- Agent 使用原生侧栏和 DSH Gateway，不嵌入完整 Web UI。
- Automation 已迁移到 Electron IPC；Renderer 零业务 `fetch`。
- 本地静态资源服务不再挂载任何 `/api/*` 业务路由；Automation 与 Agent session 分离。
- 生产 `src` 不可达文件与 Renderer 孤儿脚本均为 0；preload 只暴露八个平级模块，不再提供顶层兼容别名。
- 旧 `public/js/modules` 和分组式 contract/IPC 兼容目录已删除。
- `docs/tests/architecture/scripts` 已统一迁入 `dev/`；本地运行数据与私人维护资料位于仓库外的 `../workspace-local/cuigengji/`。
- 构建、测试结果位于同级 `../cuigengji-build/`，不会写回产品源码根目录。

## 仍保留的兼容实现

`src/legacy/http` 仍保存部分未从内部算法实现中抽出的旧代码。Automation 通过 `src/backend/intelligence/automation/adapters` 在进程内调用其中的实现，但不经过网络、也不向 Renderer 暴露路由。该兼容区只能缩小，不能新增业务。

## 最终验证

- `npm test -- --reporter=list`：59/59 通过。
- 架构门禁：11/11 通过；lint：0 error、0 warning；preload 与运行闭包新鲜度通过。
- 真实 DeepSeek：临时项目、单次短 turn、原生侧栏完整完成；密钥未进入脚本/日志，临时数据已清理。
- `npm run package:win`：通过，产物为 `../cuigengji-build/dist/win-unpacked/催更姬.exe`。
- 打包产物首页与 DSH Electron E2E：2/2 通过。

## 下一阶段

1. 单独设计 Obsidian Knowledge Source，不与 DSH Runtime 合并。
2. 将 Automation 的内部算法逐步从 `src/legacy/http` 下沉到正式后端能力目录。
3. 在保持 Electron 回归通过的前提下继续清除剩余兼容 Router。

当前权威目录见 [项目结构](../PROJECT_STRUCTURE.md)；前端/接口最终地图见 [frontend-interface-final-layout.md](./frontend-interface-final-layout.md)。
