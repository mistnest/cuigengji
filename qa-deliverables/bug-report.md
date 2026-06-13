# Bug Report: 催更姬 v0.1.0 — 测试发现的问题

> 遵循 qa-test-planner skill `templates/bug-report.md` 模板规范
> 测试日期: 2026-06-12

---

## BUG-KEY-001: POST /api/ai/continue 在缺少 API Key 时返回 500 而非 400

**Bug ID:** BUG-KEY-001
**Severity:** Medium
**Priority:** P1 (High)
**Status:** Open
**Found by:** QA Automation Test Suite
**Environment:** Windows 11, Node.js 20, Express server (localhost:8765)

### Description

当调用 `POST /api/ai/continue` 时不提供有效的 API Key，服务器应返回 `400 Bad Request` 并提示 "API key required"。

**实际行为：** 服务器返回 `500 Internal Server Error`。

### Root Cause

在 [src/endpoints/ai.js](src/endpoints/ai.js) 中，`applyAiSecret(config, presetName)` 在 `hasApiKey()` 检查之前被调用。如果 config 中没有 API key，`applyAiSecret` 可能抛异常导致 500 错误。

```javascript
// 当前代码顺序 (有 bug):
const aiConfig = applyAiSecret(config, presetName);  // 先调这个 → 可能 throw
if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
if (!hasApiKey(aiConfig)) return res.status(400).json({ error: 'API key required' });
```

### Steps to Reproduce

1. 启动服务器: `node src/server.js`
2. 发送请求:
```bash
curl -X POST http://127.0.0.1:8765/api/ai/continue \
  -H "Content-Type: application/json" \
  -d '{"text":"test","config":{"provider":"anthropic"}}'
```
3. 观察返回: `500` instead of `400`

### Expected Result

返回 `400` 和 `{"error": "API key required"}`

### Actual Result

返回 `500 Internal Server Error`

### Fix Recommendation

将 `hasApiKey` 检查移到 `applyAiSecret` 之前：

```javascript
// 修复后:
if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
if (!hasApiKey(config)) return res.status(400).json({ error: 'API key required' });
const aiConfig = applyAiSecret(config, presetName);  // 安全的后续调用
```

同样的问题可能存在于其他使用 `applyAiSecret` 的端点（`/plot-suggestions`、`/inspire`、`/summarize` 等），建议一并检查修复。

---

## BUG-CSP-001: CSP 策略阻止 Google Fonts 加载

**Bug ID:** BUG-CSP-001
**Severity:** Low
**Priority:** P2 (Medium)
**Status:** Open
**Found by:** QA Automation Test Suite
**Environment:** Windows 11, Chromium 148

### Description

浏览器的 Content Security Policy 阻止了 Google Fonts 样式表的加载，导致应用使用的字体（Inter、Noto Sans SC、Noto Serif SC）无法从 Google 服务器加载，页面回退到系统默认字体。

### Steps to Reproduce

1. 启动服务器并打开浏览器
2. 打开开发者工具 → Console
3. 观察错误:
```
Loading the stylesheet 'https://fonts.googleapis.com/css2?family=Inter:...&family=Noto+Sans+SC:...&family=Noto+Serif+SC:...' violates the following Content Security Policy directive: "default-src 'self' ..."
```

### Expected Result

Google Fonts 样式表应被允许加载，或应用应自带字体文件。

### Actual Result

CSP 错误被触发，字体回退到系统默认。

### Fix Recommendation

**方案 A（推荐）:** 在 CSP meta 标签中添加 `https://fonts.googleapis.com` 到 `style-src` 和 `https://fonts.gstatic.com` 到 `font-src`:

```html
<meta http-equiv="Content-Security-Policy" content="...
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  ...">
```

**方案 B:** 将字体文件下载到 `public/fonts/` 目录，使用本地路径引用，完全消除对外部 CDN 的依赖。

---

## BUG-UI-001: 快捷命令按钮追加格式与预期不一致

**Bug ID:** BUG-UI-001
**Severity:** Trivial
**Priority:** P3 (Low)
**Status:** Open (可能是设计如此)
**Found by:** QA Automation Test Suite

### Description

点击快捷命令按钮 "续" 后，聊天输入框显示的文本是 "继续写: "（附带冒号和空格）而非 "继续写"。

### Steps to Reproduce

1. 进入工作区
2. 在右侧聊天面板点击 "续" 快捷命令按钮
3. 输入框显示 "继续写: "

### Expected Result

可能是 "继续写" 或 "继续写: "，取决于产品设计意图。

### Actual Result

显示 "继续写: " — 冒号+空格暗示用户在此后继续输入内容，这可能是合理的 UX 设计。

---

## 测试覆盖总结

| 类别 | 测试数 | 通过 | 失败 | 发现 Bug |
|------|--------|------|------|----------|
| API 测试 | 31 | 31 | 0 | 1 (BUG-KEY-001) |
| E2E — Welcome | 2 | 2 | 0 | - |
| E2E — Editor | 4 | 4 | 0 | - |
| E2E — AI Settings | 4 | 4 | 0 | - |
| E2E — Settings Dialog | 2 | 2 | 0 | - |
| E2E — Import Flow | 1 | 1 | 0 | - |
| E2E — Keyboard | 1 | 1 | 0 | - |
| WebApp — Console | 2 | 2 | 0 | 1 (BUG-CSP-001) |
| WebApp — Responsive | 3 | 3 | 0 | - |
| WebApp — Form | 4 | 4 | 0 | 1 (BUG-UI-001) |
| WebApp — CSP/Assets | 3 | 3 | 0 | - |
| **总计** | **58** | **58** | **0** | **3** |
