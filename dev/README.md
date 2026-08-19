# 开发层

`dev/` 保存不会进入 Electron 产品包的公开开发资产。产品运行源码只位于根目录的 `src/`、`public/`、`electron/` 与 `shared/`；本地用户数据和私人维护资料位于仓库外的 `../workspace-local/cuigengji/`。

```text
dev/
├─ architecture/  # 架构事实与运行闭包清单
├─ tests/         # Playwright 架构、接口、集成与 Electron 测试
├─ scripts/       # 可公开复现的启动、生成和检查脚本
└─ docs/          # 设计、迁移和交接文档
```

所有 npm 命令仍从项目根目录执行：

```powershell
npm start
npm run architecture:check
npm test -- --reporter=list
```

构建与测试产物写入同级的 `../cuigengji-build/`：

- `dist/`：Electron Builder 产物
- `test-results/`：Playwright 结果、截图和 trace
- `playwright-report/`：HTML 报告

维护约束：

1. 产品源码不得 import `dev/`。
2. 测试通过产品公开入口引用根目录源码。
3. 架构事实统一维护在 `dev/architecture/`。
4. 个人资料统一放入仓库外的 `../workspace-local/cuigengji/development/`，不得提交密钥、用户数据或构建缓存。
5. 打包时必须完整复制 `node_modules/@deepseek-ai` 到 `app.asar.unpacked`，DSH 的 peer dependencies 不能只依赖 Electron Builder 自动推导。
