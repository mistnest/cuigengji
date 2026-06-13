/**
 * 催更姬 — Playwright 测试配置
 * 遵循 playwright-e2e-testing + playwright-regression-testing skill 规范
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: { timeout: 10000 },
  // CI 环境重试 2 次，本地不重试
  retries: process.env.CI ? 2 : 0,
  // 并行 worker 数
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["json", { outputFile: "test-results/results.json" }],
    ["list"],
  ],
  use: {
    // 催更姬服务器地址
    baseURL: "http://127.0.0.1:8765",
    // 失败时捕获 trace
    trace: "on-first-retry",
    // 仅失败时截图
    screenshot: "only-on-failure",
    // 仅失败时保留视频
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // 自动启动服务器
  webServer: {
    command: "node src/server.js",
    url: "http://127.0.0.1:8765/api/ping",
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
