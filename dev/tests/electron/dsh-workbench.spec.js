import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';

import {
    messageText,
    startMockDeepSeekProvider,
    textResponseFrames,
    toolResponseFrames,
} from '../helpers/dsh-contract-runtime.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test.setTimeout(120_000);

test('@smoke Electron uses one Renderer for the native DSH Agent sidebar', async () => {
    const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-dsh-electron-'));
    const provider = await startMockDeepSeekProvider(body => {
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const toolPromptIndex = messages.findLastIndex(message => (
            message.role === 'user' && messageText(message).includes('工具验证')
        ));
        const slowPromptIndex = messages.findLastIndex(message => (
            message.role === 'user' && messageText(message).includes('慢速取消')
        ));
        const proposalPromptIndex = messages.findLastIndex(message => (
            message.role === 'user' && messageText(message).includes('大纲提案验证')
        ));
        const lastToolIndex = messages.findLastIndex(message => message.role === 'tool');
        if (slowPromptIndex >= 0) {
            return {
                frames: [{ choices: [{ index: 0, delta: { content: '尚未完成' } }] }],
                holdOpen: true,
            };
        }
        if (toolPromptIndex >= 0 && lastToolIndex < toolPromptIndex) {
            return {
                frames: toolResponseFrames('search_project_knowledge', {
                    query: '星港',
                    kind: 'all',
                }),
            };
        }
        if (proposalPromptIndex >= 0 && lastToolIndex < proposalPromptIndex) {
            return {
                frames: toolResponseFrames('propose_outline_patch', {
                    baseRevision: 0,
                    summary: '补充第一次阶段兑现',
                    reason: '当前大纲还没有阶段回报节点。',
                    operations: [{
                        kind: 'create',
                        ref: 'first_payoff',
                        title: '第一次阶段兑现',
                        description: '主角获得第一项明确成果。',
                        type: 'plot',
                    }],
                    impact: ['读者更早获得阶段回报'],
                    assumptions: ['具体成果内容尚待后续讨论'],
                }),
            };
        }
        return {
            frames: textResponseFrames('原生侧栏回复完成。\n来源：[DeepSeek 文档](https://api.deepseek.com/docs)', {
                reasoning: '先核对当前章节和项目资料。',
            }),
        };
    });
    const env = {
        ...process.env,
        CUIGENGJI_DATA_ROOT: path.join(testRoot, 'data'),
        CUIGENGJI_DSH_ROOT: path.join(testRoot, 'runtime'),
        CUIGENGJI_DSH_DIAGNOSTICS: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;

    let electronApp;
    try {
        const packagedExecutable = process.env.CUIGENGJI_PACKAGED_EXECUTABLE;
        electronApp = await electron.launch(packagedExecutable
            ? {
                executablePath: packagedExecutable,
                args: [
                    '--no-sandbox',
                    '--disable-gpu',
                    `--user-data-dir=${path.join(testRoot, 'electron-user-data')}`,
                ],
                cwd: path.dirname(packagedExecutable),
                env,
            }
                : {
                    args: [
                        '.',
                        '--no-sandbox',
                        '--disable-gpu',
                        `--user-data-dir=${path.join(testRoot, 'electron-user-data')}`,
                    ],
                    cwd: PROJECT_ROOT,
                    env,
                });
        const main = await electronApp.firstWindow();
        const pageErrors = [];
        main.on('pageerror', error => pageErrors.push(error.message));

        await expect(main.locator('#welcome-novel-list')).not.toContainText('加载中...');
        await main.locator('#btn-welcome-create').click();
        await expect(main.locator('#welcome-modal-overlay')).toHaveClass(/active/u);
        await main.locator('#welcome-modal-input').fill('DSH Electron 原生侧栏验证');
        await main.locator('#btn-welcome-modal-confirm').click();
        await expect(main.locator('#app-main')).toBeVisible();
        await expect(main.locator('#agent-sidebar-root')).toBeVisible();

        const setup = await main.evaluate(async () => {
            let stage = 'project list';
            try {
                const [project] = await window.cuigengji.project.projects.list();
                if (!project) throw new Error('project list was empty');
                stage = 'chapter list';
                let [chapterMeta] = await window.cuigengji.project.chapters.list(project.id);
                if (!chapterMeta) {
                    stage = 'chapter create';
                    chapterMeta = await window.cuigengji.project.chapters.create(project.id, {
                        title: '第一章',
                        content: '',
                    });
                }
                stage = 'chapter get';
                const chapter = await window.cuigengji.project.chapters.get(project.id, chapterMeta.id);
                stage = 'chapter update';
                const updated = await window.cuigengji.project.chapters.update(project.id, chapter.id, {
                    content: '林冬在星港的钟声中关上北门。',
                    expectedRevision: chapter.revision,
                });
                stage = 'workspace get';
                const workspace = await window.cuigengji.project.workspace.get(project.id);
                const worldBook = {
                    entries: {
                        1: {
                            key: ['星港'],
                            comment: '星港',
                            content: '星港实行永久宵禁，钟声响起后不得离开室内。',
                        },
                    },
                };
                const characters = [{
                    data: {
                        name: '林冬',
                        description: '负责守卫星港北门。',
                        tags: ['守卫'],
                    },
                }];
                stage = 'workspace save';
                await window.cuigengji.project.workspace.save(project.id, {
                ...workspace,
                worldBook,
                characters,
                });
                // Keep the live Renderer state aligned with the direct fixture write. Agent
                // startup saves this state before opening and would otherwise overwrite it.
                window.editorState.worldBook = worldBook;
                window.editorState.characters = characters;
                return { projectId: project.id, chapterId: updated.id };
            } catch (error) {
                throw new Error(`${stage}: ${error?.code || ''} ${error?.message || error} ${error?.details ? JSON.stringify(error.details) : ''}`);
            }
        });

        await expect(main.locator('#ai-model')).toHaveAttribute('list', 'ai-model-options');
        expect(await main.locator('#ai-model').evaluate(element => element.tagName)).toBe('INPUT');
        await main.locator('#btn-settings').click();
        await expect(main.locator('#settings-overlay')).toHaveClass(/active/u);
        await main.locator('[data-settings-page="ai-service"]').click();
        await main.locator('#ai-provider').selectOption('deepseek');
        await main.locator('#ai-endpoint').fill(provider.baseUrl);
        await main.locator('#ai-model').fill('deepseek-v4-flash');
        await main.locator('#ai-api-key').fill('native-e2e-key');
        await main.locator('#btn-connect-model').click();
        await expect(main.locator('#ai-api-key')).toHaveValue('');
        await expect(main.locator('#ai-api-key')).toHaveAttribute(
            'placeholder',
            'API Key 已安全保存到本机',
        );

        await expect.poll(
            () => main.evaluate(() => window.AgentWorkbenchFeature.store.getState().runtime),
            { timeout: 45_000 },
        ).toMatchObject({ state: 'ready', ready: true, hasCredential: true });
        await expect(main.locator('.agent-composer__input')).toBeEnabled();
        await main.locator('#btn-settings-done').click();
        await expect(main.locator('#settings-overlay')).not.toHaveClass(/active/u);
        const status = await main.evaluate(() => window.cuigengji.agent.status());
        expect(status).toMatchObject({
            kind: 'deepseek-harness',
            version: '0.1.0-rc.7',
            state: 'ready',
            ready: true,
            hasCredential: true,
        });
        expect(JSON.stringify(status)).not.toContain('127.0.0.1');
        expect(JSON.stringify(status)).not.toContain('native-e2e-key');

        await main.locator('.agent-composer__input').fill('工具验证：请查询星港资料。');
        await main.locator('.agent-composer__send').click();
        await expect(main.locator('.agent-message--user')).toContainText('工具验证');
        await expect.poll(() => provider.requests.some(record => (
            record.body.messages.some(message => messageText(message).includes('工具验证'))
        )), { timeout: 20_000 }).toBe(true);
        const firstProviderRequest = provider.requests.find(record => (
            record.body.messages.some(message => messageText(message).includes('工具验证'))
        ));
        expect(firstProviderRequest.body.messages.some(message => (
            message.role === 'user' && messageText(message).includes('工具验证')
        )), JSON.stringify(firstProviderRequest.body.messages.map(message => ({
            role: message.role,
            text: messageText(message).slice(0, 160),
        })), null, 2)).toBe(true);
        await expect(main.locator('.agent-tool-card')).toHaveCount(1, { timeout: 20_000 });
        await expect(main.locator('.agent-tool-card')).toHaveClass(/is-success/u);
        await expect(main.locator('.agent-message--assistant .agent-message__answer'))
            .toContainText('原生侧栏回复完成。', { timeout: 20_000 });
        await expect(main.locator('.agent-message--assistant .agent-source-link'))
            .toHaveAttribute('href', 'https://api.deepseek.com/docs');
        await expect(main.locator('.agent-reasoning')).toContainText('先核对当前章节和项目资料。');
        await expect.poll(
            () => main.evaluate(() => window.AgentWorkbenchFeature.store.getState().running),
        ).toBe(false);

        const toolRequest = provider.requests.find(record => Array.isArray(record.body.tools));
        expect(toolRequest.authorization).toBe('Bearer native-e2e-key');
        expect(toolRequest.body.tools.map(tool => tool.function.name).sort()).toEqual([
            'get_project_knowledge',
            'propose_outline_patch',
            'safe_web_fetch',
            'search_project_knowledge',
            'skill',
        ]);

        await main.locator('.agent-composer__input').fill('大纲提案验证');
        await main.locator('.agent-composer__send').click();
        await expect(main.locator('.agent-proposal-card')).toContainText('补充第一次阶段兑现', {
            timeout: 20_000,
        });
        await main.locator('.agent-proposal-card__apply').click();
        await expect(main.locator('.agent-proposal-card__apply')).toHaveText('已应用', {
            timeout: 20_000,
        });
        await expect(main.locator('#outline-tree')).toContainText('第一次阶段兑现');
        await expect.poll(() => main.evaluate(async () => {
            const [project] = await window.cuigengji.project.projects.list();
            const outline = await window.cuigengji.project.outlines.get(project.id);
            return {
                revision: outline.revision,
                titles: outline.nodes.map(node => node.title),
            };
        })).toEqual({ revision: 1, titles: ['第一次阶段兑现'] });

        await main.locator('.agent-composer__input').fill('慢速取消');
        await main.locator('.agent-composer__send').click();
        await expect(main.locator('.agent-composer__cancel')).toBeVisible({ timeout: 20_000 });
        await main.locator('.agent-composer__cancel').click();
        await expect(main.locator('.agent-error-notice')).toBeVisible({ timeout: 20_000 });
        await expect.poll(
            () => main.evaluate(() => window.AgentWorkbenchFeature.store.getState().running),
        ).toBe(false);

        const topology = await electronApp.evaluate(({ BrowserWindow, webContents }) => ({
            browserWindowCount: BrowserWindow.getAllWindows().length,
            webContents: webContents.getAllWebContents().map(item => ({
                type: item.getType(),
                url: item.getURL(),
            })),
        }));
        expect(topology.browserWindowCount).toBe(1);
        expect(topology.webContents).toHaveLength(1);
        expect(topology.webContents[0].type).toBe('window');
        expect(topology.webContents[0].url).not.toContain('/api/');

        const runtimeProjectRoot = path.join(
            testRoot,
            'runtime',
            'deepseek-harness',
            'projects',
            createHash('sha256').update(setup.projectId).digest('hex').slice(0, 20),
        );
        const context = JSON.parse(await fs.readFile(
            path.join(runtimeProjectRoot, 'project-context.json'),
            'utf8',
        ));
        expect(context).toMatchObject({
            schemaVersion: 3,
            contextPolicy: {
                mode: 'canonical-writing-context',
                injection: 'cuigenji-canonical-v1',
            },
            currentChapter: { id: setup.chapterId },
        });
        expect(context.currentChapter.content).toContain('林冬在星港');
        expect(context.relevantReferences.map(item => item.name)).toEqual(
            expect.arrayContaining(['星港', '林冬']),
        );
        expect(context.promptText.length).toBeLessThanOrEqual(100_000);
        expect(JSON.stringify(context)).not.toContain('native-e2e-key');
        expect(pageErrors).toEqual([]);
    } finally {
        await electronApp?.close();
        await provider.close();
        await fs.rm(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
