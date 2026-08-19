# Phase 3：原生 Agent 侧栏视觉壳

> 状态：待评审  
> 前置条件：[Phase 2](./phase-2-desktop-api.md) 契约已冻结  
> 后续阶段：[Phase 4 流式交互接管](./phase-4-streaming-takeover.md)

## 1. 阶段目标

先做一套可在真实 Electron 主窗口里审阅的 Agent 窄侧栏，但不接管模型发送。重点确认视觉方向、信息密度、交互位置、中文排版和各种状态，而不是边写 UI 边改后台协议。

本阶段结束时，评审者可以在同一应用中看到原生侧栏效果，并通过受控预览模式切回当前官方 DSH 嵌入界面。

## 2. 设计方向

参考 DSH 的视觉语言，但不照搬其完整工作台：

- 保留：克制暗色、柔和边界、圆角胶囊、轻量状态点、折叠式 reasoning/tool 卡片、低干扰按钮。
- 删除：左侧全局导航、workspace 管理、插件设置、全局搜索、开发者诊断和适合宽屏的多栏布局。
- 新增：当前章节/上下文状态、小说资料查询摘要、中文长文排版、适合 360–520 px 的输入区。
- 融合：颜色、字号和焦点样式优先使用催更姬现有设计 token，避免 Agent 像另一个应用贴在旁边。

## 3. 信息架构

```text
AgentSidebar
├─ Header
│  ├─ RuntimeStatus
│  ├─ Title
│  ├─ NewSessionButton
│  └─ SessionMenuButton
├─ ContextBar
│  ├─ CurrentChapter
│  └─ ContextSyncStatus
├─ ConversationViewport
│  ├─ EmptyState
│  ├─ UserMessage
│  ├─ AssistantMessage
│  │  ├─ ReasoningDisclosure
│  │  └─ AnswerBody
│  ├─ ToolActivityCard
│  └─ ErrorNotice
└─ Composer
   ├─ ContextChips
   ├─ Textarea
   ├─ ModeAction
   ├─ SendButton
   └─ CancelButton
```

常驻信息只保留标题、上下文状态、对话和输入；会话历史放在按需弹层中，不长期占用侧栏宽度。

## 4. 目标目录与职责

```text
public/js/modules/intelligence/agent/
├─ workbench/agent-workbench.js
│  # mount/unmount、项目/标签可见性、子组件编排
├─ conversation/agent-conversation.js
│  # 消息列表、空状态、reasoning/tool/error 视图
├─ composer/agent-composer.js
│  # textarea、键盘操作、发送/停止按钮视图
├─ state/agent-store.js
│  # 纯状态与订阅；Phase 3 使用 fixture，Phase 4 使用真实事件
└─ agent-sidebar.css
   # Agent 模块独立样式，禁止继续把大量样式堆进 editor.css
```

`agent-workbench.js` 不再负责像素 bounds、ResizeObserver -> Main IPC 或 WebContents 显隐。Phase 3 可暂留旧逻辑用于回退，但新 UI 代码不能调用它。

## 5. DOM 骨架

建议把 `#dsh-agent-host` 逐步改为语义中性的 `#agent-sidebar-root`。为避免同阶段破坏旧嵌入，可先保留外层 ID，并在内部挂载：

```html
<section class="agent-sidebar" aria-label="小说创作 Agent">
  <header class="agent-sidebar__header"></header>
  <div class="agent-context-bar"></div>
  <div class="agent-conversation" role="log" aria-live="polite"></div>
  <form class="agent-composer"></form>
</section>
```

要求：

- 一个页面只能有一个活动输入框。
- conversation 使用 `role="log"`，但流式每个 token 不触发完整屏幕阅读器播报。
- 图标按钮都有中文 `aria-label` 和 tooltip。
- 状态不只靠颜色表达，必须有文字或可访问名称。

## 6. 视觉规格

### 宽度与布局

| 场景 | 宽度 | 行为 |
|---|---:|---|
| 最窄 | 360 px | 隐藏次要文字；按钮保持至少 32 px 命中区 |
| 常用 | 419 px | 默认设计基准 |
| 较宽 | 520 px | 增加正文行长，不切双栏 |

- 不出现横向滚动。
- Header、ContextBar、Composer 固定；只有 ConversationViewport 滚动。
- Composer 高度随内容增长，到约 8 行后内部滚动。
- 系统缩放 100%、125%、150% 均保持发送/停止按钮可见。

### 字体与节奏

- 正文继承催更姬中文字体栈，建议 14–15 px、1.65–1.75 行高。
- 元信息 12 px 左右，使用次级颜色。
- assistant 正文不包成高对比大气泡，降低长文阅读噪声。
- user 消息可使用弱底色和较小圆角区分。
- 段落、列表、引用、代码和分隔线有稳定间距，但第一版不追求完整 Markdown 编辑器能力。

### 颜色与状态

建议从现有 CSS 变量派生：

```text
--agent-surface
--agent-surface-raised
--agent-border
--agent-text
--agent-muted
--agent-accent
--agent-success
--agent-warning
--agent-danger
```

禁止在组件里散落固定 RGB。状态点：ready=绿色、starting/reconnecting=黄色动画、failed=红色、stopped=灰色，并配文字。

## 7. 需要展示的固定状态

Phase 3 的预览 fixture 至少覆盖：

1. 未打开项目。
2. 项目已打开，DSH 启动中。
3. 未配置 API Key。
4. 新会话空状态。
5. 普通 user + assistant 长回复。
6. reasoning 折叠与展开。
7. `search_project_knowledge` / `get_project_knowledge` 执行中、成功、失败。
8. assistant 流式生成中。
9. Provider 错误、Runtime 崩溃和自动重连。
10. 有多条历史会话的选择弹层。

fixture 必须是纯虚构文本，且只在明确的 Electron 开发预览模式或 Playwright mock 中启用。普通生产启动不能通过 query string/localStorage 打开 fixture。

## 8. 关键交互

### Header

- 状态点/状态文字点击后展示简短诊断，不暴露端口和路径。
- `＋` 新建会话，需要生成中时先二次确认或禁用。
- `···` 打开会话列表与重试/重启入口；设置仍进入现有 AI 设置标签，不复制设置页。

### ContextBar

- 显示当前章节名称或“未选择章节”。
- 显示“上下文已同步 / 正在同步 / 同步失败”。
- 点击只展开本轮注入范围摘要，例如当前章节、项目摘要、冷资料条数，不展示整份 system prompt。

### Reasoning

- 默认折叠，标题为“思考过程”。
- 流式 reasoning 时显示轻量进行中状态。
- 切 session 后保持默认折叠，不永久保存展开状态。

### Tool Card

- 只展示白名单中文名称：“搜索项目资料”“读取项目资料”。
- 默认展示 query/条目标题等安全摘要，不显示快照绝对路径和原始 JSON。
- 成功、失败、取消都有明确状态。

### Composer

- Enter 发送；Shift+Enter 换行；IME composition 中 Enter 不发送。
- 空白输入禁用发送。
- 自动增高但不挤走 Header。
- Phase 3 按钮只表现状态，不发真实请求，并明确标注“视觉预览”。

## 9. 渲染与安全原则

- 用户文本一律通过 `textContent`。
- 流式 assistant 文本在完成前使用纯文本节点增量更新。
- Phase 3 不引入 HTML Markdown 渲染；Phase 4 如加入 Markdown，必须 `html:false` 并限制链接协议。
- 不使用 `innerHTML` 拼接模型输出、tool args 或错误信息。
- 外链只能走现有受控 `app.openExternal`，不允许模型内容直接导航当前页面。
- 不加载 DSH Web UI 的 CSS/字体/脚本，也不导入其 React primitives。

## 10. 预览开关

建议使用 Main 启动时读取的开发环境变量形成 bootstrap feature flag：

```text
CUIGENGJI_AGENT_UI=native-preview
```

约束：

- 仅非打包开发模式接受该值。
- Renderer 不能用 localStorage 或 URL 修改开关。
- 默认仍为当前官方嵌入 UI，直到 Phase 4 验收通过。
- Playwright 可通过启动环境稳定选择预览模式并注入 Desktop API fixture。

## 11. 测试与评审材料

### 组件行为

- mount/unmount 不重复绑定事件。
- IME、Enter、Shift+Enter 行为正确。
- reasoning/tool disclosure 可键盘操作。
- 空状态、错误和长文本切换不留下旧 DOM。
- 自动滚动只在用户接近底部时发生；用户上翻后新内容不强制拉回底部。

### 视觉回归

Playwright 截图矩阵：

```text
360 / 419 / 520 px
100% / 125% / 150% scale
empty / normal / streaming / tool / error / session-menu
```

截图作为测试产物，不把包含真实项目文字的图片提交仓库。

### 人工评审

- 与编辑器整体主题是否协调。
- 419 px 下对话是否比完整 DSH 页面明显更清晰。
- reasoning/tool 信息是否够用但不过量。
- 新会话、历史、停止和设置入口是否容易发现。
- 中文长文的行高、段间距和滚动体验是否舒适。

## 12. 阶段产物

- 原生侧栏静态组件、状态 store 和独立 CSS。
- 受控开发预览模式。
- 十种状态 fixture 和视觉截图矩阵。
- 视觉评审记录及需要调整的 token/布局清单。

## 13. 验收清单

- [ ] 360–520 px 无横向滚动和控件遮挡。
- [ ] 100%/125%/150% 缩放均可使用。
- [ ] 六类核心内容状态和四类 Runtime/空状态均可预览。
- [ ] 模型/fixture 文本不通过不安全 innerHTML 注入。
- [ ] 新 UI 不加载 DSH 网页或 React UI 包。
- [ ] 预览开关不能由普通生产 Renderer 自行开启。
- [ ] 评审者确认视觉方向后才开始接真实 Gateway。

## 14. 回退方法

关闭 `native-preview` 启动开关，当前官方 DSH 嵌入路径完全不变。阶段文件可保留为未启用代码；若整体回退，删除新组件/CSS/fixture，不触碰 DSH Runtime 与会话数据。

## 15. 进入下一阶段的条件

人工视觉评审通过，并冻结第一版组件结构和必要事件字段；不允许 Phase 4 为了临时适配 Runtime 再让 UI 读取 DSH 原始 frame。

