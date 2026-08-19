# 前端页面化与接口模块化整理计划

> 文档状态：P0–P7 已全部实施并通过门禁；结果见 `frontend-interface-reorganization/phase-p*-result.md`。  
> 基线日期：2026-08-18。  
> 范围：Electron Renderer、Desktop API contract、sandbox preload、Electron IPC。  
> 不在本轮范围：后端四类八模块重构、Obsidian 接入、DSH Runtime 再设计。

## 0. 已确认的分类结论

本轮不再要求前端、接口、后端使用完全相同的物理目录，因为三层的检索方式不同：

```text
前端      按用户看到的页面和区域分类
接口      按对外提供的业务能力分类
后端      保持现有“分类 → 模块 → 能力 → 适配器”结构
```

三层通过 Desktop API 契约对应，不通过相同文件夹名称强行绑定。

### 前端目标

```text
app
pages/{welcome, workspace, settings}
dialogs
shared
```

### 接口目标

```text
core                         # 协议内核，不算业务模块
app
project
knowledge
configuration
models
agent
automation
exchange
```

接口共有八个正式模块；后端仍保持原来的四类八模块，不在本轮展平。

## 1. 当前问题

### 1.1 前端

- `public/js/app/bootstrap.js` 同时包含欢迎页、工作区、章节、编辑器、大纲、世界书、角色卡、设置、Provider、Automation、导入导出和公共 UI。
- 现有 `public/js/modules` 已建立后端同名目录，但多数业务仍在 bootstrap，目录与实际所有权不一致。
- 找一个可见功能时，维护者需要先理解 `domains/intelligence/foundation`，再回到约 5,000 行以上的 bootstrap 搜索实现。
- 页面状态、领域实体状态、弹窗状态和跨模块协调状态集中在同一闭包，修改一个区域容易影响其他区域。
- Agent 已经独立，但当前仍位于后端式目录；迁移时只移动物理位置和入口，不重写内部逻辑。

### 1.2 接口

- `shared/desktop-api` 主要定义 channel 常量，缺少统一的 input/output/event DTO 和运行时 schema。
- `electron/preload.cjs` 手工镜像所有 channel，同时包含 invoke、订阅和所有 facade 方法。
- sandbox preload 不能在运行时任意加载本地模块，因此不能简单把 `preload.cjs` 拆成多个 `require('./module.cjs')`。
- 当前 facade 名称是 `projects/chapters/outlines/workspaces/references/settings/ai/agent` 等平铺对象，没有明确的八模块归属。
- `intelligence/automation` 没有正式 contract/IPC，仍通过唯一允许的旧 HTTP adapter 运行。
- 现有架构测试假设前端、contract、IPC、后端必须共享四类八模块目录；该假设与新的页面式前端方案冲突。

## 2. 前端目标目录

```text
public/js/
├─ app/
│  ├─ bootstrap.js                    # 最终只负责启动与组装
│  ├─ app-context.js                  # 当前 page/projectId/chapterId 等协调状态
│  ├─ page-manager.js                 # welcome/workspace 页面切换
│  └─ composition/                    # 跨页面、跨接口用例
│     ├─ open-project.js
│     ├─ switch-chapter.js
│     ├─ save-workspace.js
│     └─ refresh-agent-context.js
│
├─ pages/
│  ├─ welcome/
│  │  ├─ index.js
│  │  ├─ welcome-page.js
│  │  ├─ project-list.js
│  │  └─ create-project-dialog.js
│  │
│  ├─ workspace/
│  │  ├─ index.js
│  │  ├─ workspace-page.js
│  │  ├─ workspace-store.js
│  │  ├─ chapters/
│  │  ├─ editor/
│  │  ├─ outline/
│  │  ├─ worldbook/
│  │  ├─ characters/
│  │  ├─ agent/
│  │  ├─ automation/
│  │  └─ status-bar/
│  │
│  └─ settings/
│     ├─ index.js
│     ├─ settings-page.js
│     ├─ general-settings.js
│     ├─ appearance-settings.js
│     ├─ model-settings.js
│     └─ prompt-settings.js
│
├─ dialogs/
│  ├─ import-export/
│  ├─ prompt-editor/
│  ├─ regex-editor/
│  ├─ extraction-result/
│  └─ contact-author/
│
└─ shared/
   ├─ desktop/                         # DesktopApi facade 获取与错误转换
   ├─ ui/                              # toast、confirm、tooltip、modal
   ├─ state/                           # 通用订阅/不可变更新工具
   ├─ formatting/                      # 字数、文件名、文本格式化
   └─ security/                        # 安全文本和 DOM 渲染
```

### 2.1 页面边界

#### `pages/welcome`

只拥有欢迎页可见状态：项目列表、搜索、最近打开、新建项目弹窗和从文档创建项目。它可以调用 `project` 与 `exchange` 接口，但不能保存章节、模型或 Agent 状态。

#### `pages/workspace`

负责主创作页面布局和区域组合。`workspace-page.js` 只装配区域；实体状态分别由各区域持有：

| 区域 | 职责 | 允许调用的接口模块 |
| --- | --- | --- |
| `chapters` | 卷章树、选择、删除、排序 | `project` |
| `editor` | 标题、正文、dirty、revision、保存 | `project` |
| `outline` | 大纲树、节点编辑、重排 | `project` |
| `worldbook` | 世界书列表、条目和分组 | `knowledge`、`exchange` |
| `characters` | 角色卡列表、详情和分组 | `knowledge`、`exchange` |
| `agent` | 原生 Agent 会话、消息、工具卡和取消 | `agent` |
| `automation` | 续写、灵感、提取和 Job 进度 | `automation` |
| `status-bar` | 字数、保存状态、连接状态投影 | 只消费页面状态，不直接持久化 |

#### `pages/settings`

按用户看到的设置页签拆分。一般设置和外观调用 `configuration`；模型设置调用 `models + configuration`；Prompt/预设调用 `configuration`。设置页不能直接控制 DSH 子进程。

### 2.2 Dialog 与 Shared 边界

- `dialogs` 只放跨页面、具有独立打开/关闭生命周期的弹窗。
- 世界书详情、角色详情等只服务工作区区域的弹层留在对应区域内，不全部塞进全局 dialogs。
- `shared` 只能放无小说业务语义的能力；出现 `chapter/worldbook/agent/provider` 等业务名时不得进入 shared。
- 页面专属 CSS 与页面放在一起；全局 design token、字体和窗口基础布局保留在 `public/css`。

### 2.3 前端公开入口

每个页面和工作区区域必须有 `index.js`。外部只能通过 `index.js` 使用它，不能跨区域导入内部 store/controller。

```text
app/composition → pages/*/index.js
workspace-page  → workspace/<area>/index.js
area            → DesktopApi 对应接口模块
```

`app-context` 只保存当前页面、`projectId`、`chapterId` 和正在进行的跨页面操作，不保存章节正文、世界书、角色卡、会话历史或 API 配置。

## 3. 接口目标目录

接口分为 contract、preload facade 和 IPC 三个物理边界，八个模块名称保持一致。

### 3.1 Contract

```text
shared/desktop-api/
├─ core/
│  ├─ version.js
│  ├─ errors.js
│  ├─ result.dto.js
│  └─ schema.js
├─ app/
├─ project/
├─ knowledge/
├─ configuration/
├─ models/
├─ agent/
├─ automation/
└─ exchange/
```

每个正式模块统一包含：

```text
MODULE.md                       模块职责、权限和错误边界
index.js                        唯一公开入口
*.contract.js                   method/channel/event 常量
*.dto.js                        input/output/event 字段和构造器
*.schema.js                     运行时 payload 校验
```

### 3.2 Preload

由于当前 BrowserWindow 使用 sandbox，运行时 preload 仍必须是单一 bundle：

```text
electron/
├─ preload.cjs                  # Electron 实际加载的生成/打包结果
└─ preload-src/
   ├─ entry.cjs
   ├─ core/
   │  ├─ invoke.cjs
   │  └─ subscriptions.cjs
   ├─ app.cjs
   ├─ project.cjs
   ├─ knowledge.cjs
   ├─ configuration.cjs
   ├─ models.cjs
   ├─ agent.cjs
   ├─ automation.cjs
   └─ exchange.cjs
```

实施前先做一个最小 sandbox preload bundling spike。原则是：

- `preload-src` 是维护源；`preload.cjs` 是 Electron 加载的单文件产物。
- 开发启动、测试和打包前都要校验 preload bundle 没有过期。
- 如果不引入 bundler，则保持单一 `preload.cjs`，但由 module descriptor 生成；禁止在 sandbox 中依赖不可用的本地 `require`。
- 无论采用哪种生成方式，都不向 Renderer 暴露通用 `invoke`、`ipcRenderer` 或任意 channel。

### 3.3 IPC

```text
electron/ipc/
├─ core/
│  ├─ guard.js
│  ├─ result.js
│  └─ validation.js
├─ app/
├─ project/
├─ knowledge/
├─ configuration/
├─ models/
├─ agent/
├─ automation/
└─ exchange/
```

每个模块有自己的 `index.js` 和能力级 `*.handlers.js`。handler 只做：

1. 校验调用来自主窗口可信 main frame。
2. 使用对应 contract schema 校验 payload。
3. 调用后端模块公开 `index.js` 或 Agent Gateway。
4. 返回统一 result/error envelope。

IPC 不拼 Prompt、不持有 UI 状态、不读取任意 Renderer 路径，也不返回 secret、绝对路径和内部 stack。

## 4. 八个接口模块

### 4.1 `app`

应用启动信息、版本、菜单命令、打开外部 HTTPS 链接和窗口级语义事件。文件选择不属于 app，归 exchange。

### 4.2 `project`

内部能力为 `projects / chapters / outlines / workspace`。目标 facade：

```js
DesktopApi.project.projects.list()
DesktopApi.project.chapters.update()
DesktopApi.project.outlines.reorder()
DesktopApi.project.workspace.save()
```

### 4.3 `knowledge`

内部能力为 `worldbooks / characters / references`。未来 Obsidian 只会作为后端 knowledge source 增加受控 DTO，不向 Renderer 暴露 Vault 对象或路径。

### 4.4 `configuration`

内部能力为 `preferences / presets / secrets`。Secret 只允许保存、删除和查询 `hasKey`，永远不提供 reveal 方法。

### 4.5 `models`

内部能力为 `providers / catalog / connection`，负责模型列表、Provider 元数据、连接测试和代理探测。它不保存密钥，也不启动 Agent。

### 4.6 `agent`

内部能力为 `runtime / sessions / turns / events`：

```js
DesktopApi.agent.runtime.status()
DesktopApi.agent.sessions.list()
DesktopApi.agent.turns.prompt()
DesktopApi.agent.events.subscribe()
```

继续使用语义 `AgentUiEvent`，禁止暴露 DSH URL、RPC、WebSocket、原始工具结果或密钥。

### 4.7 `automation`

内部能力为 `writing / ideas / extraction / jobs`。与 Agent 完全分开；Automation 任务不复用 Agent Runtime session。

### 4.8 `exchange`

内部能力为 `imports / exports`。原生对话框、绝对路径和文件读写只存在于 Main；Renderer 只接收导入结果、预览、冲突和导出状态 DTO。

## 5. 前端页面到接口/后端的映射

| 前端位置 | 接口模块 | 后端模块 |
| --- | --- | --- |
| `pages/welcome` | `app`、`project`、`exchange` | `platform`、`project`、`exchange` |
| `pages/workspace/chapters` | `project` | `project` |
| `pages/workspace/editor` | `project` | `project` |
| `pages/workspace/outline` | `project` | `project` |
| `pages/workspace/worldbook` | `knowledge`、`exchange` | `knowledge`、`exchange` |
| `pages/workspace/characters` | `knowledge`、`exchange` | `knowledge`、`exchange` |
| `pages/workspace/agent` | `agent` | `agent` + Electron DSH Gateway |
| `pages/workspace/automation` | `automation` | `automation` |
| `pages/settings/general` | `configuration` | `configuration` |
| `pages/settings/models` | `models`、`configuration` | `models`、`configuration` |
| `dialogs/import-export` | `exchange` | `exchange` |

映射是允许依赖清单，不表示页面必须调用所有列出的模块。架构测试应根据该表阻止页面访问未声明接口。

## 6. 分阶段实施计划

### Phase P0：冻结现状与调整架构规则

只改文档、manifest 和测试基线，不移动生产逻辑。

- 在 `frontend-interface-reorganization/phase-p0-result.md` 记录迁移前事实；迁移完成后不再保留会误导维护者的旧路径地图。
- 新建 Renderer 页面清单和 Interface 八模块清单。
- 修改 `module-layout.spec.js`：后端继续校验四类八模块；前端改为校验 pages/dialogs/shared；contract 与 IPC 改为校验展平的八接口模块。
- 增加页面到接口的允许依赖矩阵测试。
- 记录 `bootstrap.js` 每个函数的目标页面/区域。

验收：架构测试表达新设计，但运行时闭包、Electron 行为和全量测试保持不变。

### Phase P1：建立新目录和兼容入口

- 建立 `pages / dialogs / shared` 空壳与公开 `index.js`。
- 建立展平后的 contract 和 IPC 八模块目录。
- 暂不删除旧目录；旧入口通过显式兼容层转发到新入口。
- 兼容层必须标明删除 Phase，不允许新代码依赖旧路径。

验收：无 UI 行为变化；旧测试与新入口测试同时通过；运行闭包不出现重复实现。

### Phase P2：整理 interface core、contract 与 preload

- 为八模块补齐 channel、DTO、schema、错误和事件契约。
- 做 sandbox preload bundling spike，确定单文件生成方式。
- 生成新的嵌套 facade，同时保留旧 facade 的短期只读/转发别名。
- IPC 接入运行时 schema，先覆盖 app/project/configuration，再覆盖其他模块。
- 每个方法建立 contract → preload → handler 一致性测试。

验收：preload bundle 可在开发、测试、打包环境加载；错误映射、订阅取消和 trusted-frame 门禁通过。

### Phase P3：迁移 welcome、shared 和 app shell

- 迁移欢迎页项目列表、创建/删除项目和最近访问排序。
- 提取 toast、confirm、tooltip、modal、格式化和安全 DOM 工具。
- 建立 `app-context/page-manager`，移除 bootstrap 中的页面切换和公共 UI 实现。
- 导入文档创建项目仍通过 exchange，不让 welcome 读取文件路径。

验收：欢迎页创建、删除、导入、进入工作区和菜单 smoke 通过。

### Phase P4：迁移 workspace 的 project 区域

- 迁移 chapters、editor、outline、status-bar。
- 将 dirty/revision/save 归 editor；章节树只负责导航和排序；大纲维护自己的 revision。
- 建立 `open-project/switch-chapter/save-workspace` composition，用 ID 和 DTO 协调区域。
- 保存章节后由 composition 通知 Agent 刷新，不让 editor 导入 Agent 内部代码。

验收：章节 CRUD/排序、revision 冲突、自动保存、切章、大纲和 Agent context refresh 通过。

### Phase P5：迁移 knowledge、settings、dialogs 和 Agent 物理位置

- 迁移 worldbook、characters 和相关详情/分组 UI。
- 迁移 general/appearance/model/prompt 设置页面。
- 迁移 import-export、Prompt/Regex 编辑器和联系作者弹窗。
- 将现有 Agent 原生侧栏移动到 `pages/workspace/agent`，保持 store/conversation/composer/workbench 结构与行为不变。
- 更新脚本入口和运行闭包，不重新引入 DSH Web UI。

验收：资料 CRUD、设置、导入导出、Agent 全量接口/E2E 和单 Renderer 约束通过。

### Phase P6：Automation 正式接口迁移

- 先建立 `automation/{writing,ideas,extraction,jobs}` contract、DTO、schema 和 IPC。
- 按 operation 逐个迁移续写、补写、灵感、情节候选、摘要、提取与 Job。
- 每迁移一项，就增加流式/取消/错误/恢复测试并关闭对应旧 HTTP 路径。
- 全部完成后删除 `legacy-automation-runtime.js` 和 Renderer 网络例外。

验收：Renderer 零业务 `fetch`；Automation 不依赖 Agent session；旧 `/api/ai|chat|debug` 不可达。

### Phase P7：删除旧目录与退出 bootstrap

- 删除 `public/js/modules` 中已迁移且不可达的前端旧目录。
- 删除 `shared/desktop-api`、`electron/ipc` 的旧四类镜像和 facade 兼容别名。
- `bootstrap.js` 只剩模块装配、初始启动和顶层错误恢复。
- 更新 `public/index.html`、运行闭包、模块导航和接手文档。
- 扫描重复状态、深度导入、旧 channel、旧 API 名称和过期 WebContentsView 文档。

验收：全量测试、架构门禁、lint、Electron E2E、Windows 打包和 packaged E2E 全部通过。

## 7. 迁移兼容和删除规则

迁移期允许短暂存在旧、新 facade，但必须遵守：

1. 新页面只能调用新 `DesktopApi.<module>` facade。
2. 旧 alias 只转发，不拥有状态、不转换业务语义。
3. 每个 alias 在代码和计划中标记删除 Phase。
4. 同一实体只能有一个 store 真值；禁止新旧页面同时写入。
5. 一个区域迁移完成后立即更新入口和测试，不长期保留两套 DOM listener。
6. 删除旧目录前先用运行闭包和全文检索确认不可达，不修改用户数据目录。

## 8. 架构门禁

计划新增或调整以下规则：

- 后端继续执行现有 module manifest、public index 和 dependsOn 检查。
- 前端检查 `pages/welcome|workspace|settings`、dialogs 和 shared 的入口与最大深度。
- workspace 区域只能消费映射表允许的 Interface module。
- 页面之间不得导入对方内部 store；跨页面只通过 app composition。
- contract、preload facade、IPC handler 必须属于同一个八模块名称。
- preload 产物必须与维护源一致，且不能暴露通用 IPC。
- Renderer 禁止 Node、`ipcRenderer`、业务 `fetch`、localStorage/sessionStorage 权威存储和绝对路径。
- Agent 继续禁止 DSH URL/RPC/WebSocket/内部包；Automation 在 P6 后移除唯一 HTTP 例外。
- 外部/模型文本只能通过安全 DOM 渲染，不允许直接拼接进 `innerHTML`。

## 9. 每阶段验证

每个 Phase 至少执行：

```powershell
npm.cmd run lint -- --quiet
npm.cmd run architecture:check
npm.cmd test -- --reporter=list
```

涉及 Electron 入口、preload、Agent 或脚本装配的阶段还必须执行：

```powershell
npm.cmd run package:win
$env:CUIGENGJI_PACKAGED_EXECUTABLE=(Resolve-Path '..\cuigengji-build\dist\win-unpacked\催更姬.exe').Path
npx.cmd playwright test dev/tests/electron/ --reporter=list
```

不得用“目录已经移动”代替行为验收。页面打开、项目/章节保存、设置、导入导出、Agent 流式回复和 Automation 任务必须从实际 Electron 用户流程验证。

## 10. 推荐执行顺序与停点

```text
P0 架构基线
 → P1 新目录/兼容入口
 → P2 接口核心与 preload
 → P3 welcome/shared/app
 → P4 workspace project 区域
 → P5 knowledge/settings/dialogs/agent
 → P6 automation
 → P7 删除旧目录和最终验收
```

正式工作建议一次只批准并实施一个 Phase。每个 Phase 完成后提交文件清单、旧路径删除清单、测试结果和下一阶段风险，再进入下一阶段。
