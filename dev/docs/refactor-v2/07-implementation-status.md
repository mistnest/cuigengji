# 重构实施状态

> 更新时间：2026-08-30。前端与接口 P1–P7、仓库运行/开发分层、网文开发助手 v0.1 Phase 0–6、Agent 多供应商桥接和协作版本内核均已完成；Obsidian 尚未接入。

## 当前结果

- 产品入口仅支持 Electron；网页版不再作为产品入口。
- 后端保持四类八模块。
- 前端改为 `app/pages/dialogs/shared`，工作区按八个可见区域拆分。
- 原 5,900 行级 `public/js/app/bootstrap.js` 已收缩为不足 80 行的启动编排。
- 接口改为八个平级模块；contract、preload facade、IPC 目录一致。
- Sandbox preload 由十个源文件生成单一 `preload.cjs`，启动、测试和打包前校验。
- IPC 已接入 input schema；Renderer 不获得通用 invoke、ipcRenderer、密钥或内部路径。
- Agent 使用原生侧栏和 DSH Gateway，不嵌入完整 Web UI。
- Agent 已接入六个隔离的 bundled Skill、条件式官方 DeepSeek Web Search、SSRF 防护的 Safe Web Fetch、轻量工具回执和安全来源链接。
- Agent 复用现有 AI 设置入口，已桥接 DeepSeek、pi-ai 原生供应商和前端已有的 OpenAI 兼容供应商；模型 ID 可在推荐列表之外手工输入，不增加第二套模型 UI。Google Vertex 的复合凭证模式暂不进入 Agent，Ollama 保持无密钥体验。
- 大纲修改采用“无副作用提案卡片 + 用户明确应用 + Project Outline 原子 patch”；revision 冲突、非法操作和未确认删除不会产生部分写入。
- Automation 已迁移到 Electron IPC；Renderer 零业务 `fetch`。
- 本地静态资源服务不再挂载任何 `/api/*` 业务路由；Automation 与 Agent session 分离。
- 生产 `src` 不可达文件与 Renderer 孤儿脚本均为 0；preload 只暴露八个平级模块，不再提供顶层兼容别名。
- 旧 `public/js/modules` 和分组式 contract/IPC 兼容目录已删除。
- `docs/tests/architecture/scripts` 已统一迁入 `dev/`；本地运行数据与私人维护资料位于仓库外的 `../workspace-local/cuigengji/`。
- 构建、测试结果位于同级 `../cuigengji-build/`，不会写回产品源码根目录。

## 仍保留的兼容实现

`src/legacy/http` 仍保存部分未从内部算法实现中抽出的旧代码。Automation 通过 `src/backend/intelligence/automation/adapters` 在进程内调用其中的实现，但不经过网络、也不向 Renderer 暴露路由。该兼容区只能缩小，不能新增业务。

## 最终验证

- `npm test -- --reporter=list`：89/89 通过。
- `npm run typecheck`、`npm run ts:check-generated`、`npm run build:preload`、`npm run architecture:check` 和 `npm run lint -- --quiet` 均通过；TypeScript 当前采用可回滚的增量迁移。
- 项目/工作区/章节/大纲/世界书/角色卡写入统一携带 `revision`、`updatedAt`、`contentHash`，并通过 `DomainEventBus` 广播；DSH 运行会在外部变更后失效并刷新其项目快照。
- Renderer 维护工作区级脏标记和稳定基线指纹，覆盖延迟自动保存及弹窗编辑；外部变更重载前会明确确认，并使旧保存回调失效。
- Agent 上下文对冷资料做敏感字段剔除和大小/深度限制，快照期间持续变更会拒绝为 `AGENT_CONTEXT_STALE`，避免把半新半旧的数据交给模型。
- 架构门禁：11/11 通过；lint：0 error、0 warning；preload 与运行闭包新鲜度通过。
- 真实 DSH rc.7 preset：精确工具面、Skill catalog、热上下文、提案工具和多供应商路由加载通过；测试密钥未进入 Renderer、overlay 或日志。
- 真实 DeepSeek 官方 API 已完成模型列表、最小对话和“Electron 加密密钥 → DSH → Agent 侧栏回复”链路验证；OpenAI 兼容供应商已通过真实 DSH 子进程与本地协议 Provider 验证。除 DeepSeek 外的各商业供应商尚未使用真实账户逐一计费验证。
- Windows 目录包通过本地 Electron runtime 生成，当前候选产物为 `../cuigengji-build/dist/win-unpacked/催更姬.exe`。
- 开发版 Electron E2E：2/2 通过；打包版 DSH Electron E2E：1/1 通过，覆盖资料工具、来源链接、提案应用、上下文刷新和取消。
- 产品 Safe Web Fetch 已真实访问 `https://example.com/`，DNS、TLS、正文转换链路返回 200；尚未执行需要真实 DeepSeek 官方密钥的 Web Search 与 30 分钟创作会话，这两项保留为人工产品验收，不以 mock 测试冒充真实外部验证。

## 交付前体验测试（2026-08-30）

- 以真实 Electron 窗口和 mock DeepSeek Provider 完成一次用户旅程：创建项目、查询项目资料、查看工具回执、形成并应用大纲提案、确认大纲版本变化、取消生成、新建干净会话。
- 设置页旅程覆盖供应商选择、端点填写、任意模型 ID 输入、密钥加密保存和连接成功后 Agent 自动按新配置重启；修复了首次启动尚未结束时强制刷新被吞掉、侧栏继续误报“缺少密钥”的竞态。
- 提案卡片在现有 Agent 侧栏中可读、可操作，没有引入第二套任务面板；应用后按钮与会话回执同步显示“已应用”。
- 修复 Safe Web Fetch 回执泄露最终 URL 查询参数的问题；显示地址现在只保留协议、主机和路径。
- 修复伪造工具结果可被误识别为大纲提案的问题；只有绑定到 `propose_outline_patch` 调用的结果才能生成提案卡。
- 修复 Agent 使用后退出 Electron 可能长期等待内嵌 HTTP 连接的问题，并让两条桌面验收使用隔离的用户数据目录。
- 使用产品自己的 Safe Web Fetch 完成一次真实公网访问，返回 HTML 标题和可读正文；未把单元测试代替公网链路。
- 修复后全量 Playwright 为 89/89；其中新增协作版本/事件回放、上下文一致性、RPC 端点安全、多供应商 DSH 运行时和设置页到 Agent 的桌面链路覆盖；当前交付包 `dist` 的原生 Agent E2E 为 1/1。

## 下一阶段

1. 按[网文开发助手 v0.1 产品基线与实施计划](../web-fiction-development-assistant-v0.1.md)完成真实长会话、官方 Web Search 和故障场景的人工验收。
2. 根据实际创作使用反馈调整 Persona、Skill 内容和回执文案，不扩大工具权限或记忆边界。
3. 单独设计 Obsidian Knowledge Source，不与 DSH Runtime 合并。
4. 将 Automation 的内部算法逐步从 `src/legacy/http` 下沉到正式后端能力目录。
5. 在保持 Electron 回归通过的前提下继续清除剩余兼容 Router。

当前权威目录见 [项目结构](../PROJECT_STRUCTURE.md)；前端/接口最终地图见 [frontend-interface-final-layout.md](./frontend-interface-final-layout.md)。
