# 仓库运行层与开发层划分

> 状态：2026-08-19 已落地并通过完整验证。

## 目标

项目根目录只保留 GitHub 可见的产品源码、公开开发资产、包管理入口和必须位于仓库根部的工具元数据。本地用户数据、私人维护资料和生成物全部写到仓库外。

## 最终目录

```text
D:/novel/
├─ cuigengji/
│  ├─ src/                 # 后端产品源码
│  ├─ public/              # Renderer 产品源码
│  ├─ electron/            # Electron Main、Preload、IPC、DSH Host
│  ├─ shared/              # Desktop API 契约
│  ├─ dev/
│  │  ├─ architecture/     # 架构事实
│  │  ├─ tests/            # 自动化测试
│  │  ├─ scripts/          # 可公开复现的开发脚本
│  │  └─ docs/             # 设计与交接文档
│  ├─ package.json
│  ├─ package-lock.json
│  └─ playwright.config.js
├─ cuigengji-build/
   ├─ dist/                # Electron Builder 产物
   ├─ test-results/        # Playwright 失败证据和 trace
   └─ playwright-report/   # HTML 报告（生成时出现）
└─ workspace-local/
   └─ cuigengji/
      ├─ runtime/          # 本地开发数据和 DSH 状态
      ├─ development/      # 私人维护资料与历史备份
      ├─ launchers/        # 机器专属启动器
      └─ scripts/          # 机器专属发布维护脚本
```

`node_modules/`、`.git/`、`.github/`、根 README、许可证和工具配置仍保留在仓库根部，这是 Node、Git 和托管平台的约定，不属于产品运行闭包。其中 `.git/` 与 `node_modules/` 是本地目录和 GitHub 展示之间仅有的标准差异。

## 迁移映射

| 原路径 | 当前路径 |
| --- | --- |
| `docs/` | `dev/docs/` |
| `tests/` | `dev/tests/` |
| `architecture/` | `dev/architecture/` |
| `scripts/` | `dev/scripts/` |
| `.backups/` | `../workspace-local/cuigengji/development/backups/` |
| `.private/` | `../workspace-local/cuigengji/development/private/` |
| `.claude/` | `../workspace-local/cuigengji/development/claude/` |
| `author/` | `../workspace-local/cuigengji/development/author/` |
| `data/` | `../workspace-local/cuigengji/runtime/data/` |
| `dist/` | `../cuigengji-build/dist/` |
| `test-results/` | `../cuigengji-build/test-results/` |
| `playwright-report/` | `../cuigengji-build/playwright-report/` |

本地资料采用移动而非删除。`npm run start:electron` 在当前工作区中自动发现外部 `workspace-local/cuigengji/runtime/`；其他环境可用 `CUIGENGJI_DATA_ROOT` 和 `CUIGENGJI_DSH_ROOT` 显式指定。

## 路径约束

1. 产品源码不得 import `dev/`。
2. npm 命令始终从 `cuigengji/` 根目录执行。
3. 仓库根目录不得出现 `data/` 或 `dev/local/`；打包应用使用 Electron `userData/data`，本地开发使用仓库外数据根。
4. Electron Builder 输出固定为 `../cuigengji-build/dist`。
5. Playwright 输出固定为 `../cuigengji-build/test-results` 和 `../cuigengji-build/playwright-report`。
6. DSH 有多项 peer dependencies，打包时完整复制 `node_modules/@deepseek-ai` 到 `app.asar.unpacked`，不能只依赖 Electron Builder 自动推导生产依赖。

## 自动门禁

`dev/tests/architecture/repository-layout.spec.js` 强制检查：

- 根目录不恢复 `docs/tests/architecture/scripts`；
- 四个开发目录均存在于 `dev/`；
- 构建输出仍位于仓库外；
- `dev/` 不进入产品包；
- DSH peer dependency 打包规则没有被删除。

## 验证结果

- preload 新鲜度：通过。
- 运行闭包：62 个 active src、0 个 unreachable src，与清单一致。
- ESLint：0 error。
- Playwright：59/59 通过，其中架构门禁 11/11。
- Windows unpacked package：生成成功。
- 新打包产物的原生 DSH Electron E2E：1/1 通过。
