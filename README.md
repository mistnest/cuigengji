# 催更姬 v1.0

催更姬是一个面向长篇小说创作的本地 AI 编辑器，包含正文编辑、项目管理、世界书、角色卡、预设、上下文记忆、流式写作和设定提取等功能。

## 下载使用

普通用户可以在 GitHub 项目页右侧进入 **Releases** 下载 Windows 版本：

- `催更姬-1.0.0-portable-x64.exe`：免安装版，下载后双击启动。
- `催更姬-1.0.0-setup-x64.exe`：安装版，适合希望安装到系统里的用户。

首次启动会初始化本地数据目录。项目正文、角色卡、世界书、预设、API Key 和调试日志默认只保存在用户本机。

## 开发运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm run start:electron
```

只启动本地 Web 服务：

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:8765
```

## 一键封包 Windows EXE

```bash
npm run package:win
```

封包产物输出到 `dist/`，包含安装版和免安装版 exe。

封包入口会自动完成：

- 清理旧 `dist/`
- 生成项目指纹清单
- 调用 Windows EXE 构建
- 列出本次产物

如果希望封包前先跑 smoke 测试：

```bash
npm run package:win:test
```

底层 Windows 构建脚本仍可单独调用：

```bash
npm run build:win
```

## 项目文档

当前可信结构文档见：

```text
docs/PROJECT_STRUCTURE.md
```

维护文档时请以源码为准，不要沿用旧实验文档或阶段性测试记录。

## 测试

```bash
npm test
npm run test:api
npm run test:e2e
```

## 许可证

本项目使用自定义社区许可，详见 [LICENSE](LICENSE)。

个人使用、学习交流和个人创作可免费使用；公司商用、商业化分发、源码再发布或修改版发布需要取得作者书面许可。
