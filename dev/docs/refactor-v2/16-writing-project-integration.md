# writing 项目接入记录

当前可继续研究和修改的副本是：

`/scratch/wangzy/wzy/scalestool_trial_2026-07-24/writing/cuigengji-writing`

上游重构基线保留在 `third_party/community/cuigengji-master`，旧版保留在
`third_party/community/cuigengji`。后续改动集中在工作副本，不覆盖这两个基线。

## 已接入模块

- DSH 仍是单 Agent；`writing-single-agent` 是中文写作契约，原有方向、人物、冲突、节奏和商业网文 Skill 作为同一 Agent 的按需自检工具，不创建 Reviewer 或子 Agent。
- `plugins/novel-graph-mcp` 是本地 stdio MCP。每本小说按 `novelId` 分目录，以快照、追加日志和目录锁保存世界书/角色卡节点及关系边；`commit_changes` 支持带图版本和实体版本的原子增删改。
- `plugins/writing-project-mcp` 是正文/章节/卷 CRUD stdio MCP。它只持有 Electron 为当前项目签发的 loopback bearer capability，不能读取项目文件或使用 Shell；所有写入都复用章节域服务的 CAS、备份和事件。
- DSH 通过 `@deepseek-ai/dsh-mcp-client` 挂载两个 MCP，模型工具名固定为 `mcp__novel_graph__*` 与 `mcp__writing_project__*`。图谱默认位于应用数据根的 `novel-graphs`，多个 DSH session 可以共享同一本小说。

## 本地运行

```bash
source /scratch/wangzy/wzy/scalestool_trial_2026-07-24/writing/env.sh
export CUIGENGJI_DSH_NODE="$NODE_HOME/bin/node"
cd /scratch/wangzy/wzy/scalestool_trial_2026-07-24/writing/cuigengji-writing
```

图谱相关环境变量：

- `CUIGENGJI_NOVEL_GRAPH_ENABLED=0`：临时关闭图谱；默认在插件存在时启用。
- `CUIGENGJI_NOVEL_GRAPH_DB=/absolute/path`：指定共享图谱根目录。
- `CUIGENGJI_NOVEL_GRAPH_SERVER=/absolute/path/lib/bin.js`：指定 MCP server。
- `CUIGENGJI_NOVEL_GRAPH_COMMAND=/absolute/path/node`：指定 MCP 子进程命令。
- `CUIGENGJI_NOVEL_GRAPH_RESULTS_ROOT=/absolute/path`：指定历史结果目录（仅图谱目录路由需要时使用）。
- `CUIGENGJI_WRITING_PROJECT_ENABLED=0`：诊断时临时关闭正文 MCP；默认开启。

## 验收命令

```bash
pnpm --dir plugins/novel-graph-mcp test
npm run build:ts
npm run ts:check-generated
npm run typecheck
npm run architecture:check
npm run lint
npx playwright test --grep-invert '@smoke' --reporter=line
```

Electron smoke 测试需要本机已下载且可执行的 Electron 二进制；在当前 Linux 容器中该二进制不可用，因此与 Electron 启动有关的测试应在桌面开发机另行运行。
