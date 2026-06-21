import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const createdProjects = new Set<string>();

function projectName(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createWorkspace(page: Page, name = projectName('Flow')) {
    await page.getByRole('button', { name: /新建工作区/ }).click();
    await page.locator('#welcome-modal-input').fill(name);
    await page.locator('#btn-welcome-modal-confirm').click();
    await expect(page.locator('#app-main')).toBeVisible();
    createdProjects.add(name);
    return name;
}

async function openRecent(page: Page, name: string) {
    await page.locator('#btn-home').click();
    await page.locator('.welcome-novel-card', { hasText: name }).click();
    await expect(page.locator('#current-novel-title')).toHaveText(name);
}

async function openSettingsPage(page: Page, pageName: 'general' | 'editor' | 'ai-service' | 'generation') {
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-overlay')).toHaveClass(/active/);
    await page.locator(`.settings-nav [data-settings-page="${pageName}"]`).click();
}

function sse(events: unknown[]) {
    return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}

async function mockChatWriteStream(page: Page, reply: string) {
    await page.route('**/api/chat/write', route => route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([
            { type: 'chunk', content: reply.slice(0, Math.ceil(reply.length / 2)) },
            { type: 'chunk', content: reply.slice(Math.ceil(reply.length / 2)) },
            { type: 'done', reply },
        ]),
    }));
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

test('空工作区不会伪装成可保存章节 @regression', async ({ page }) => {
    await page.goto('/');
    await createWorkspace(page);

    await expect(page.locator('#current-chapter-title')).toHaveText('- 未选择章节');
    await expect(page.locator('#chapter-editor')).toBeDisabled();
    await expect(page.locator('#chapter-title-input')).toBeDisabled();

    await page.locator('#btn-save').click();
    await expect(page.locator('.tree-chapter-item')).toHaveCount(1);
    await expect(page.locator('#chapter-editor')).toBeEnabled();
});

test('编辑后切换章节会先保存当前内容 @regression', async ({ page, request }) => {
    await page.goto('/');
    const name = await createWorkspace(page);

    await page.locator('#btn-add-chapter').click();
    await page.locator('#chapter-title-input').fill('第一章');
    await page.locator('#chapter-editor').fill('第一版内容');
    await page.locator('#btn-save').click();

    await page.locator('#btn-add-chapter').click();
    await page.locator('#chapter-title-input').fill('第二章');
    await page.locator('#chapter-editor').fill('第二章内容');
    await page.locator('#btn-save').click();

    const chapters = page.locator('.tree-chapter-item');
    await chapters.nth(0).click();
    await page.locator('#chapter-editor').fill('切换前必须保存的内容');
    await expect(page.locator('#status-save')).toHaveText('未保存');
    await chapters.nth(1).click();
    await expect(page.locator('#chapter-editor')).toHaveValue('第二章内容');

    const response = await request.get(`/api/chapters?novelId=${encodeURIComponent(name)}`);
    const list = await response.json();
    const first = list.chapters.find((chapter: { title: string }) => chapter.title === '第一章');
    const saved = await request.get(`/api/chapters/${first.id}?novelId=${encodeURIComponent(name)}`);
    await expect(saved.json()).resolves.toMatchObject({ content: '切换前必须保存的内容' });
});

test('章节可保存、拖入卷，并在重新进入后保持位置 @smoke', async ({ page, request }) => {
    await page.goto('/');
    const name = await createWorkspace(page);

    await page.locator('#btn-add-chapter').click();
    await expect(page.locator('.tree-chapter-item')).toHaveCount(1);
    await page.locator('#chapter-title-input').fill('雾港来信');
    await page.locator('#chapter-editor').fill('潮水退去后，石阶上留下了一封没有署名的信。');
    await page.locator('#btn-save').click();
    await expect(page.locator('#status-save')).toHaveText('已保存');

    await page.locator('#btn-add-volume').click();
    await expect(page.locator('.tree-volume-wrapper')).toHaveCount(1);
    await page.locator('.tree-chapter-item').dragTo(page.locator('.tree-chapter-group'));

    await expect(page.locator('.tree-volume-wrapper .tree-chapter-item')).toHaveCount(1);
    const chapters = await request.get(`/api/chapters?novelId=${encodeURIComponent(name)}`);
    const data = await chapters.json();
    expect(data.chapters.find((item: { title: string }) => item.title === '雾港来信')?.volumeId)
        .toBe('vol_第1卷');

    await openRecent(page, name);
    await expect(page.locator('.tree-volume-wrapper .tree-chapter-item')).toContainText('雾港来信');
    await expect(page.locator('#chapter-editor')).toHaveValue(/没有署名的信/);
});

test('世界书、角色和 Prompt 按项目隔离并持久化 @regression', async ({ page }) => {
    await page.goto('/');
    const first = await createWorkspace(page, projectName('ProjectA'));

    await page.locator('.sidebar-tab[data-panel="worldbook"]').click();
    await page.locator('#btn-add-wb-entry').click();
    await page.locator('#wb-edit-comment').fill('雾港规则');
    await page.locator('.wb-st-config > summary').click();
    await page.locator('#wb-edit-key').fill('雾港');
    await page.locator('#wb-edit-content').fill('雾港每逢月末封港。');
    await page.locator('.wb-save-btn').click();

    await page.locator('.sidebar-tab[data-panel="characters"]').click();
    await page.locator('#btn-add-character').click();
    await expect(page.locator('.character-edit-modal')).toBeVisible();
    await page.locator('#character-edit-name').fill('林冬');
    await page.locator('#character-edit-description').fill('调查员');
    await page.locator('.character-st-config > summary').click();
    await page.locator('#character-edit-personality').fill('冷静谨慎');
    await page.locator('.character-edit-save').click();
    await expect(page.locator('.character-entry')).toContainText('林冬');

    await page.locator('.sidebar-tab[data-panel="ai-tools"]').click();
    await page.locator('#btn-add-prompt-template').click();
    await expect(page.locator('#prompt-editor-overlay')).toHaveClass(/active/);
    await page.locator('#prompt-editor-name').fill('悬疑风格');
    await page.locator('#prompt-editor-content').fill('保持克制的悬疑语气');
    await page.locator('#btn-prompt-editor-save').click();
    await page.locator('#btn-prompt-editor-done').click();
    await expect(page.locator('.prompt-template-toggle-item')).toContainText('悬疑风格');
    await openSettingsPage(page, 'generation');
    await page.locator('#ai-temperature').fill('1.1');
    await page.locator('#btn-settings-done').click();
    await page.locator('#btn-save-preset').click();
    await page.locator('#preset-save-input').fill('雾港方案');
    await page.locator('#btn-preset-save-confirm').click();
    await expect(page.locator('#ai-preset option')).toContainText(['— 选择预设 —', '雾港方案']);
    await page.evaluate(() => window.saveWorkspaceState());

    await page.locator('#btn-home').click();
    await createWorkspace(page, projectName('ProjectB'));
    await page.locator('.sidebar-tab[data-panel="worldbook"]').click();
    await expect(page.locator('.wb-entry')).toHaveCount(0);
    await page.locator('.sidebar-tab[data-panel="characters"]').click();
    await expect(page.locator('.character-entry')).toHaveCount(0);
    await page.locator('.sidebar-tab[data-panel="ai-tools"]').click();
    await expect(page.locator('.prompt-template-toggle-item')).toHaveCount(0);
    await expect(page.locator('#ai-preset option')).toHaveCount(1);
    await openSettingsPage(page, 'generation');
    await expect(page.locator('#ai-temperature')).toHaveValue('0.7');
    await page.locator('#btn-settings-done').click();

    await openRecent(page, first);
    await page.locator('.sidebar-tab[data-panel="worldbook"]').click();
    await expect(page.locator('.wb-entry')).toContainText('雾港规则');
    await page.locator('.sidebar-tab[data-panel="characters"]').click();
    await expect(page.locator('.character-entry')).toContainText('林冬');
    await page.locator('.sidebar-tab[data-panel="ai-tools"]').click();
    await expect(page.locator('.prompt-template-toggle-item')).toContainText('悬疑风格');
    await expect(page.locator('#ai-preset option')).toContainText(['— 选择预设 —', '雾港方案']);
    await openSettingsPage(page, 'generation');
    await expect(page.locator('#ai-temperature')).toHaveValue('1.1');
});

test('角色卡内嵌世界书提取后会保存到项目 @regression', async ({ page }) => {
    await page.goto('/');
    const name = await createWorkspace(page);
    await page.locator('.sidebar-tab[data-panel="characters"]').click();

    const card = {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
            name: '沈砚',
            description: '旧港档案员',
            character_book: {
                name: '沈砚的设定',
                entries: [{
                    uid: 1,
                    comment: '旧港档案馆',
                    key: ['档案馆'],
                    content: '档案馆地下保存着被封存的航海日志。',
                    constant: false,
                    selective: true,
                    disable: false,
                }],
            },
        },
    };
    await page.locator('#file-input-character').setInputFiles({
        name: 'shenyan.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(card), 'utf8'),
    });

    await expect(page.locator('.character-entry')).toContainText('沈砚');
    await page.locator('.character-entry').click();
    await page.locator('.character-st-config > summary').click();
    await expect(page.locator('.char-embedded-book')).toContainText('旧港档案馆');
    await page.locator('.character-extract-embedded-btn').click();
    await page.locator('.character-edit-cancel').click();
    await page.evaluate(() => window.saveWorkspaceState());

    await openRecent(page, name);
    await page.locator('.sidebar-tab[data-panel="worldbook"]').click();
    await expect(page.locator('.wb-entry')).toContainText('旧港档案馆');
});

test('会话可新建、保存、搜索并切换 @regression', async ({ page, request }) => {
    await mockChatWriteStream(page, '可以从港口封锁开始制造冲突。');
    await page.goto('/');
    const name = await createWorkspace(page);

    await page.locator('#chat-input').fill('讨论第一幕的冲突');
    await page.locator('#btn-send').click();
    await expect(page.locator('.chat-msg-assistant')).toContainText('港口封锁');
    await page.locator('#btn-new-chat').click();
    await page.locator('#btn-history').click();
    await expect(page.locator('.chat-history-item')).toHaveCount(2);
    await page.locator('#session-search').fill('讨论第一幕');
    await expect(page.locator('.chat-history-item')).toHaveCount(1);

    const response = await request.get(`/api/sessions?novelId=${encodeURIComponent(name)}`);
    const data = await response.json();
    expect(data.sessions).toHaveLength(2);
    expect(data.sessions.some((session: { name: string }) => session.name === '新会话')).toBe(true);
});

test('Prompt 搜索、勾选删除和记忆预算控件有效 @regression', async ({ page }) => {
    await page.goto('/');
    await createWorkspace(page);
    await page.locator('.sidebar-tab[data-panel="ai-tools"]').click();

    const promptData = [
        { name: '动作模板', content: '增加动作细节' },
        { name: '对白模板', content: '保持对白自然' },
    ];
    for (const d of promptData) {
        await page.locator('#btn-add-prompt-template').click();
        await expect(page.locator('#prompt-editor-overlay')).toHaveClass(/active/);
        await page.locator('#prompt-editor-name').fill(d.name);
        await page.locator('#prompt-editor-content').fill(d.content);
        await page.locator('#btn-prompt-editor-save').click();
        await page.locator('#btn-prompt-editor-done').click();
    }

    await page.locator('#prompt-template-search').fill('对白');
    await expect(page.locator('.prompt-template-toggle-item:visible')).toHaveCount(1);
    await page.locator('#prompt-template-search').fill('');
    await page.locator('.prompt-template-toggle-item', { hasText: '动作模板' }).hover();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.prompt-template-toggle-item', { hasText: '动作模板' })
        .locator('.prompt-delete-btn').click();
    await expect(page.locator('.prompt-template-toggle-item')).toHaveCount(1);
    await expect(page.locator('.prompt-template-toggle-item')).toContainText('对白模板');

    await expect(page.locator('.budget-option')).toHaveCount(0);
    await expect(page.locator('#memory-tokens-estimate')).toHaveCount(0);
});

test('高频 AI 配置留在右侧，全局设置使用独立弹窗 @regression', async ({ page }) => {
    await page.goto('/');
    await createWorkspace(page);

    await page.locator('.sidebar-tab[data-panel="ai-tools"]').click();
    await expect(page.locator('#btn-manage-ai-settings')).toBeVisible();
    await expect(page.locator('#ai-memory-settings')).toBeVisible();
    await expect(page.locator('#preset-section')).toBeVisible();
    await expect(page.locator('#prompt-templates-section')).toBeVisible();
    await expect(page.locator('#ai-provider')).not.toBeVisible();

    await page.locator('#btn-manage-ai-settings').click();
    await expect(page.locator('#settings-overlay')).toHaveClass(/active/);
    await expect(page.locator('#ai-provider')).toBeVisible();
    await expect(page.locator('[data-settings-content="ai-service"]')).toBeVisible();

    await page.locator('.settings-nav [data-settings-page="generation"]').click();
    await expect(page.locator('#ai-temperature')).toBeVisible();
    await page.locator('#btn-settings-done').click();
    await expect(page.locator('#settings-overlay')).not.toHaveClass(/active/);
});

test('切换模型服务商会更新接口地址，并可查看已保存 API Key @regression', async ({ page }) => {
    await page.route('**/api/ai-secrets/status?provider=xai*', async route => {
        await route.fulfill({ json: { hasKey: true } });
    });
    await page.route('**/api/ai-secrets/reveal', async route => {
        await route.fulfill({ json: { hasKey: true, apiKey: 'xai-test-secret' } });
    });

    await page.goto('/');
    await createWorkspace(page);
    await openSettingsPage(page, 'ai-service');

    await page.locator('#ai-provider').selectOption('deepseek');
    await expect(page.locator('#ai-endpoint')).toHaveValue('https://api.deepseek.com/v1');

    await page.locator('#ai-provider').selectOption('openrouter');
    await expect(page.locator('#ai-endpoint')).toHaveValue('https://openrouter.ai/api/v1');

    await page.locator('#ai-provider').selectOption('xai');
    await expect(page.locator('#ai-api-key-status')).toContainText('已保存');
    await expect(page.locator('#ai-api-key')).toHaveAttribute('type', 'password');
    await page.locator('#btn-toggle-api-key').click();
    await expect(page.locator('#ai-api-key')).toHaveAttribute('type', 'text');
    await expect(page.locator('#ai-api-key')).toHaveValue('xai-test-secret');
    await page.locator('#btn-toggle-api-key').click();
    await expect(page.locator('#ai-api-key')).toHaveAttribute('type', 'password');
});

test('新项目完成模型、预设和设定初始化后仍可编辑正文与聊天 @regression', async ({ page }) => {
    await page.route('**/api/ai/test-connection', async route => {
        await route.fulfill({ json: { success: true } });
    });

    await page.goto('/');
    await createWorkspace(page);
    await openSettingsPage(page, 'ai-service');
    await page.locator('#ai-provider').selectOption('openai');
    await page.locator('#ai-api-key').fill('test-key');
    await page.locator('#btn-connect-model').click();
    await expect(page.locator('#ai-connection-badge')).toContainText('已连接');

    const preset = {
        chat_completion_source: 'openai',
        openai_model: 'gpt-test',
        prompts: [{ identifier: 'main', name: '测试预设', role: 'system', content: '保持叙事连贯。' }],
    };
    await page.locator('#file-input-preset').setInputFiles({
        name: 'flow-preset.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(preset), 'utf8'),
    });
    await expect(page.locator('.preset-info-close')).toBeVisible();
    await page.locator('.preset-info-close').click();
    await page.locator('#btn-settings-done').click();

    await page.locator('.sidebar-tab[data-panel="worldbook"]').click();
    await page.locator('#btn-add-wb-entry').click();
    await page.locator('#wb-edit-comment').fill('测试世界');
    await page.locator('#wb-edit-content').fill('用于验证初始化流程。');
    await page.locator('.wb-save-btn').click();

    await page.locator('.sidebar-tab[data-panel="characters"]').click();
    await page.locator('#btn-add-character').click();
    await page.locator('#character-edit-name').fill('测试角色');
    await page.locator('.character-edit-save').click();

    await page.locator('.sidebar-tab[data-panel="chapters"]').click();
    await page.locator('#btn-add-volume').click();
    await page.locator('#btn-add-chapter').click();
    await expect(page.locator('#chapter-editor')).toBeEnabled();
    await page.locator('#chapter-editor').fill('正文可以正常输入。');
    await expect(page.locator('#chapter-editor')).toHaveValue('正文可以正常输入。');

    await page.locator('.sidebar-tab[data-panel="chat"]').click();
    await expect(page.locator('#chat-input')).toBeEnabled();
    await page.locator('#chat-input').fill('聊天框可以正常输入。');
    await expect(page.locator('#chat-input')).toHaveValue('聊天框可以正常输入。');
});

test('欢迎页删除失败时保留项目卡片并显示错误 @regression', async ({ page }) => {
    await page.goto('/');
    const name = await createWorkspace(page);
    await page.locator('#btn-home').click();
    await expect(page.locator('.welcome-novel-card', { hasText: name })).toBeVisible();

    await page.route(`**/api/novels/${encodeURIComponent(name)}`, async route => {
        if (route.request().method() === 'DELETE') {
            await route.fulfill({ status: 500, json: { error: '磁盘删除失败' } });
        } else {
            await route.continue();
        }
    });
    page.once('dialog', dialog => dialog.accept());
    const card = page.locator('.welcome-novel-card', { hasText: name });
    await card.hover();
    await card.locator('.welcome-delete-btn').click();

    await expect(card).toBeVisible();
    await expect(page.locator('#status-message')).toContainText('删除项目失败');
});

test('世界书和角色搜索默认收起，并可清空关闭 @regression', async ({ page }) => {
    await page.goto('/');
    await createWorkspace(page);

    await page.locator('.sidebar-tab[data-panel="worldbook"]').click();
    await expect(page.locator('[data-search-panel="worldbook"]')).toBeHidden();
    await page.locator('#btn-wb-search').click();
    await expect(page.locator('[data-search-panel="worldbook"]')).toBeVisible();
    await page.locator('#wb-search').fill('雾港');
    await page.locator('[data-search-panel="worldbook"] .panel-search-clear').click();
    await expect(page.locator('#wb-search')).toHaveValue('');
    await page.locator('[data-search-panel="worldbook"] .panel-search-close').click();
    await expect(page.locator('[data-search-panel="worldbook"]')).toBeHidden();

    await page.locator('.sidebar-tab[data-panel="characters"]').click();
    await expect(page.locator('[data-search-panel="character"]')).toBeHidden();
    await page.locator('#btn-char-search').click();
    await expect(page.locator('[data-search-panel="character"]')).toBeVisible();
    await page.locator('#character-search').fill('林冬');
    await page.locator('#character-search').press('Escape');
    await expect(page.locator('[data-search-panel="character"]')).toBeHidden();
    await expect(page.locator('#character-search')).toHaveValue('');
});

test('通用与编辑器设置会立即生效并持久化 @regression', async ({ page }) => {
    await page.goto('/');
    await createWorkspace(page);
    await openSettingsPage(page, 'general');

    await page.locator('#setting-theme').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#setting-autosave-delay').selectOption('5000');

    await page.locator('.settings-nav [data-settings-page="editor"]').click();
    await page.locator('#setting-editor-font').selectOption('sans');
    await page.locator('#setting-editor-font-size').fill('20');
    await page.locator('#setting-editor-line-height').fill('2.4');
    await expect(page.locator('#chapter-editor')).toHaveCSS('font-size', '20px');
    await expect(page.locator('#chapter-editor')).toHaveCSS('line-height', '48px');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#chapter-editor')).toHaveCSS('font-size', '20px');
    await page.evaluate(() => localStorage.removeItem('novel-editor-app-settings'));
});

test('快速切换工作区时旧响应不会覆盖新项目 @regression', async ({ page, request }) => {
    const firstTitle = `switch_slow_${Date.now()}`;
    const secondTitle = `switch_fast_${Date.now()}`;
    const first = await request.post('/api/novels', { data: { title: firstTitle } }).then(r => r.json());
    const second = await request.post('/api/novels', { data: { title: secondTitle } }).then(r => r.json());

    try {
        await page.route(`**/api/save/workspace/${encodeURIComponent(first.id)}`, async route => {
            await new Promise(resolve => setTimeout(resolve, 500));
            await route.continue();
        });
        await page.goto('/');
        await page.evaluate(({ first, second }) => {
            const app = window as typeof window & {
                enterWorkspace: (id: string, title: string) => Promise<void>;
            };
            void app.enterWorkspace(first.id, first.title);
            void app.enterWorkspace(second.id, second.title);
        }, {
            first: { id: first.id, title: firstTitle },
            second: { id: second.id, title: secondTitle },
        });

        await expect.poll(() => page.evaluate(() => {
            const app = window as typeof window & { editorState: { currentNovel: { id: string } } };
            return app.editorState.currentNovel.id;
        })).toBe(second.id);
        await expect(page.locator('#current-novel-title')).toHaveText(secondTitle);
    } finally {
        await request.delete(`/api/novels/${encodeURIComponent(first.id)}`);
        await request.delete(`/api/novels/${encodeURIComponent(second.id)}`);
    }
});

test('大纲新增和完成状态会持久化，接口失败时回滚界面 @regression', async ({ page, request }) => {
    await page.goto('/');
    const name = await createWorkspace(page);
    await page.locator('.sidebar-tab[data-panel="outline"]').click();

    page.once('dialog', dialog => dialog.accept('第一幕冲突'));
    await page.locator('#btn-add-outline-node').click();
    await expect(page.locator('.outline-node')).toContainText('第一幕冲突');

    await page.locator('.outline-node').click();
    await expect(page.locator('.outline-check')).toHaveText('✅');
    const stored = await request.get(`/api/outline?novelId=${encodeURIComponent(name)}`).then(response => response.json());
    expect(stored.nodes[0]).toMatchObject({ title: '第一幕冲突', completed: true });

    await page.route('**/api/outline/*', route => route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: '模拟保存失败' }),
    }));
    await page.locator('.outline-node').click();
    await expect(page.locator('.outline-check')).toHaveText('✅');
    await expect(page.locator('#status-message')).toContainText('更新大纲失败');
});

test('已保存 API Key 时提取设定按钮会正常发起请求 @regression', async ({ page }) => {
    await page.route('**/api/ai/extract', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ characters: [], worldEntries: [], summary: '没有发现新设定' }),
    }));
    await page.goto('/');
    await createWorkspace(page);
    await page.locator('#btn-add-chapter').click();
    await page.locator('#chapter-editor').fill('林冬走进雾港，发现码头已经封锁。');
    await page.locator('.sidebar-tab[data-panel="ai-tools"]').click();
    await page.evaluate(() => {
        const app = window as typeof window & {
            editorState: { hasSavedApiKey: boolean; aiConfig: { apiKey: string; provider: string } };
        };
        app.editorState.hasSavedApiKey = true;
        app.editorState.aiConfig.apiKey = '';
        app.editorState.aiConfig.provider = 'anthropic';
    });

    const requestPromise = page.waitForRequest('**/api/ai/extract');
    await page.locator('#btn-extract-setting').click();
    await page.locator('.extract-current-btn').click();
    await requestPromise;
    await expect(page.getByRole('heading', { name: '提取结果' })).toBeVisible();
});

test('项目逐章扫描会调用项目级提取接口并展示统一确认结果 @regression', async ({ page }) => {
    await page.route('**/api/ai/extract-project-stream', route => route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([
            { type: 'start', total: 2, startOrder: 1, endOrder: 2 },
            { type: 'chapter_start', index: 1, total: 2, title: '第一章', order: 1 },
            { type: 'chapter_done', index: 1, total: 2, title: '第一章', order: 1, characters: 1, worldEntries: 1 },
            { type: 'chapter_start', index: 2, total: 2, title: '第二章', order: 2 },
            { type: 'chapter_done', index: 2, total: 2, title: '第二章', order: 2, characters: 0, worldEntries: 1 },
            {
                type: 'done',
                mode: 'project',
                range: { startOrder: 1, endOrder: 2, processed: 2 },
                characters: [{ name: '林冬', description: '调查员', group: '主角' }],
                worldEntries: [{ comment: '雾港', key: ['雾港'], content: '港口城市，码头被封锁。', group: '地点' }],
                extractionLog: [
                    { chapter: '第一章', characters: 1, worldEntries: 1 },
                    { chapter: '第二章', characters: 0, worldEntries: 1 },
                ],
                summary: '逐章扫描 2 章，提取 1 个角色、1 条世界书候选。',
            },
        ]),
    }));
    await page.goto('/');
    await createWorkspace(page);
    await page.locator('#btn-add-chapter').click();
    await page.locator('#chapter-editor').fill('林冬走进雾港，发现码头已经封锁。');
    await page.locator('#btn-save').click();
    await page.locator('#btn-add-chapter').click();
    await page.locator('#chapter-editor').fill('第二天，林冬回到码头调查。');
    await page.locator('.sidebar-tab[data-panel="ai-tools"]').click();
    await page.evaluate(() => {
        const app = window as typeof window & {
            editorState: { hasSavedApiKey: boolean; aiConfig: { apiKey: string; provider: string } };
        };
        app.editorState.hasSavedApiKey = true;
        app.editorState.aiConfig.apiKey = '';
        app.editorState.aiConfig.provider = 'anthropic';
    });

    const requestPromise = page.waitForRequest('**/api/ai/extract-project-stream');
    await page.locator('#btn-extract-setting').click();
    await page.locator('#extract-project-end').fill('2');
    await page.locator('.extract-project-btn').click();
    const request = await requestPromise;
    const body = request.postDataJSON();
    expect(body.novelId).toBeTruthy();
    expect(body.startOrder).toBe(1);
    expect(body.endOrder).toBe(2);
    await expect(page.getByRole('heading', { name: '提取结果' })).toBeVisible();
    await expect(page.locator('.extract-check-row')).toContainText(['林冬', '雾港']);
    await expect(page.getByText('逐章扫描记录')).toBeVisible();
});

test('聊天框正文模式会流式返回并保留用户消息操作 @regression', async ({ page }) => {
    await mockChatWriteStream(page, '门外传来三声急促的敲击。');
    await page.goto('/');
    await createWorkspace(page);
    await page.locator('#btn-add-chapter').click();
    await page.locator('#chapter-editor').fill('夜色沉入雾港。');
    await page.evaluate(() => {
        const app = window as typeof window & {
            editorState: { hasSavedApiKey: boolean; aiConfig: { apiKey: string; provider: string } };
        };
        app.editorState.hasSavedApiKey = true;
        app.editorState.aiConfig.apiKey = '';
        app.editorState.aiConfig.provider = 'anthropic';
    });

    await page.locator('#chat-input').fill('继续写下一段');
    await page.locator('#btn-send').click();
    await expect(page.locator('.chat-msg-assistant')).toContainText('门外传来三声急促的敲击');
    await expect(page.locator('.chat-msg-user .chat-msg-action[data-action="edit"]')).toBeVisible();
    await expect(page.locator('.chat-msg-user .chat-msg-action[data-action="copy"]')).toBeVisible();
    await expect(page.locator('.chat-msg-user .chat-msg-action[data-action="resend"]')).toBeVisible();
});

test('编辑发送和重新发送会截断后续聊天历史 @regression', async ({ page }) => {
    const requests: Array<{ message: string; history?: Array<{ role: string; content: string }> }> = [];
    await page.route('**/api/chat/write', route => {
        const body = route.request().postDataJSON();
        requests.push(body);
        const reply = `回复${requests.length}`;
        return route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: sse([
                { type: 'chunk', content: reply },
                { type: 'done', reply },
            ]),
        });
    });

    await page.goto('/');
    await createWorkspace(page);
    await page.locator('#btn-add-chapter').click();
    await page.locator('#chapter-editor').fill('正文现场。');
    await page.evaluate(() => {
        const app = window as typeof window & {
            editorState: { hasSavedApiKey: boolean; aiConfig: { apiKey: string; provider: string } };
        };
        app.editorState.hasSavedApiKey = true;
        app.editorState.aiConfig.apiKey = '';
        app.editorState.aiConfig.provider = 'anthropic';
    });

    await page.locator('#chat-input').fill('第一条');
    await page.locator('#btn-send').click();
    await expect(page.locator('.chat-msg-assistant')).toContainText('回复1');
    await page.locator('#chat-input').fill('第二条');
    await page.locator('#btn-send').click();
    await expect(page.locator('.chat-msg-assistant').last()).toContainText('回复2');

    await page.locator('.chat-msg-user .chat-msg-action[data-action="edit"]').first().click();
    await page.locator('.chat-msg-edit-input').fill('第一条修改');
    await page.locator('.chat-msg-action[data-action="save-edit"]').click();
    await page.locator('.chat-msg-action[data-action="send-edit"]').click();
    await expect(page.locator('.chat-msg-assistant').last()).toContainText('回复3');

    expect(requests[2].message).toBe('第一条修改');
    expect(JSON.stringify(requests[2].history || [])).not.toContain('第二条');
    expect(JSON.stringify(requests[2].history || [])).not.toContain('回复2');

    await page.locator('#chat-input').fill('第三条');
    await page.locator('#btn-send').click();
    await expect(page.locator('.chat-msg-assistant').last()).toContainText('回复4');

    await page.locator('.chat-msg-user .chat-msg-action[data-action="resend"]').first().click();
    await expect(page.locator('.chat-msg-assistant').last()).toContainText('回复5');

    expect(requests[4].message).toBe('第一条修改');
    expect(JSON.stringify(requests[4].history || [])).not.toContain('第三条');
    expect(JSON.stringify(requests[4].history || [])).not.toContain('回复4');
});

test('编辑器格式与导出按钮会作用于当前章节 @regression', async ({ page }) => {
    await page.goto('/');
    await createWorkspace(page);
    await page.locator('#btn-add-chapter').click();
    await page.locator('#chapter-title-input').fill('雾港来信');
    const editor = page.locator('#chapter-editor');
    await editor.fill('潮水退去');
    await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 2));
    await page.locator('#btn-editor-bold').click();
    await expect(editor).toHaveValue('**潮水**退去');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btn-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('雾港来信.txt');
});

declare global {
    interface Window {
        saveWorkspaceState: () => Promise<void>;
    }
}
