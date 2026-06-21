import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const createdProjects = new Set<string>();

function projectName() {
    return `FinalPolish_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createWorkspace(page: Page) {
    const name = projectName();
    createdProjects.add(name);
    await page.goto('/');
    await page.locator('#btn-welcome-create').click();
    await page.locator('#welcome-modal-input').fill(name);
    await page.locator('#btn-welcome-modal-confirm').click();
    await expect(page.locator('#app-main')).toBeVisible();
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

test('final polish user flow keeps UI usable without script errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));

    const name = await createWorkspace(page);

    await page.locator('#btn-add-chapter').click();
    await expect(page.locator('#chapter-summary-area')).toBeVisible();
    await page.locator('#chapter-summary-input').fill('手动保存的本章摘要。');
    await page.locator('#btn-save-summary').click();
    await expect(page.locator('#summary-hint')).toContainText(/保存|手动/);

    await page.locator('.sidebar-tab[data-panel="worldbook"]').click();
    await expect(page.locator('#worldbook-injection-badge')).toHaveCount(0);
    await page.locator('#btn-add-wb-entry').click();
    await expect(page.locator('.wb-edit-modal')).toBeVisible();
    await expect(page.locator('.wb-st-config #wb-edit-key')).toHaveCount(1);
    await page.locator('.wb-st-config > summary').click();
    await expect(page.locator('.wb-st-config #wb-edit-key')).toBeVisible();
    await expect(page.locator('.wb-st-config #wb-edit-keysecondary')).toBeVisible();
    await page.locator('#wb-group-manage-btn').click();
    await expect(page.locator('.group-manager-modal')).toBeVisible();
    const groupWidth = await page.locator('.group-manager-modal').evaluate(el => el.getBoundingClientRect().width);
    expect(groupWidth).toBeGreaterThan(450);
    await page.locator('.group-manager-modal .group-close-btn').click();
    await page.locator('.wb-edit-modal .plot-modal-close').click();

    await page.locator('.sidebar-tab[data-panel="characters"]').click();
    await expect(page.locator('#character-injection-badge')).toHaveCount(0);
    await page.locator('#btn-add-character').click();
    await expect(page.locator('.character-edit-modal')).toBeVisible();
    await expect(page.locator('.character-st-config #character-edit-personality')).toHaveCount(1);
    await page.locator('.character-st-config > summary').click();
    await expect(page.locator('.character-st-config #character-edit-personality')).toBeVisible();
    await expect(page.locator('#char-summarize-btn')).toBeVisible();
    await page.locator('.character-edit-modal .plot-modal-close').click();

    await page.locator('.sidebar-tab[data-panel="chat"]').click();
    await page.locator('#chat-input').fill('这是一条需要编辑的用户消息');
    await page.locator('#btn-send').click();
    await expect(page.locator('.chat-msg-user .chat-msg-action[data-action="edit"]').first()).toBeVisible();
    await page.locator('.chat-msg-user .chat-msg-action[data-action="edit"]').first().click();
    await page.locator('.chat-msg-edit-input').fill('这是一条已经修改过的用户消息');
    await page.locator('.chat-msg-action[data-action="save-edit"]').click();
    await expect(page.locator('.chat-msg-user .chat-msg-content').first()).toContainText('已经修改过');

    await page.locator('.sidebar-tab[data-panel="ai-tools"]').click();
    await page.evaluate(() => localStorage.setItem('cgj-ai-onboarding-complete', '1'));
    await page.reload();
    await page.locator('.welcome-novel-card', { hasText: name }).first().click();
    await expect(page.locator('#app-main')).toBeVisible();
    await expect(page.locator('#ai-onboarding')).toBeHidden();
    await expect(page.locator('.sidebar-tab[data-panel="ai-tools"]')).toHaveClass(/active/);
    await expect(page.locator('#ai-quick-detail')).not.toContainText('记忆预算');

    expect(errors.filter(error =>
        !error.includes('favicon')
        && !error.includes('400 (Bad Request)')
    )).toEqual([]);
});
