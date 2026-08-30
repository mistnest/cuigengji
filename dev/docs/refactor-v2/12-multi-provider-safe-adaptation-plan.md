# 多模型厂商安全适配计划（酒馆式配置体验）

> 状态：安全最小集已实现；完整 Provider Registry、draft/active 事务和逐厂商真实验收仍按本计划推进
> 目标：用户在一个现有设置入口中选择模型厂商、输入自己的 API Key、选择或手工填写模型 ID，连接成功后即可让写作、自动化和 Agent 侧栏使用该模型。
> 原则：不新增第二套模型设置界面，不把厂商差异泄漏到业务层，不以“理论兼容”替代真实请求验证。

## 当前实现快照（2026-08-30）

本轮已落地安全最小集：DeepSeek 官方路由、Google AI Studio/Vertex Express、Anthropic、OpenRouter 及一批 OpenAI-compatible 路由均可由现有设置页生成 DSH runtime 配置；模型 ID 支持手工填写，Ollama 仅允许 loopback HTTP。配置在 Main 进程解析，密钥通过加密凭证边界进入运行时，Renderer、项目文件和普通日志不接触明文密钥。

已验证的自动化门禁包括 provider route 选择、Google AI Studio bridge、OpenAI-compatible 本地协议、端点安全、DSH 重启/切换和设置页到 Agent 的 Electron 用户旅程。以下章节仍是后续增强项：单一 Registry、draft/active 原子提交、逐厂商真实账户验收，以及能力矩阵的 UI 呈现；在这些门禁完成前，不把所有厂商宣传为同等能力。

## 1. 先说清楚“无风险”

多厂商 API 不可能承诺绝对零风险：厂商会改接口、模型会下线、账户权限和区域网络也会变化。本计划中的“无风险适配”指：

1. 现有 DeepSeek、OpenAI 兼容和 Agent 链路保持可用，不因新增厂商而改变既有行为。
2. 每个厂商都被隔离在适配器和能力声明中，失败只影响当前连接，不污染项目、会话、密钥或其他厂商配置。
3. 任何配置变更都可验证、可回滚；验证失败时继续使用上一次成功配置。
4. 新厂商必须经过契约测试、真实最小请求和 Electron 用户旅程，才可标记为“可用”。
5. API Key 不进入 Renderer、项目文件、普通日志、测试快照、回执或诊断导出。

## 2. 当前源码基线与主要风险

现有入口已经接近酒馆式体验：

- `public/index.html` 已有厂商选择、API Key、接口地址、模型 ID、刷新模型列表和连接按钮。
- `public/js/pages/settings/model-settings.js` 负责设置页交互、模型列表和连接。
- `src/backend/intelligence/models/providers/legacy-ai-client.js` 负责写作/自动化的多厂商请求、流式响应、模型列表和上下文信息。
- `electron/intelligence/agent/dsh/dsh-provider-config.js` 负责把同一套 AI 配置转换成 DSH 的原生供应商或 OpenAI-compatible 路由。
- `src/backend/foundation/configuration/secret-references/ai-secret-service.js` 已有 Electron `safeStorage` 保护和 profile 级密钥存储。
- `dev/tests/integration/dsh-multi-provider-runtime.spec.js` 已验证 OpenAI-compatible 配置能够进入真实 DSH 子进程和最终模型请求。

当前需要优先控制的风险：

| 风险 | 现状 | 处理方向 |
|---|---|---|
| 配置重复 | 前端、旧客户端、DSH 路由各维护默认 endpoint/model | 建立只读 Provider Registry，先做兼容映射，再逐步替换重复常量 |
| 失败覆盖旧配置 | 设置页部分输入变化会自动保存，连接失败时可能留下半成品 | 引入 draft/active 两阶段提交，只有验证成功才切换 active |
| 能力误判 | “OpenAI 兼容”不代表支持工具、流式、reasoning 或 `/models` | 用 capability matrix 声明能力；未知能力不强行启用 |
| 模型列表不可靠 | 有的服务商没有 `/models`，或需要额外权限 | 列表刷新是 best-effort；始终允许手工输入模型 ID |
| 上下文窗口误导 | 端点探测和 hostname 推断只能是估计 | 上下文限制标记为 `reported/inferred/unknown`，未知时采用保守预算且不阻止连接 |
| DSH 与写作路径漂移 | 两条运行时路径不共享同一份适配规则 | 两条路径共享规范化配置和能力声明，传输实现仍保持隔离 |
| 密钥泄漏 | 需要持续防止进入 IPC 返回、日志、runtime patch 和测试报告 | 统一 redaction + secret boundary 测试；测试只使用假的短期 Key |
| 厂商变更 | 模型 ID、错误结构、限流和区域 endpoint 会变化 | 适配器版本化、错误归一化、真实最小请求和可回滚开关 |

## 3. 用户最终体验（不新增侧栏）

沿用现有“设置 → 模型”页面，用户只需要：

1. 选择模型服务商。
2. 粘贴该厂商 API Key；本地 Ollama 等无密钥服务隐藏 Key 输入。
3. 使用默认接口地址，或在“高级/自定义接口地址”中修改。
4. 点击“刷新模型列表”；若厂商不提供列表，直接手工输入模型 ID。
5. 选择模型，点击“连接模型”。
6. 应用只在最小验证成功后切换到新配置；失败时明确显示原因，旧连接仍保持可用。
7. 连接成功后，写作、自动化和 Agent 侧栏读取同一个 active 配置，不要求用户重复填写。

不做的交互：

- 不新增第二个模型设置面板或独立的 Agent 模型面板。
- 不要求用户理解 DSH provider route、pi-ai profile 或内部 endpoint 拼接规则。
- 不把长期项目记忆、跨会话记忆和模型厂商配置混在一起。

## 4. 目标架构

### 4.1 Provider Registry（单一事实来源）

新增一个无副作用、可被后端和 Electron 读取的 Provider Registry。它只描述元数据，不执行网络请求、不持有密钥：

```js
{
  id: 'deepseek',
  label: 'DeepSeek',
  transport: 'deepseek-official' | 'openai-compatible' | 'anthropic' | 'google' | 'ollama',
  defaultEndpoint: 'https://api.deepseek.com/v1',
  defaultModel: 'deepseek-v4-flash',
  auth: { kind: 'api-key', required: true },
  capabilities: {
    listModels: 'supported' | 'best-effort' | 'unsupported',
    stream: true,
    tools: 'native' | 'compatible' | 'unsupported',
    reasoning: 'native' | 'mapped' | 'unsupported' | 'unknown',
    vision: 'supported' | 'unsupported' | 'unknown'
  },
  constraints: { requiresHttps: true, allowsLoopbackHttp: false },
  dsh: { route: 'deepseek-official' }
}
```

Registry 的第一版只做“数据归一化和校验”，不立即重写请求代码。旧常量通过兼容层读取 Registry，确保行为不变。

### 4.2 适配器边界

每个厂商对外暴露相同的最小能力接口，内部可以使用现有实现：

```text
validate(config)
resolveEndpoint(config)
listModels(config)          // 可选能力，失败不代表聊天不可用
testConnection(config)     // 非流式、低 token、无副作用
chat(config, request)
stream(config, request)
normalizeError(error)
```

适配器分为三类：

1. 原生协议：Anthropic、Google Gemini、DeepSeek 官方等。
2. OpenAI-compatible：OpenAI、Qwen、豆包、讯飞星火、GLM、Moonshot、SiliconFlow、MiniMax、Mistral、xAI、Groq、OpenRouter、Ollama 和 Custom。
3. 暂不进入 Agent 的复合认证：Google Vertex Service Account。Google Vertex Express API Key 已通过原生 `google-vertex` 路由接入；Service Account 仍必须明确显示“不支持该认证模式”，不能静默降级。

“OpenAI-compatible”只代表请求骨架相近，不自动宣称工具、reasoning、视觉、缓存或上下文能力相同。

### 4.3 配置与密钥分离

规范化配置分为三层：

- `ProviderSelection`：当前 provider、model、endpoint、生成参数和能力快照。
- `ProviderSecretRef`：只保存 provider/profile 引用；实际 Key 继续由 `safeStorage` 管理。
- `ProviderRuntimeConfig`：启动 DSH 或发请求时在 Main 进程临时拼出，密钥只通过子进程环境变量或请求头进入运行时。

项目文件、workspace、Renderer state、IPC 返回和日志只能出现前两层的非敏感字段，不能出现明文 Key。

## 5. 分阶段实施计划

### Phase 0：冻结基线与回滚点

工作：

- 保存当前通过的测试结果和构建产物，建立 checkpoint。
- 固定现有 provider ID、配置字段和默认行为，不在此阶段删除旧字段。
- 为 DeepSeek、OpenAI-compatible、Anthropic、Google、Ollama 各保存一组 mock contract fixture。
- 明确当前 active 配置的读取优先级和旧配置迁移规则。

验收：

- 现有全量测试、架构检查、lint 和 Electron smoke 全部通过。
- 未连接新厂商时，程序行为与 checkpoint 相同。
- 能一键关闭新 Registry/适配器开关并回到旧路径。

### Phase 1：建立 Registry 与规范化配置（只读接入）

工作：

- 新增 Registry，收拢 provider ID、显示名、默认 endpoint、默认 model、认证方式和能力声明。
- `model-settings.js`、`legacy-ai-client.js`、`dsh-provider-config.js` 改为从 Registry 读取，但保留旧字段兼容。
- 为 endpoint 做统一校验：远程 HTTP 必须 HTTPS；HTTP 仅允许 loopback；禁止 URL 中携带用户名、密码、query 和 fragment。
- 对未知 provider、空 model、非法 endpoint 返回可识别的用户错误。

验收：

- Registry 与旧行为的逐项 parity test 通过。
- 所有现有 provider ID 仍可加载旧 workspace。
- 任何不支持的 provider 都在连接前失败，不启动 DSH、不发网络请求。

### Phase 2：Draft/Active 两阶段连接

工作：

- 设置页维护 `draftConfig`，当前正在使用的配置为 `activeConfig`。
- 修改厂商、endpoint、model 或参数只更新 draft；不覆盖 active。
- 点击连接时执行本地校验 → 读取/保存候选 Key → 最小连接测试 → 成功后原子提交 active；失败则丢弃候选并保留旧 active。
- Key 输入框仍然只显示“已保存/未保存”，不支持回显明文。
- 连接成功后才触发 Agent restart/open；失败不影响当前 Agent 会话。

验收：

- 输入错误 endpoint、错误 Key、无权限模型、网络超时四类失败均保留旧连接。
- 应用重启后 active 配置和对应 profile 的 Key 能正确恢复。
- 旧配置不会因为用户切换下拉框或刷新模型列表而丢失。

### Phase 3：模型发现与手工模型 ID

工作：

- `listModels` 统一返回 `{ id, label, contextLimit, contextSource, capabilities }`。
- `/models` 不存在、权限不足或返回格式异常时只提示“无法自动获取列表”，不阻止手工输入。
- 对模型上下文标记 `reported/inferred/unknown`；unknown 使用保守的输出预算，不把推断值写回为事实。
- 记录模型列表缓存的 provider、endpoint、时间和模型 ID，切换 provider 时隔离缓存。

验收：

- 支持 `/models` 的厂商能刷新并选择模型。
- 不支持 `/models` 的厂商能手工输入模型并成功连接。
- 切换厂商不会显示上一个厂商的模型列表或错误上下文窗口。

### Phase 4：写作/自动化适配器收敛

工作：

- 先为现有 `legacy-ai-client.js` 增加适配器外壳，不改变每个厂商的请求体。
- 统一 stream event、assistant text、reasoning、tool call 和错误模型；厂商特有字段放在 `raw`，不泄漏给业务层。
- 工具能力按 Registry 结果决定：不支持 native tools 的厂商使用安全降级（将工具结果转为上下文文本），禁止假装工具调用成功。
- 将超时、重试、429、5xx、认证失败和上下文超限归一化为稳定错误码，并保留厂商状态码供诊断。

验收：

- DeepSeek 旧路径逐字节级别的请求结构不发生非必要变化。
- 每个已声明支持 stream/tools 的 provider 都有 mock SSE/tool contract test。
- 工具不支持时，Agent/写作不会死循环或显示虚假的“工具已执行”。

### Phase 5：DSH 多厂商路由对齐

工作：

- `dsh-provider-config.js` 只负责把规范化配置映射到 DSH route，不再单独维护 provider 元数据。
- 原生 pi-ai route 与 OpenAI-compatible route 保持隔离；每个 route 生成独立的 model profile。
- DSH 启动前检查能力和认证，失败返回明确的 `AGENT_PROVIDER_UNSUPPORTED` 或 `AGENT_PROVIDER_AUTH_REQUIRED`。
- DSH 运行时只接收当前 active 配置；切换配置采用 stop → start，失败自动恢复旧 runtime。
- 保留当前 DeepSeek 官方 Web Search 的厂商限制；非 DeepSeek 不自动宣称拥有同样的 Web Search 能力。

验收：

- DeepSeek、OpenAI-compatible、Anthropic、Google、Ollama 各完成一次真实 DSH 最小对话或本地真实协议验证。
- 最终模型请求中的 model、endpoint、tools 和 authorization 与规范化配置一致。
- DSH 崩溃、超时、401、429、模型不存在时，旧 active 配置可重新启动。

### Phase 6：真实厂商验收与发布门禁

每个厂商按相同清单验收：

1. 设置页输入 Key、刷新/手工填写模型、连接成功。
2. 最小非流式请求成功。
3. 流式写作请求成功，首块和结束事件正确。
4. 工具能力按声明工作或安全降级。
5. 取消、超时、401、429、上下文超限均有用户可理解的错误。
6. 重启应用、切换章节、重启 Agent 后仍使用正确 provider/model。
7. 日志、导出、项目文件、IPC 返回和 UI 都不含 Key。

真实 Key 只用于本地人工验收，不写入仓库、测试 fixture、截图或自动化报告；验收完成后删除/轮换该 Key。

## 6. Provider 能力矩阵（第一批）

| 组别 | 厂商 | 首批策略 | Agent 进入条件 |
|---|---|---|---|
| 官方/原生 | DeepSeek | 保持现有官方路由 | 真实最小请求 + Web Search 单独验收 |
| 官方/原生 | Anthropic | 使用原生消息转换 | stream、tool、错误映射通过 |
| 官方/原生 | Google Gemini | 使用原生 contents 转换 | stream、模型列表和安全错误通过 |
| 网关 | OpenRouter | OpenAI-compatible + 网关头 | model ID 手工输入可用 |
| 兼容协议 | OpenAI、Qwen、豆包、星火、GLM、Moonshot、SiliconFlow、MiniMax、Mistral、xAI、Groq | 复用兼容适配器，逐家验证差异 | 至少最小对话和流式通过；工具能力单独标记 |
| 本地 | Ollama | loopback HTTP + `/v1` 规范化 | 无 Key 连接；不得向非 loopback 明文 HTTP 发送 |
| 自定义 | Custom OpenAI API | 用户提供 HTTPS endpoint + model | 仅保证兼容协议最小子集，不保证厂商特性 |
| 原生/复合凭证 | Google Vertex | Agent 支持 Express API Key；Service Account 暂不承诺 | Express 完成最小文字验证；Service Account 待安全注入和真实验证后再开放 |

## 7. 测试矩阵与发布门禁

### 自动化测试

- Registry：ID、默认值、endpoint 安全校验、能力声明一致性。
- Config：draft/active 原子提交、失败回滚、旧 workspace 迁移。
- Secret：加密存储、profile 隔离、IPC/日志/patch 脱敏。
- Model list：成功、空列表、401、404、超时、非法 JSON、手工 model fallback。
- Transport：每类协议的 non-stream、stream、tool、reasoning、错误归一化。
- DSH：route 选择、runtime 重启、provider 切换、最终请求 body 和工具集合。
- Electron E2E：设置页用户旅程、连接失败保留旧配置、连接成功打开 Agent、切换章节和重启。

### 真实验证门禁

- Mock 测试全部通过不等于厂商可用；每个厂商至少需要一次真实最小请求。
- 真实验证不得把 Key 写入 Playwright trace、HAR、截图、日志或诊断文件。
- 新厂商未通过全部门禁时保持 feature flag 关闭，不能出现在“推荐可用”列表中。

### 发布前回滚点

1. Registry 开关：恢复旧 provider 常量和旧请求路径。
2. Adapter 开关：单个 provider 可退回 legacy transport。
3. DSH 开关：单个 provider 可禁用 Agent，仅保留写作旧路径。
4. 配置迁移开关：旧 workspace 不迁移时仍可读取。
5. 版本化 checkpoint：每个 phase 单独记录测试结果和构建产物。

## 8. 明确不在本轮做的事

- 不新增独立模型管理侧栏。
- 不做跨会话长期记忆或项目级大记忆。
- 不把所有厂商强行转换成同一套“高级能力”；能力未知就显示未知。
- 不在没有真实验证的情况下承诺 Google Vertex、厂商 Web Search、视觉、缓存或特殊 reasoning 能力。
- 不为了多厂商适配重写编辑器、章节树、世界书或 Agent UI。

## 9. 计划完成标准

当以下条件全部满足时，才认为“多厂商适配完成”：

- 用户只通过现有设置页就能完成“选厂商 → 填 Key → 选/填模型 → 连接 → 使用”。
- 新配置失败不会覆盖旧配置，Agent 和写作路径不会互相污染。
- Provider 元数据只有一个事实来源，前端、旧客户端和 DSH route 不再各自漂移。
- 已支持厂商的能力边界在 UI 和错误提示中诚实可见。
- 自动化测试、Electron 用户旅程、真实最小请求和脱敏审计全部通过。
- 任一单厂商故障都可被禁用或回滚，不需要回滚整个应用。
