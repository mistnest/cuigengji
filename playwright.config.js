import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './dev/tests',
    outputDir: '../cuigengji-build/test-results',
    timeout: 45_000,
    expect: {
        timeout: 10_000,
    },
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: [
        ['list'],
        ['html', { outputFolder: '../cuigengji-build/playwright-report', open: 'never' }],
    ],
    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
});
