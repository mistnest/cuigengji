import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { _electron as electron } from '@playwright/test';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const workspaceData = path.resolve(
    projectRoot,
    '..',
    'workspace-local',
    'cuigengji',
    'runtime',
    'data',
);
const sourceData = process.env.CUIGENGJI_REAL_DSH_SOURCE_DATA
    || process.env.CUIGENGJI_DATA_ROOT
    || (await pathExists(workspaceData) ? workspaceData : '');
if (!sourceData) {
    throw new Error(
        'Set CUIGENGJI_REAL_DSH_SOURCE_DATA to a data directory containing an encrypted DeepSeek credential.',
    );
}
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cuigengji-real-dsh-'));
const dataRoot = path.join(testRoot, 'data');
const startedAt = Date.now();
let electronApp;

try {
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.copyFile(
        path.join(sourceData, 'ai-secrets.v2.json'),
        path.join(dataRoot, 'ai-secrets.v2.json'),
    );
    await copyIfPresent(
        path.join(sourceData, 'preferences.json'),
        path.join(dataRoot, 'preferences.json'),
    );

    const env = {
        ...process.env,
        CUIGENGJI_DATA_ROOT: dataRoot,
        CUIGENGJI_DSH_ROOT: path.join(testRoot, 'runtime'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({ args: ['.'], cwd: projectRoot, env });
    const page = await electronApp.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.locator('#welcome-novel-list').waitFor({ state: 'visible' });
    await waitFor(async () => page.locator('#welcome-novel-list').evaluate(element => (
        !element.textContent.includes('加载中')
    )), 30_000, 'Welcome page did not finish loading');

    const credential = await page.evaluate(() => (
        window.cuigengji.configuration.secrets.status('deepseek')
    ));
    if (!credential?.hasKey) throw new Error('No encrypted DeepSeek credential is configured.');

    await page.locator('#btn-welcome-create').click();
    await page.locator('#welcome-modal-overlay.active').waitFor({ state: 'visible' });
    await page.locator('#welcome-modal-input').fill('真实 DSH 流程临时验证');
    await page.locator('#btn-welcome-modal-confirm').click();
    await page.locator('#app-main').waitFor({ state: 'visible' });

    await page.evaluate(async () => {
        const [project] = await window.cuigengji.project.projects.list();
        const preferences = await window.cuigengji.configuration.preferences.get();
        const aiConfig = {
            ...(preferences.lastSuccessfulAiConfig || {}),
            provider: 'deepseek',
            endpoint: preferences.lastSuccessfulAiConfig?.endpoint || 'https://api.deepseek.com/v1',
            model: preferences.lastSuccessfulAiConfig?.model || 'deepseek-chat',
            maxTokens: Math.min(1024, Number(preferences.lastSuccessfulAiConfig?.maxTokens) || 1024),
        };
        let [chapterMeta] = await window.cuigengji.project.chapters.list(project.id);
        if (!chapterMeta) {
            chapterMeta = await window.cuigengji.project.chapters.create(project.id, {
                title: '第一章',
                content: '',
            });
        }
        const chapter = await window.cuigengji.project.chapters.get(project.id, chapterMeta.id);
        const updated = await window.cuigengji.project.chapters.update(project.id, chapter.id, {
            content: '林冬在雨夜关上书店的门，桌上的旧怀表仍在走动。',
            expectedRevision: chapter.revision,
        });
        const workspace = await window.cuigengji.project.workspace.get(project.id);
        await window.cuigengji.project.workspace.save(project.id, {
            ...workspace,
            aiConfig,
            worldBook: { entries: {} },
            characters: [],
        });
        const opened = await window.cuigengji.agent.restart({
            projectId: project.id,
            chapterId: updated.id,
        });
        const [history, sessions] = await Promise.all([
            window.cuigengji.agent.getHistory({
                projectId: project.id,
                sessionId: opened.sessionId,
                maxMessages: 20,
            }),
            window.cuigengji.agent.listSessions({ projectId: project.id }),
        ]);
        window.AgentWorkbenchFeature.store.setProject(opened);
        window.AgentWorkbenchFeature.store.applyHistory(opened.sessionId, history.events);
        window.AgentWorkbenchFeature.store.setSessions(sessions);
    });

    await waitFor(async () => page.evaluate(() => (
        window.AgentWorkbenchFeature.store.getState().runtime?.ready === true
    )), 60_000, 'DSH runtime did not become ready');

    const input = page.locator('.agent-composer__input');
    await input.waitFor({ state: 'visible' });
    await input.fill('请只用一句简短中文概括当前章节场景，不要调用工具。');
    await page.locator('.agent-composer__send').click();
    await waitFor(async () => page.evaluate(() => {
        const current = window.AgentWorkbenchFeature.store.getState();
        return !current.running && current.items.some(item => (
            item.kind === 'assistant' && String(item.text || '').trim()
        ));
    }), 90_000, 'DeepSeek did not complete the short Agent turn');

    const outcome = await page.evaluate(() => {
        const current = window.AgentWorkbenchFeature.store.getState();
        const assistant = [...current.items].reverse().find(item => item.kind === 'assistant');
        return {
            runtimeReady: current.runtime?.ready === true,
            assistantCharacters: String(assistant?.text || '').length,
            running: current.running,
        };
    });
    if (pageErrors.length) throw new Error(`Renderer errors: ${pageErrors.join('; ')}`);
    if (!outcome.runtimeReady || outcome.running || outcome.assistantCharacters < 1) {
        throw new Error('The real DSH turn did not reach a valid completed state.');
    }
    console.log(JSON.stringify({
        ok: true,
        provider: 'deepseek',
        turns: 1,
        assistantCharacters: outcome.assistantCharacters,
        elapsedMs: Date.now() - startedAt,
        temporaryData: true,
    }));
} finally {
    await electronApp?.close();
    await fs.rm(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

async function copyIfPresent(source, target) {
    try {
        await fs.copyFile(source, target);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function waitFor(predicate, timeoutMs, message) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(message);
}
