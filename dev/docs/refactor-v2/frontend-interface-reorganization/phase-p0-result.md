# Phase P0 结果：页面与接口架构基线

> 状态：完成  
> 日期：2026-08-18  
> 生产逻辑：未移动、未修改

## 1. 完成结果

P0 已把评审确定的结构转换为机器可读基线：

- 前端目标为 `app + pages/{welcome,workspace,settings} + dialogs + shared`。
- Workspace 固定为 `chapters/editor/outline/worldbook/characters/agent/automation/status-bar` 八个可见区域。
- 接口目标展平为 `app/project/knowledge/configuration/models/agent/automation/exchange` 八个正式模块。
- 后端继续保持现有四类八模块；接口清单显式记录每个接口模块映射到哪个后端模块。
- 当前兼容目录保留到对应迁移阶段，不在 P0 移动或删除运行文件。

## 2. 新增架构事实

| 文件 | 内容 |
| --- | --- |
| `dev/architecture/frontend-pages.json` | 页面、Workspace 区域、Dialog/Shared 清单和允许接口 |
| `dev/architecture/interface-modules.json` | 八接口模块、当前路径、目标路径、后端映射和 preload 约束 |
| `dev/architecture/frontend-bootstrap-ownership.json` | bootstrap 顶层函数的迁移目标 |
| `dev/architecture/README.md` | 架构事实文件的维护入口 |

`frontend-bootstrap-ownership.json` 当前覆盖 `public/js/app/bootstrap.js` 的 228 个顶层函数。测试同时锁定函数数量、名称 SHA-256 和行范围唯一归属；新增、删除或移动函数时必须同步更新迁移归属，避免 bootstrap 继续无审查增长。

## 3. 架构测试调整

新增 `dev/tests/dev/architecture/frontend-interface-target.spec.js`：

1. 校验三个页面和八个接口模块名称。
2. 校验页面/工作区区域引用的接口都存在。
3. 校验八个接口模块一一映射到当前后端八模块。
4. 校验目标 contract/preload/IPC 路径是展平结构。
5. 校验当前兼容 contract/IPC 入口仍存在。
6. 校验 bootstrap 每个顶层函数恰好只有一个页面时代目标。

原 `module-layout.spec.js` 的同名目录检查被明确标记为 P0 兼容路径门禁；P1 建立新目录后再按迁移状态逐步替换，不能误认为旧的四类前端目录仍是最终目标。

## 4. 验证结果

```text
targeted architecture          6 passed
complete architecture          9 passed
full test suite               53 passed
runtime closure               69 active / 22 unreachable
ESLint --quiet                 0 errors
git diff --check               no whitespace errors
```

Electron smoke、原生 DSH Agent E2E、DSH runtime contract、接口安全和 legacy baseline 都包含在 53 项全量测试中并通过。

## 5. P0 边界

- 没有创建 `public/js/pages`、`shared/desktop-api/<flat-module>` 或 `electron/ipc/<flat-module>` 生产入口；它们属于 P1。
- 没有移动 Agent Renderer 文件，也没有修改 DSH Runtime。
- 没有增加 Automation contract 或删除旧 HTTP；它们属于 P6。
- 没有接入 Obsidian。
- 没有修改真实项目数据、密钥或用户配置。

## 6. 下一阶段

P1 只建立新目录、公开入口和有明确删除阶段的兼容转发，不迁移大块页面逻辑。开始 P1 前应先决定 sandbox preload 的源文件组织是否在 P1 仅预留目录，实际 bundling spike 仍在 P2 完成。
