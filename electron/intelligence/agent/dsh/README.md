# DSH Main 适配器

本目录是 DeepSeek Harness 的唯一 Electron 适配层。DSH 作为私有 loopback API Host 运行，不加载官方 Web UI，也不创建额外的 `WebContents`。

## 子模块

- `dsh-supervisor.js`：生成 overlay 和上下文快照，启动、复用、重启、停止固定版本的 DSH 子进程。
- `dsh-provider-config.js`：把项目当前选择的模型服务映射到 DSH 路由；密钥只通过子进程环境引用传递，不写入 overlay。
- `dsh-rpc-client.js`：只允许 workspace/session 所需的固定 RPC 白名单。
- `dsh-event-stream.js`：仅在 Main 中连接 `events.mux` WebSocket，并负责重连。
- `dsh-event-mapper.js`：把 DSH 原始事件清洗为稳定的 Agent UI 事件，禁止暴露工具参数、结果、路径和 runtime URL。
- `dsh-session-registry.js`：维护 project/workspace/session/generation 关系与事件去重。
- `dsh-gateway.js`：对 IPC 暴露 open/session/history/prompt/cancel/context/restart/stop 语义操作。
- `dsh-plugin-bundle.js`：Agent 能力的唯一插件目录；supervisor 只管理进程与配置，不再硬编码功能清单。
- `plugins/cuigenji-writing-context.mjs`：Agent 唯一 Prompt 注入边界，读取催更姬规范化后的预设、项目热上下文和资料索引。
- `plugins/`：除此之外只提供只读资料工具、安全网页读取、大纲提案、工具权限审计和小说会话压缩，不重复注入世界书、人物卡或作者预设。
- `skills/`：六个仅由应用随包提供的网文创作 Skill；运行时复制到项目私有 preset，不扫描用户或项目目录。

打包时应用源码仍在 `app.asar`；DSH 依赖树放在 `app.asar.unpacked/node_modules`，supervisor 会让 DSH bin 与自定义插件使用同一份物理模块实例。这是 Windows 子进程从用户运行目录加载 profile 时的必要边界，不代表 Renderer 可以访问这些模块。

## 边界

Renderer 只能通过 `shared/desktop-api/agent` 调用语义 IPC，不得知道 DSH 端口、RPC 路由或原始事件。基础工具面精确限制为 `search_project_knowledge`、`get_project_knowledge`、`skill`、`safe_web_fetch` 和 `propose_outline_patch`；只有官方 DeepSeek 端点且存在密钥时才额外允许 `web_search`。官方裸 `web_fetch`、文件系统、Shell、子 Agent 和项目写入工具均不开放，未知工具出现时运行时失败关闭。

世界书、人物卡和外部预设格式可以导入，但导入后都先规范化为 `cuigenji-canonical-v1`。酒馆 marker、宏插槽、前后置注入位置和“全文/摘要”切换不进入运行态；Automation 与 DSH Agent 都只消费催更姬的统一写作上下文。未来任何 subagent 审阅能力也必须是独立、默认关闭的插件，不能回到 supervisor 或另造一套上下文拼装器。

Agent 复用项目设置页当前选择的供应商、端点和模型。DeepSeek 使用官方专用适配器；Anthropic、Google AI Studio、Google Vertex Express、OpenRouter 使用 DSH 的原生 pi-ai 路由；OpenAI、Mistral、xAI、Groq、Qwen、Doubao、Spark、Z.AI、Moonshot、SiliconFlow、MiniMax、Ollama 和自定义 OpenAI API 使用 pi-ai 的明确或兼容路由。Ollama 不要求用户填写密钥，适配层只在子进程内提供兼容传输所需的固定占位凭据。Google Vertex Service Account 模式尚未接入 Agent；选择该模式时 Agent 明确失败，不会回退到错误供应商。非 DeepSeek 密钥绝不用于 DeepSeek 官方搜索。

`propose_outline_patch` 只产生供 Renderer 展示的结构化提案，没有写权限。用户点击现有 Agent 侧栏中的“应用”后，Renderer 才经 `DesktopApi.project.outlines.applyPatch` 调用领域层的原子命令；revision 冲突、非法操作或未确认删除都不会写入项目。

Obsidian 不属于本适配器。未来 Vault 数据只能经独立 Knowledge Source 转成只读快照，再由 Agent Context 消费。
## Current provider note

The DSH bridge supports Google Vertex AI Express API keys through the native
`google-vertex` pi-ai route. Configure `vertexAuthMode=express`, a Google Cloud
Project ID, and a Region (the verified default is `global`). Service-account
JSON remains intentionally outside the DSH bridge until its credential lifecycle
is implemented end to end.
