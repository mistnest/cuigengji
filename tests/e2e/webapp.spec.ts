import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const createdProjects = new Set<string>();

function projectName(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createWorkspace(page: Page, name = projectName('E2E')) {
    await page.getByRole('button', { name: /新建工作区/ }).click();
    await page.locator('#welcome-modal-input').fill(name);
    await page.locator('#btn-welcome-modal-confirm').click();
    await expect(page.locator('#app-main')).toBeVisible();
    await expect(page.locator('#current-novel-title')).toHaveText(name);
    createdProjects.add(name);
    return name;
}

async function removeProjects(request: APIRequestContext) {
    for (const id of createdProjects) {
        await request.delete(`/api/novels/${encodeURIComponent(id)}`);
    }
    createdProjects.clear();
}

test.afterEach(async ({ request }) => {
    await removeProjects(request);
});

test('欢迎页可创建工作区，并在最近项目中重新打开 @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '催更姬' })).toBeVisible();
    await expect(page.getByRole('button', { name: /导入文档/ })).toBeVisible();

    const name = await createWorkspace(page);
    await page.locator('#btn-home').click();

    const recent = page.locator('.welcome-novel-card', { hasText: name });
    await expect(recent).toBeVisible();
    await recent.click();
    await expect(page.locator('#current-novel-title')).toHaveText(name);
});

test('欢迎页导入 TXT 会创建工作区并显示正文 @smoke', async ({ page }) => {
    await page.goto('/');
    const name = projectName('Import');
    createdProjects.add(name);

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /导入文档/ }).click();
    const chooser = await chooserPromise;
    page.once('dialog', dialog => dialog.accept(name));
    await chooser.setFiles({
        name: 'opening.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('第一章 雾中的来客\n夜色落在旧港上。', 'utf8'),
    });

    await expect(page.locator('#app-main')).toBeVisible();
    await expect(page.locator('#current-novel-title')).toHaveText(name);
    await expect(page.locator('#chapter-editor')).toHaveValue(/夜色落在旧港上/);
});

test('页面加载和工作区进入没有脚本错误或资源 404 @regression', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
        if (response.status() === 404 && /\.(js|css)(\?|$)/.test(response.url())) {
            errors.push(`${response.status()} ${response.url()}`);
        }
    });

    await page.goto('/');
    await createWorkspace(page);
    await page.waitForLoadState('networkidle');

    expect(errors.filter(error => !error.includes('favicon'))).toEqual([]);
});

test('900x600 窗口仍保留三栏编辑区 @regression', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto('/');
    await createWorkspace(page);

    await expect(page.locator('#left-sidebar')).toBeVisible();
    await expect(page.locator('#editor-area')).toBeVisible();
    await expect(page.locator('#right-sidebar')).toBeVisible();
    const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
});
