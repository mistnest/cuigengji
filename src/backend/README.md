# 后端模块目录

后端按“分类 → 模块 → 能力 → 适配器”组织。正式模块只有八个；跨模块只能从对方 `index.js` 导入。

| 分类 | 模块 |
| --- | --- |
| `domains` | `project`、`knowledge` |
| `intelligence` | `agent`、`models`、`automation` |
| `interchange` | `exchange` |
| `foundation` | `configuration`、`platform` |

目录深度通常为三级；DSH、Obsidian 和 Provider 等适配器允许达到第四级。
