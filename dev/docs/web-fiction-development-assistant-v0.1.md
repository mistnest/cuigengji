# 网文开发助手 v0.1：产品基线与实施计划

> 状态：Phase 0–6 与多供应商桥接已实现，交付前体验测试与 `dist` 打包验收通过；真实长会话与官方 Web Search 人工验收待进行
> 基线日期：2026-08-19
> 适用代码基线：`195f636`（包含此前问题修复与 checkpoint）
> DSH 基线：`@deepseek-ai/dsh@0.1.0-rc.7`
> 原始讨论稿：`D:\novel\reference-materials\web-fiction-development-assistant-v0.1.md`

本文是当前 v0.1 的实施依据。原始讨论稿用于保留思考过程；当两者冲突时，以本文为准。

## 实施结果（更新至 2026-08-30）

| 阶段 | 结果 |
| --- | --- |
| Phase 0 | 本文已进入仓库，原始讨论稿继续只作为讨论记录 |
| Phase 1 | Persona 与 session-local compaction 已强化，不引入跨 session 记忆 |
| Phase 2 | 六个 bundled Skill 已通过隔离 filesystem provider 与 `skill` 工具接入 |
| Phase 3 | 官方 DeepSeek 条件式 `web_search`、轻量回执和安全 HTTPS 来源链接已接入 |
| Phase 4 | `safe_web_fetch` 已通过 URL、DNS、IP 固定、重定向、响应上限和凭证隔离测试 |
| Phase 5 | 大纲提案卡片、revision 校验、删除确认和领域层原子 patch 已接通 |
| Phase 6 | lint、架构门禁、preload、93 项全量测试、真实窗口设置与 Agent 用户旅程、真实 DeepSeek 对话、真实公网 Safe Web Fetch、Windows `dist` 目录包及 packaged E2E 均已通过；真实长会话和官方 Web Search 仍需人工验收 |

实现没有新增第二套 Agent UI、跨 session 长期记忆或 Agent 写权限。提案仍在现有侧栏中展示，只有用户点击应用后才通过 Project Outline 领域命令修改项目。

2026-08-30 补充：Agent 能力已由 `dsh-plugin-bundle.js` 统一组合，`cuigenji-writing-context` 是唯一 Prompt 注入插件。外部世界书、人物卡与预设继续兼容导入，但酒馆 marker、宏插槽和注入顺序不进入运行态。生成—审阅—改写 subagent 仍属于后续研究，不在 v0.1 生产工具面中；见 [质量循环研究](./refactor-v2/14-iterative-writing-quality-research.md)。

---

## 1. 产品目标

在现有右侧 Agent 侧栏中提供一个能够理解当前小说、连续讨论创作问题、按需查询外部资料并提出可审阅修改建议的网文开发助手。

核心价值不是替作者一次性写完整部小说，而是：

> 通过诊断、对比方案、局部试探和资料检索，帮助作者把尚未想清楚的故事逐步想清楚，同时始终把正式创作决策留给作者。

v0.1 优先验证以下闭环：

```text
用户提出创作问题
→ Agent 读取当前项目与同一会话上下文
→ 必要时查询项目冷资料
→ 必要时搜索并读取外部公开资料
→ 使用相应创作方法分析
→ 围绕一个关键不确定性给出少量方案
→ 用户选择、否定、组合或继续说明
→ Agent 形成结构化大纲修改提案
→ 用户明确确认后才修改项目
```

---

## 2. 已确认的产品决策

### 2.1 交互入口

- 继续使用现在的 Agent 侧栏。
- 不新增侧栏、工作台、模式选择器或任务面板。
- Agent 在用户输入前保持安静，不主动弹出教程、问题清单或创作流程。
- 用户始终可以用自然语言交流，不需要知道 Agent 内部调用了什么 Skill 或工作阶段。

### 2.2 单轮回复

- 每轮优先处理一个最关键的不确定性。
- 默认给出两个真正有差异的方向。
- 确有必要时给三个；只有初始开放式发散才考虑四个以上方向。
- 选项只是帮助用户判断，不要求用户点击固定按钮；用户可以直接继续输入。
- 不单独接入 DSH User Questions 作为主交互，因为现有会话回复已经能够自然停在用户决策点。

### 2.3 会话与记忆

- 主要保证同一个 DSH session 内的连续理解。
- 同一 session 可以在应用重启后恢复历史和压缩摘要。
- 新建 session 是干净会话，只重新加载当前项目的真实资料。
- 不建立跨 session 的作者偏好画像。
- 不建立独立的项目级 Agent 长期记忆。
- 会话中总结出的偏好、否决和临时假设，只属于该 session；除非用户明确应用到项目，否则不能成为项目事实。

### 2.4 修改权限

- Agent 可以诊断、比较、试写和提出大纲 patch。
- Agent 生成 patch 不等于修改项目。
- 只有用户在界面中执行明确的“应用”动作后，项目领域层才能写入。
- 应用前必须验证大纲 revision；过期提案不能静默覆盖新内容。
- v0.1 不允许 Agent 写章节正文、世界书、角色卡或任意文件。

### 2.5 外部资料

- Web 结果属于外部参考，不是项目 canon。
- 项目权威资料与网络资料冲突时，不允许用网络结果覆盖项目设定。
- 使用网络信息的回答应保留来源 URL。
- 搜索和 Fetch 用于事实与背景研究，不能替用户决定故事价值取向或剧情方向。

### 2.6 回执

- 沿用当前侧栏里的轻量工具卡片。
- 回执只回答“Agent 正在做什么、是否完成”，不展示内部参数、原始工具结果、路径或运行时信息。
- 示例：`正在搜索“明代县衙职位”`、`资料搜索完成`、`正在读取网页`、`已形成大纲修改提案`。
- 不新增完整过程面板。

---

## 3. v0.1 明确不做

- 跨 session 的长期 Agent 记忆。
- 项目级作者偏好数据库或永久心理画像。
- 正式剧情分支、分支合并和分支版本管理。
- 多 Agent、子 Agent 或自动辩论。
- Goal、Todo、Plan、Workflow、Schedule 等任务系统。
- Ralph 式自主循环。
- 自动连续生产大量章节。
- 未经确认的项目写入。
- Shell、PowerShell、Bash、任意文件系统工具或 `run_code`。
- 新增第二套 Agent UI 或嵌入 DSH 官方 Web UI。
- Exa、Perplexity 等额外搜索 Provider。
- PDF、登录网页、需要 Cookie 的页面和浏览器自动化抓取。

---

## 4. 信息状态与优先级

v0.1 不实现独立的持久化 `intent-model`，但 Agent 在同一 session 内仍需区分信息性质。

### 4.1 四类信息

| 类型 | 含义 | 是否自动写入项目 |
| --- | --- | --- |
| 项目事实 | 当前项目大纲、章节、世界书和角色卡中的实际内容 | 已经属于项目 |
| 会话确认 | 用户在当前 session 中明确认可，但尚未应用的决定 | 否 |
| 外部参考 | Web Search / Fetch 获得的公开资料 | 否 |
| 推断与提案 | Agent 的解释、临时假设、候选方案和 patch | 否 |

### 4.2 冲突处理

优先级不是简单的“网络更新所以一定正确”，而是：

1. 对小说内部事实，以项目数据为准。
2. 用户可以在当前会话中纠正项目事实，但纠正只在应用后成为新 canon。
3. 外部资料只能用于核对现实背景或提供参考。
4. Agent 推断必须保持可撤销，不能伪装成用户确认。

---

## 5. 当前代码基线

当前原生 Agent 链路已经完成，不需要重新建设运行时或侧栏。

| 现有能力 | 当前实现 | v0.1 处理 |
| --- | --- | --- |
| DSH 进程监督 | `electron/intelligence/agent/dsh/dsh-supervisor.js` | 保留并扩展 preset 组装 |
| DSH RPC / event stream | `dsh-rpc-client.js`、`dsh-event-stream.js` | 保留现有白名单 |
| DSH → UI 事件清洗 | `dsh-event-mapper.js` | 扩展工具回执和 proposal 事件 |
| 会话恢复 | DSH workspace/session persistence | 直接复用 |
| 项目热上下文 | `project-context-service.js` | 小幅补充上下文语义 |
| 项目冷资料 | `cuigenji-project-knowledge.mjs` | 保留两项只读工具 |
| 小说会话压缩 | `cuigenji-novel-compaction.mjs` | 强化 session-local、来源和提案状态规则 |
| 工具权限 | `cuigenji-tool-policy.mjs` | 从固定两项改为仍然严格、但可配置的精确白名单 |
| Agent 原生侧栏 | `public/js/pages/workspace/agent/` | 保留结构，增加链接和提案卡片 |
| 大纲领域 | `src/backend/domains/project/outlines/outline-service.js` | 新增原子 patch 命令 |

当前模型实际只能看到：

```text
search_project_knowledge
get_project_knowledge
```

目标工具面按阶段扩展为：

```text
search_project_knowledge
get_project_knowledge
skill
web_search                 # 仅受支持的 DeepSeek 官方配置
safe_web_fetch
propose_outline_patch      # 只生成提案，无写入副作用
```

任何未列出的工具仍然失败即关闭。

### 5.1 模型供应商边界

设置页继续作为唯一模型入口，不为 Agent 另建模型侧栏或配置页。模型字段采用“推荐列表 + 可手输 ID”，避免供应商新增模型后必须等待应用发版，也避免再增加一套高级配置 UI。

Agent 当前桥接范围：

| 路径 | 供应商 |
| --- | --- |
| DSH 官方专用适配器 | DeepSeek |
| DSH pi-ai 原生路由 | Anthropic、Google AI Studio、OpenRouter |
| OpenAI 兼容路由 | OpenAI、Mistral、xAI、Groq、Qwen、Doubao、Spark、Z.AI、Moonshot、SiliconFlow、MiniMax、Ollama、自定义 OpenAI API |

Ollama 是本地无密钥配置；适配层仅在 DSH 子进程内提供兼容传输要求的固定占位凭据。Google Vertex 的 Express API Key、完整 service account 和 ADC 等凭证形态不能被当成普通单一 API Key 处理，因此 v0.1 的原有生成入口仍保留它，但 Agent 明确提示暂不支持，不做静默降级。

所有模型密钥继续由 Electron 安全存储持有。DSH overlay 只写环境变量引用；Renderer、状态对象、日志、工具事件和项目文件均不得出现密钥值。只有“DeepSeek + 官方 `api.deepseek.com` 端点 + 已保存 DeepSeek 密钥”可以挂载官方 `web_search`，其他供应商的密钥不会跨供应商发送。

---

## 6. 原讨论稿模块的落地方式

原讨论稿中的概念不全部变成独立代码模块。

| 原概念 | v0.1 落地方式 |
| --- | --- |
| `story-state` | 使用现有 Project/Knowledge 权威数据，不建立第二份状态库 |
| `intent-model` | 仅存在于同一 session 历史与 compaction 摘要，不跨 session 持久化 |
| `probe-planner` | 创作 Skill：围绕一个不确定性设计最小判断单位 |
| `feedback-interpreter` | 创作 Skill：解释模糊反馈并保持推断置信边界 |
| `idea-developer` | 创作 Skill：发展剧情方向与后果 |
| `outline-workbench` | `propose_outline_patch` + 现有 Outline 领域的原子 apply 命令 |
| `branch-and-revision` | v0.1 不实现；候选方向只保留在当前 session 对话中 |
| `scene-sandbox` | 创作 Skill；输出仍是普通会话内容，不自动入库 |
| `commercial-lens` | 创作 Skill；提供维度分析，不输出伪客观总分 |
| 工作模式枚举 | 不做用户可见模式；由 persona 与 Skill 在内部自然路由 |

这样可以保留原始设计的创作方法，同时避免制造一套与真实项目数据竞争的长期状态系统。

---

## 7. 模块级改造方案

### 7.1 Agent Persona 与行为策略

#### 现状

`dsh-supervisor.js` 生成的 persona 只包含基本只读边界和项目一致性要求，还没有完整表达本计划中的交互规则。

#### 改动

在生成 preset 时补充稳定的产品行为：

- 用户输入前不主动发言。
- 自然对话优先，不暴露内部模式名称。
- 每轮只推进一个关键问题。
- 默认两个方案，避免同义改写和选项堆积。
- 明确区分项目事实、会话确认、外部资料、推断和提案。
- 不把同一 session 的偏好解释成跨 session 画像。
- 项目资料不足时先说明，再决定查询冷资料或外部资料。
- 只有事实研究需要时调用 Web；纯创作判断不滥用搜索。
- 提出大纲修改时调用 proposal 工具；工具本身不得写项目。

#### 主要文件

- `electron/intelligence/agent/dsh/dsh-supervisor.js`
- `dev/tests/integration/dsh-runtime-contract.spec.js`

---

### 7.2 会话压缩

#### 现状

现有小说 compaction 已经区分“已确认事实”和“已讨论但未确认”，可以直接演进。

#### 改动

调整压缩模板，固定保留：

- 用户当前要解决的单一问题。
- 本 session 已确认、已否决和仍待验证的方向。
- 只属于会话的偏好与证据。
- 外部资料的结论、URL 与“不属于 canon”标记。
- 尚未应用的大纲 proposal 及其 base revision。
- 已应用、已拒绝或因 revision 变化而过期的 proposal。
- 最近一次用户纠正。

明确删除或避免：

- 把会话偏好描述成长期作者画像。
- 大段复制项目热上下文和网页正文。
- 把网络资料、sandbox 内容或 Agent 推断升级为项目事实。

#### 主要文件

- `electron/intelligence/agent/dsh/plugins/cuigenji-novel-compaction.mjs`
- `dev/tests/interface/dsh-agent-plugins.spec.js`
- `dev/tests/integration/dsh-runtime-contract.spec.js`

---

### 7.3 创作 Skills

#### 设计

使用 DSH 的 `dsh-skill-filesystem` 和 `dsh-tool-skill`。Skill 是按需加载的方法说明，不保存具体项目内容。

第一批先提供六个 Skill：

| Skill | 职责 |
| --- | --- |
| `story-direction-probe` | 从模糊想法中找出关键不确定性并设计最小对比方案 |
| `character-motivation-review` | 检查人物目标、行动、代价与行为一致性 |
| `conflict-suspense-review` | 检查冲突机制、信息差、升级和悬念兑现 |
| `pacing-payoff-review` | 检查章节节奏、压力积累与阶段性回报 |
| `commercial-web-fiction-review` | 从读者承诺、卖点、剧情发动机和长线持续性分析 |
| `author-feedback-interpretation` | 解释“不够爽”“人物不对”等模糊反馈并规划下一次试探 |

场景原型和 outline patch 方法先并入上述 Skill；真实使用证明内容过大或路由不准后再拆，不在第一批创建过多目录。

#### 装配方式

1. 在源码内维护只读的 bundled Skill 目录。
2. Supervisor 启动时将 Skill 复制到当前 DSH 私有 preset 目录。
3. `skill-filesystem` 使用：
   - `includeDefaultRoots: false`
   - 仅挂载催更姬自己的 Skill 根目录
   - `watch: false`
4. 挂载 `tool-skill`，模型只看到 `skill` 加载工具和精简目录。
5. 将 `skill` 加入严格工具白名单。

这可以防止用户目录或其他项目中的未知 Skill 意外进入催更姬工具面。

#### 依赖

在 `package.json` 中加入与 DSH 相同的精确版本直接依赖：

```text
@deepseek-ai/dsh-skill-filesystem@0.1.0-rc.7
@deepseek-ai/dsh-tool-skill@0.1.0-rc.7
```

#### 主要文件

- 新增 `electron/intelligence/agent/dsh/skills/<skill-name>/SKILL.md`
- `electron/intelligence/agent/dsh/dsh-supervisor.js`
- `electron/intelligence/agent/dsh/plugins/cuigenji-tool-policy.mjs`
- `package.json`、`package-lock.json`
- `dev/tests/interface/dsh-agent-plugins.spec.js`
- `dev/tests/integration/dsh-runtime-contract.spec.js`

---

### 7.4 Web Search

#### 设计

复用 rc.7 已安装的 DeepSeek Web Search Provider，在 Agent preset 中挂载 `@deepseek-ai/dsh-tool-web`，但保持：

```yaml
search: true
fetch: false
searchMaxResults: 6
searchTimeoutMs: 60000
```

Fetch 不通过这个开关启用；安全 Fetch 由催更姬单独实现。

#### 重要配置边界

rc.7 的 DeepSeek Search Provider 使用 DeepSeek Anthropic-compatible Messages API。它不会自动复用聊天模型的自定义 `DEEPSEEK_BASE_URL`。

因此：

- 当前模型端点为空或明确属于官方 `api.deepseek.com` 时，可以开放 `web_search`。
- 当前使用第三方或自定义模型端点时，v0.1 不自动把该密钥发送到 DeepSeek 官方搜索端点。
- 不支持的配置下不暴露 `web_search`，并给出可理解的能力提示。
- 后续若支持自定义搜索端点，应增加独立配置，不能从聊天 URL 猜测 Anthropic 搜索 URL。

工具白名单需要由 Supervisor 按本次 launch 能力生成，但仍执行精确集合校验，而不是改成宽松匹配。

#### 调用规则

- 用户明确要求查资料时调用。
- 问题依赖现实事实且项目资料不足时调用。
- 通常先执行一次聚焦搜索，结果不足再细化，避免每轮多次搜索。
- 不为纯创意偏好、人物价值判断或剧情选择自动搜索。
- 搜索结果被标记为外部参考，并在回答中引用 URL。

#### 回执

- 开始：`搜索网络资料` + 已清洗的查询摘要。
- 完成：保留原查询摘要并把状态更新为完成。
- 失败：只显示可公开错误，不向 Renderer 暴露请求体、密钥或 Provider 内部响应。

#### 依赖

增加精确版本直接依赖，确保打包依赖闭包稳定：

```text
@deepseek-ai/dsh-tool-web@0.1.0-rc.7
```

#### 主要文件

- `electron/intelligence/agent/dsh/dsh-supervisor.js`
- `electron/intelligence/agent/dsh/plugins/cuigenji-tool-policy.mjs`
- `electron/intelligence/agent/dsh/dsh-event-mapper.js`
- `package.json`、`package-lock.json`
- `dev/tests/interface/dsh-agent-plugins.spec.js`
- `dev/tests/interface/dsh-gateway.spec.js`
- `dev/tests/integration/dsh-runtime-contract.spec.js`
- `dev/tests/electron/dsh-workbench.spec.js`

---

### 7.5 Safe Web Fetch

#### 为什么不直接开启官方 Fetch

本地 rc.7 没有安装 `dsh-web-fetch-http`，官方 preset 也明确设置了 `fetch: false`。此外，当前官方 HTTP Fetch 的安全说明不保证阻断私网目标。Electron 桌面应用不能把可访问用户本机网络的裸 Fetch 直接交给模型。

#### 实现方式

新增催更姬自有的 `safe_web_fetch` DSH 工具，而不是把 `tool-web.fetch` 改成 `true`。

工具无项目写入能力，只接收一个 URL，返回：

```text
requestedUrl
finalUrl
status
title
contentType
text
truncated
```

#### 网络安全要求

- 仅允许 `http:` 和 `https:`；优先 HTTPS。
- 禁止 URL 用户名和密码。
- 拒绝 localhost、回环、私网、链路本地、未指定、组播及云元数据地址。
- 域名解析后检查所有候选 IP；不能只检查 URL 字符串。
- 请求连接固定到已验证的公网 IP，避免检查后 DNS 重绑定。
- 每个重定向目标重新执行完整校验。
- 使用手动重定向并限制跳转次数。
- 不带 Cookie、Authorization、浏览器登录态和 Referer。
- 不执行 JavaScript，不创建 WebContents。
- 限制端口、响应字节数、解码字符数和总超时。
- 只接受有限文本类型；PDF、压缩包、图片和可执行内容直接拒绝。
- HTML 转换为有上限的可读文本或 Markdown；不得把页面脚本当作正文。

首版建议限制：

```text
redirects <= 5
response bytes <= 2 MiB
model-facing text <= 120,000 chars
timeout <= 20 seconds
ports = 80 or 443
content types = text/html, application/xhtml+xml, text/plain, application/json
```

若安全 Spike 无法同时满足“DNS 固定”和用户代理网络可用性，本阶段应保持该工具关闭；不能为了完成排期降低 SSRF 门槛。

#### 主要文件

- 新增 `electron/intelligence/agent/dsh/plugins/cuigenji-safe-web-fetch.mjs`
- `electron/intelligence/agent/dsh/dsh-supervisor.js`
- `electron/intelligence/agent/dsh/plugins/cuigenji-tool-policy.mjs`
- `electron/intelligence/agent/dsh/dsh-event-mapper.js`
- `dev/tests/interface/dsh-agent-plugins.spec.js`
- 新增独立的安全测试文件
- `dev/tests/integration/dsh-runtime-contract.spec.js`

---

### 7.6 来源链接与回答呈现

#### 现状

Agent 回答当前通过 `textContent` 作为纯文本显示。即使模型输出 Markdown 链接，用户也不能直接打开来源。

#### 改动

- 不引入完整 HTML Markdown 渲染器。
- 增加最小、安全的行内链接解析，只识别 Markdown HTTPS 链接。
- 链接文字继续通过 `textContent` 创建，禁止 `innerHTML` 注入。
- 点击时调用现有 `DesktopApi.app.openExternal`；不允许页面内导航或新窗口。
- `http:` 或其他协议首版保持普通文本，不开放点击。
- 工具原始结果仍不直接发送给 Renderer；最终回答负责说明使用了哪些来源。

#### 主要文件

- `public/js/pages/workspace/agent/conversation/agent-conversation.js`
- `public/js/pages/workspace/agent/agent-sidebar.css`
- `dev/tests/interface/agent-store.spec.js` 或新增 conversation DOM 测试
- `dev/tests/electron/dsh-workbench.spec.js`

---

### 7.7 轻量工具回执

#### 改动

扩展现有工具标签：

```text
search_project_knowledge  → 搜索项目资料
get_project_knowledge     → 读取项目资料
skill                     → 加载创作方法
web_search                → 搜索网络资料
safe_web_fetch            → 读取网页资料
propose_outline_patch     → 整理大纲修改提案
```

完成事件不再统一写成“项目资料已返回”。Renderer 应尽量保留开始事件中的安全摘要，只更新完成/失败状态。

`skill` 回执不显示本地路径；Fetch 回执只显示清洗后的站点和路径摘要，不显示 URL 凭据、查询中的敏感参数或响应正文。

#### 主要文件

- `electron/intelligence/agent/dsh/dsh-event-mapper.js`
- `public/js/pages/workspace/agent/state/agent-store.js`
- `public/js/pages/workspace/agent/conversation/agent-conversation.js`
- `dev/tests/interface/dsh-gateway.spec.js`
- `dev/tests/interface/agent-store.spec.js`

---

### 7.8 大纲修改提案与显式应用

#### 设计原则

`propose_outline_patch` 是无副作用工具。它只把模型建议变成可验证、可呈现的数据，不调用项目写接口。

建议 schema：

```yaml
baseRevision: integer
summary: string
reason: string
operations:
  - kind: create | update | reorder | delete
    # 其余字段由 kind 决定
impact: string[]
assumptions: string[]
```

上述内容是模型参数；`proposalId` 由工具执行端生成并加入返回值，不能信任模型自行提供的持久标识。`create` 操作只使用 proposal 内局部引用，真正的节点 ID 在用户应用时由 Outline 领域层生成。

底层操作只使用现有 Outline 领域能够表达的原语：

- `create`
- `update`
- `reorder`
- `delete`

“拆分节点”“合并节点”“增加铺垫”等创作语义由 Skill 转译为这些原子操作，不在领域层增加重复概念。

#### 事件与 UI

1. DSH 工具验证 proposal 并返回，不写项目。
2. Main mapper 将经过白名单清洗的 proposal 映射为稳定 `proposal.outline` 事件。
3. Agent Store 投影为现有对话流中的 proposal 卡片。
4. 卡片展示摘要、修改数量、影响、假设和 base revision。
5. 用户可以继续讨论、忽略或点击“应用到大纲”。
6. 包含删除操作时再次显示明确的破坏性确认。

不新增侧栏；proposal 卡片就是 Agent 回复的一部分。

#### 原子应用

现有 `createNode/updateNode/reorder/deleteNode` 是分散调用，不能保证一组 patch 全部成功或全部失败。因此新增：

```text
applyOutlinePatch(projectId, {
  expectedRevision,
  operations,
  confirmed
})
```

领域层必须：

- 一次读取并校验当前 revision。
- 在内存副本上验证全部操作和引用关系。
- 只接受 Outline schema 明确允许的字段，并解析 proposal 局部引用。
- 任一步无效时不写文件。
- 全部有效后一次原子写入。
- revision 只增加一次。
- 删除操作要求显式 `confirmed: true`。
- 返回新 revision 和受影响节点摘要。

应用成功后：

- 刷新大纲区域。
- 调用 `agent.refreshContext` 更新 DSH 热上下文。
- proposal 卡片显示已应用。

v0.1 不为 proposal 另建长期状态库。会话历史恢复后，如果卡片的 base revision 已落后于当前大纲，只显示“已应用或已过期”，不再次开放应用；需要精确区分历史状态时再单独设计审计记录。

如果当前 revision 已变化：

- 禁止应用旧 proposal。
- 提示用户让 Agent 基于新大纲重新整理。
- 不自动重算或静默合并。

#### 主要文件

- 新增 `electron/intelligence/agent/dsh/plugins/cuigenji-outline-proposal.mjs`
- `electron/intelligence/agent/dsh/dsh-supervisor.js`
- `electron/intelligence/agent/dsh/dsh-event-mapper.js`
- `shared/desktop-api/agent/agent.contract.js`
- `public/js/pages/workspace/agent/state/agent-store.js`
- `public/js/pages/workspace/agent/conversation/agent-conversation.js`
- `src/backend/domains/project/outlines/outline-service.js`
- `shared/desktop-api/project/outlines.contract.js`
- `shared/desktop-api/project/project.schema.js`
- `electron/ipc/project/outlines.handlers.js`
- `electron/preload-src/project.cjs` 与生成的 `electron/preload.cjs`
- `public/js/shared/desktop/desktop-repositories.js`
- `public/js/pages/workspace/outline/index.js`
- 对应 interface、integration 和 Electron E2E 测试

---

## 8. 工具权限设计

`cuigenji-tool-policy` 继续采用“可见工具集合必须精确相等”的 fail-closed 方式，但允许 Supervisor 传入本次 launch 的预期集合。

建议阶段集合：

| 阶段 | 精确允许工具 |
| --- | --- |
| 当前 | `search_project_knowledge`、`get_project_knowledge` |
| Skills | 上述两项 + `skill` |
| Search | 上述三项 + 条件性的 `web_search` |
| Fetch | 上述集合 + `safe_web_fetch` |
| Proposal | 最终集合 + `propose_outline_patch` |

必须继续明确拒绝：

```text
bash
pwsh
shell
fs read/write/edit
subagent
goal
todo
workflow
jobs
run_code
官方 web_fetch
```

---

## 9. 实施阶段

### Phase 0：计划基线

交付：

- 本文进入仓库并作为下一阶段权威计划。
- 原始讨论稿保留，不直接作为代码契约。
- 保持 checkpoint 后工作区干净。

### Phase 1：行为策略与会话压缩

任务：

- 更新 persona。
- 更新 compaction 模板。
- 补充 system prompt 和压缩契约测试。
- 不改变工具集合和 UI。

验收：

- 新 session 不继承旧 session 的偏好。
- 同一 session 压缩后保留确认、否决和未决问题。
- 网络资料与提案不会被压缩成项目事实。

### Phase 2：创作 Skills

任务：

- 添加六个 bundled Skill。
- 挂载隔离的 filesystem provider 和 `skill` 工具。
- 扩大精确工具白名单。
- 验证开发版与 packaged Electron 均能读取 Skill。

验收：

- 模型只看到催更姬内置 Skill。
- 用户目录和项目目录中的未知 Skill 不可见。
- Skill 按需加载，不把全部方法永久塞进 system prompt。

### Phase 3：Web Search 与来源呈现

任务：

- 条件性挂载 `web_search`。
- 处理官方端点与自定义端点边界。
- 增加工具回执。
- 增加安全 HTTPS 链接呈现。

验收：

- 官方 DeepSeek 配置可以完成一次真实搜索并返回来源。
- 自定义端点的密钥不会被静默发送到官方搜索接口。
- 回答中的 HTTPS 来源可以通过系统浏览器打开。
- Renderer 收不到 API Key、原始请求体或完整工具结果。

### Phase 4：Safe Web Fetch

先做网络安全 Spike，再决定默认启用。

任务：

- 实现 URL/IP/redirect 校验和固定解析。
- 实现有上限的文本抓取与 HTML 转换。
- 增加 SSRF、超时、过大响应和内容类型测试。
- 安全门槛通过后才加入工具白名单。

验收：

- 正常公开网页可读。
- localhost、所有私网和重定向到私网均被阻止。
- DNS 重绑定测试不能绕过已验证目标。
- 工具不携带 Cookie、认证信息或浏览器状态。

### Phase 5：Outline Proposal 与原子应用

任务：

- 实现无副作用 proposal 工具。
- 增加稳定 proposal 事件与对话卡片。
- 实现 Outline 原子 patch command。
- 接入 revision 冲突和删除确认。
- 应用后刷新大纲和 Agent 上下文。

验收：

- Agent 不能自行写项目。
- 未点击应用时项目文件不变化。
- 一组 patch 要么全部成功，要么完全不写。
- 过期 proposal 不可覆盖新大纲。
- 删除操作有额外确认。

### Phase 6：稳定化与产品验收

自动化：

```powershell
npm run preload:check
npm run lint
npm run architecture:check
npm test -- --reporter=list
npm run package:win
```

人工验收：

1. 至少一次 30 分钟真实创作会话。
2. 会话中经历项目资料查询、Web Search、Fetch、Skill 和 proposal。
3. 应用重启后恢复同一 session，并确认新 session 完全干净。
4. 测试无 Key、错误 Key、自定义端点、网络中断和 Runtime 重启。
5. 检查工具回执是否足够明确但不过度打扰。
6. 检查诊断日志不包含密钥、网页正文、小说正文或隐藏推理。

---

## 10. 测试矩阵

| 层级 | 重点 |
| --- | --- |
| Interface | Tool schema、精确白名单、compaction、URL/IP 校验、outline patch 验证 |
| Integration | 真实 rc.7 preset 的工具集合、Skill catalog、Search tool、proposal event |
| Gateway | DSH 原始事件清洗、敏感字段不越过 Main 边界 |
| Renderer | 工具卡状态、链接安全、proposal 卡片与 revision 过期状态 |
| Electron E2E | 搜索、Fetch、显式应用、上下文刷新、重启恢复 |
| Packaged E2E | Skill 文件与 DSH 直接依赖在 `app.asar.unpacked` 中可用 |

必须长期保留的安全断言：

- 工具集合精确匹配预期。
- 不出现 Shell、文件写入、子 Agent 和官方裸 `web_fetch`。
- Renderer 不接触 DSH URL、RPC、原始工具参数和原始工具结果。
- 自定义模型密钥不会被发送到未经用户配置的搜索端点。
- proposal 工具执行本身不改变任何项目文件。

---

## 11. 主要风险与停止条件

### DSH rc 版本风险

当前使用 release candidate。新增插件必须固定精确版本，并通过 packaged E2E；不能只验证开发环境。

### Search 成本与延迟

DeepSeek Search Provider 的一次搜索本质上是额外模型请求。需要限制结果数量和无意义重复调用，不能把它当作低成本搜索 API。

### Fetch SSRF

这是 v0.1 中最高风险模块。无法证明私网阻断、重定向检查和 DNS 固定有效时，保持关闭就是正确结果。

### Proposal 原子性

不能用 Renderer 顺序调用多个现有 Outline API 模拟事务。原子领域命令未完成前，只允许展示提案，不开放“应用”按钮。

### 状态污染

不新增项目偏好库。任何为了“更懂作者”而引入的持久状态，都必须先重新讨论产品边界。

---

## 12. 完成定义

v0.1 完成需要同时满足：

1. 用户只在现有 Agent 侧栏中完成全部交互。
2. Agent 能在同一 session 内连续理解，并在新 session 中保持干净。
3. Agent 能按需加载创作 Skill，而不是把所有方法永久注入上下文。
4. Agent 能安全搜索资料并给出可打开的来源。
5. Safe Fetch 通过网络安全测试后才可用。
6. Agent 能形成结构化大纲修改提案。
7. 只有用户明确应用后项目才发生原子修改。
8. 项目事实、会话决定、外部资料和 Agent 推断始终可区分。
9. 不引入长期项目记忆、正式分支、多 Agent 或新的复杂 UI。
10. 开发版、全量测试和打包版 E2E 全部通过。

---

## 13. 实施顺序结论

```text
行为与压缩
→ 创作 Skills
→ Web Search + 来源链接
→ Safe Web Fetch 安全门
→ Outline Proposal + 原子应用
→ 长会话与打包验收
```

该顺序先提升 Agent 的判断方式，再增加外部能力，最后开放受用户确认控制的项目修改。每个阶段都可以独立验收和回退。
