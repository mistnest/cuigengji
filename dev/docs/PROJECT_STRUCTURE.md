# 催更姬项目结构

> 代码事实基线：2026-08-19。产品入口仅支持 Electron；根目录按运行层与开发层分开。

```text
cuigengji/
├─ public/
│  ├─ index.html                         # Renderer 装配入口
│  └─ js/
│     ├─ app/                            # 启动、全局协调、跨页面用例
│     ├─ pages/                          # 按用户看见的页面和区域分类
│     │  ├─ welcome/
│     │  ├─ workspace/{chapters,editor,outline,worldbook,characters,agent,automation,status-bar}/
│     │  └─ settings/
│     ├─ dialogs/                        # 独立生命周期弹窗
│     └─ shared/                         # 无小说领域语义的 Renderer 工具
├─ shared/desktop-api/
│  ├─ core/                              # 版本、错误码与 schema 工具
│  └─ {app,project,knowledge,configuration,models,agent,automation,exchange}/
├─ electron/
│  ├─ index.js                           # Main 组合入口
│  ├─ preload-src/                       # 八模块 facade 维护源
│  ├─ preload.cjs                        # sandbox 单文件生成产物
│  ├─ ipc/{core,app,project,knowledge,configuration,models,agent,automation,exchange}/
│  └─ intelligence/agent/dsh/            # DSH 宿主与 Gateway
├─ src/
│  ├─ backend/                           # 后端四类八模块
│  ├─ legacy/http/                       # Automation 内部算法兼容区；不暴露 HTTP API
│  └─ server.js                          # Electron Renderer 静态资源服务
├─ data/                                 # 本地开发数据；对应用户端 userData/data
├─ dev/                                  # 不进入产品包的开发层
│  ├─ architecture/                      # 可执行目录与运行闭包清单
│  ├─ tests/                             # architecture/interface/integration/electron
│  ├─ scripts/                           # 启动、生成、验证与发布脚本
│  ├─ docs/                              # 当前设计、迁移结果与交接文档
│  └─ local/                             # 被 Git 忽略的本地维护资料
├─ package.json                          # npm、Electron 与打包入口
└─ playwright.config.js                  # 根级测试运行配置
```

构建产物和测试报告统一输出到同级目录 `../cuigengji-build/`，不写回源码仓库。

## 三层分类

- 前端按页面检索：`app + pages + dialogs + shared`。
- 接口按能力检索：`app/project/knowledge/configuration/models/agent/automation/exchange`。
- 后端保持四类八模块：`domains/{project,knowledge}`、`intelligence/{agent,models,automation}`、`interchange/exchange`、`foundation/{configuration,platform}`。

## 关键入口

- 启动：`npm start`（等价于 `npm run start:electron`）
- Renderer：`public/index.html` → `public/js/app/bootstrap.js`
- Desktop API：`electron/preload-src/entry.cjs`
- IPC：`electron/ipc/<interface-module>/index.js`
- 后端：`src/backend/<group>/<module>/index.js`
- 开发入口：`dev/README.md`
- 架构清单：`dev/architecture/`
- 测试：`dev/tests/`

## 维护规则

1. Renderer 不使用业务 `fetch`、浏览器存储、Node API、Provider SDK 或密钥。
2. `bootstrap.js` 只启动和装配；页面行为进入对应页面/区域目录。
3. IPC 只校验主窗口、解析 schema、调用后端公开入口并封装结果。
4. 接口固定八模块；`core` 不是第九个业务模块。
5. Agent 与 Automation 分离；Obsidian 将来只作为 Knowledge Source 接入。
6. `public/js/modules`、分组式 contract/IPC 旧目录不得恢复。
7. 产品源码不得依赖 `dev/`；`dev/` 可以通过公开入口验证产品源码。
8. 用户数据只进入 `data/` 或 Electron `userData/data`，不得写入 `dev/`。
9. DSH 运行依赖由 `build.extraResources` 复制完整的 `@deepseek-ai` scope，避免 peer dependency 在打包时丢失。
