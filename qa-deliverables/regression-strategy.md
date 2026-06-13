# Regression Testing Strategy: 催更姬 v0.1.0

> 遵循 playwright-regression-testing skill 规范 (`references/regression-strategy.md`)

**Created:** 2026-06-12
**Author:** QA Automation Engineer

---

## 1. 回归测试类型

| 类型            | 触发条件                               | 范围                          |
| --------------- | -------------------------------------- | ----------------------------- |
| **Corrective**  | 环境变更 (Node.js 版本升级、依赖更新)  | 全量 suite 验证无破坏         |
| **Progressive** | 新功能加入 (新增 AI provider、新端点)  | 现有测试 + 新功能测试         |
| **Selective**   | 特定代码变更 (git diff 分析)           | 变更模块 + 依赖测试           |
| **Complete**    | 大重构、发布候选版本                    | 全量 suite，跨所有配置        |

---

## 2. Tier 模型 — 分层执行策略

```
Tier 0 — Smoke       (< 2 分钟)  → 每次 commit 运行
Tier 1 — Sanity      (< 10 分钟) → 每个 PR 运行
Tier 2 — Selective   (< 30 分钟) → 合并到 main 时运行
Tier 3 — Full        (< 60 分钟) → 每夜/发布前运行
```

### Tier 0: Smoke (每次 commit)

| 测试                                                      | Tag        | 覆盖                                    |
| --------------------------------------------------------- | ---------- | --------------------------------------- |
| `GET /api/ping → 204`                                     | `@smoke`   | 服务器健康检查                          |
| `GET /api/version → 200`                                  | `@smoke`   | 版本接口正常                            |
| `POST /api/novels → 201`                                  | `@smoke`   | 核心 CRUD 可用                          |
| `POST /api/chapters → 201`                                | `@smoke`   | 章节创建可用                            |
| `TC-E2E-001: Welcome page loads`                          | `@smoke`   | 前端可访问                              |
| `TC-E2E-002: Create workspace`                            | `@smoke`   | 核心用户流程                            |
| `TC-WEB-010: No console errors on load`                   | `@smoke`   | 前端无 JS 报错                          |

**运行命令:**
```bash
npx playwright test --grep @smoke
```

### Tier 1: Sanity (每个 PR)

包含所有 Tier 0 + 以下：

| 测试                                                      | Tag          |
| --------------------------------------------------------- | ------------ |
| `Chapters CRUD (full API)`                                | `@regression`|
| `AI validation (no key needed)`                           | `@regression`|
| `TC-E2E-010: Main editor layout`                          | `@smoke`     |
| `TC-E2E-011: Create & write chapter`                      | `@regression`|
| `TC-E2E-020: AI provider selector`                        | `@smoke`     |
| `TC-WEB-030: Editor accepts input`                        | `@regression`|
| `TC-WEB-050/051: CSS/JS no 404`                           | `@regression`|

### Tier 2: Selective (合并到 main)

基于 `git diff --name-only origin/main...HEAD` 分析选择性运行。

### Tier 3: Full (每夜/发布前)

全部测试套件，包括 `@slow` 和 `@quarantine`。

---

## 3. Tag Taxonomy

| Tag            | Purpose                        | Tier  |
| -------------- | ------------------------------ | ----- |
| `@smoke`       | 关键路径，必须始终通过         | 0     |
| `@regression`  | 标准回归覆盖                   | 2-3   |
| `@negative`    | 错误处理 / 异常输入            | 2     |
| `@boundary`    | 边界值测试                     | 2     |
| `@slow`        | 超过 30 秒的测试               | 3     |
| `@quarantine`  | 已知不稳定，隔离调查中         | Skip  |

---

## 4. Change-Based Test Selection (Git Diff 分析)

### 变更映射表

```
src/endpoints/chapters.js       → tests/api/api.spec.ts (Chapters describe)
                               → tests/e2e/novel-editor.spec.ts (Editor describe)

src/endpoints/ai.js             → tests/api/api.spec.ts (AI API describe)

src/endpoints/novels.js         → tests/api/api.spec.ts (Novels describe)
                               → tests/e2e/novel-editor.spec.ts (Welcome describe)

src/endpoints/import.js         → tests/api/api.spec.ts (Import describe)

src/endpoints/outline.js        → Manual: TC-MANUAL-008

electron/main.js                → tests/e2e/webapp.spec.ts (responsive + layout)

public/index.html               → tests/e2e/webapp.spec.ts (ALL)
                               → tests/e2e/novel-editor.spec.ts (ALL)

public/js/app.js                → tests/e2e/novel-editor.spec.ts (ALL)
                               → tests/e2e/webapp.spec.ts (ALL)

shared/schemas.js               → tests/api/api.spec.ts (ALL schema validation)
                               → tests/e2e/novel-editor.spec.ts
```

### 选择脚本 (概念)

```bash
#!/bin/bash
# scripts/select-regression-tests.sh
# 根据 git diff 选择需要运行的测试文件

CHANGED=$(git diff --name-only origin/main...HEAD)

TESTS="tests/smoke/"  # 始终包含 smoke

if echo "$CHANGED" | grep -q "src/endpoints/"; then
  TESTS="$TESTS tests/api/"
fi

if echo "$CHANGED" | grep -qE "(public/|electron/)"; then
  TESTS="$TESTS tests/e2e/"
fi

if echo "$CHANGED" | grep -q "shared/schemas.js"; then
  TESTS="$TESTS tests/api/ tests/e2e/"
fi

echo "$TESTS"
```

---

## 5. 测试目录结构

```
tests/
├── smoke/                          # Tier 0: 关键路径测试
│   └── smoke.spec.ts               # (从其他 spec 中 grep @smoke 运行)
├── api/                            # Tier 2-3: API 回归测试
│   └── api.spec.ts
├── e2e/                            # Tier 2-3: E2E 回归测试
│   ├── novel-editor.spec.ts
│   └── webapp.spec.ts
├── regression/                     # 预留：按功能模块组织
│   ├── chapters/
│   ├── ai-generation/
│   └── import-export/
└── fixtures/                       # 共享 fixtures 和 helpers
    └── api.fixture.ts
```

---

## 6. Playwright 配置 (regression 优化)

```typescript
// playwright.config.ts — 回归测试配置
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: { timeout: 10000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["html", { outputFolder: "test-results/html" }],
    ["json", { outputFile: "test-results/results.json" }],
    ["list"],
  ],
  use: {
    baseURL: "http://127.0.0.1:8765",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Tier 3 时才启用多浏览器
    // { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "node src/server.js",
    url: "http://127.0.0.1:8765/api/ping",
    reuseExistingServer: !process.env.CI,
  },
});
```

---

## 7. CI/CD Pipeline (GitHub Actions 概念)

```yaml
# .github/workflows/regression-tests.yml
name: Regression Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'  # 每夜凌晨 2 点全量回归

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install chromium
      - run: npx playwright test --grep @smoke

  regression:
    needs: smoke
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install chromium
      - run: npx playwright test --grep @regression --shard=${{ matrix.shard }}/4

  nightly-full:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: test-results
          path: test-results/
```

---

## 8. Flaky Test Management

### Quarantine 策略

```typescript
// 标记不稳定测试
test("unstable feature @quarantine", { tag: ["@quarantine"] }, async ({ page }) => {
  test.skip(process.env.CI === "true", "Quarantined in CI — investigation in progress");
  // test logic...
});
```

### 检测清单

- [ ] 连续 3 次 CI 运行中失败 ≥2 次 → 标记 `@quarantine`
- [ ] 隔离后 24h 内进行根因分析
- [ ] 修复后连续 5 次运行通过 → 移除 `@quarantine`

---

## 9. Suite Health Metrics

| 指标               | 目标值     | 当前状态   |
| ------------------ | ---------- | ---------- |
| Smoke 通过率       | 100%       | 待运行     |
| 回归通过率         | ≥95%       | 待运行     |
| 平均执行时间 (smoke)| <2 分钟   | 待运行     |
| Flake Rate         | <2%        | 待运行     |
| 测试覆盖率 (API)   | 100% 端点  | ~85%       |

---

## 10. CLI Quick Reference

```bash
# 运行不同 Tier
npx playwright test --grep @smoke                    # Tier 0
npx playwright test --grep "@smoke|@regression"       # Tier 1-2
npx playwright test                                   # Tier 3 (全量)

# 跳过隔离测试
npx playwright test --grep-invert @quarantine

# 并行 shard (4 worker)
npx playwright test --shard=1/4

# 仅重跑失败
npx playwright test --last-failed

# 生成 HTML 报告
npx playwright show-report test-results/html
```
