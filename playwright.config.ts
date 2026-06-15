/**
 * 催更姬 — Playwright 测试配置
 * 遵循 playwright-e2e-testing + playwright-regression-testing skill 规范
 */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const testPort = process.env.TEST_PORT || "18765";
const testDataRoot = path.resolve(process.env.TEST_DATA_ROOT || "test-results/runtime-data");
const baseURL = `http://127.0.0.1:${testPort}`;
const serverCommand = [
  "node src/server.js",
  `--port ${testPort}`,
  `--dataRoot "${testDataRoot}"`,
].join(" ");

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
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
    baseURL,
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
    command: serverCommand,
    url: `${baseURL}/api/ping`,
    reuseExistingServer: false,
    timeout: 10000,
  },
});
