import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const dataRoot = path.join(root, 'test-results', 'electron-runtime-data');
await fs.rm(dataRoot, { recursive: true, force: true });

const env = {
    ...process.env,
    CUIGENGJI_DATA_ROOT: dataRoot,
};
delete env.ELECTRON_RUN_AS_NODE;

const electronApp = await electron.launch({
    args: ['.'],
    cwd: root,
    env,
});

try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#btn-welcome-create').click();
    await page.locator('#welcome-modal-input').fill('Electron输入测试');
    await page.locator('#btn-welcome-modal-confirm').click();
    await page.locator('#app-main').waitFor({ state: 'visible' });

    await page.locator('#btn-add-volume').click();
    await page.locator('#btn-add-chapter').click();
    await page.locator('.tree-chapter-item').waitFor({ state: 'visible' });
    await page.locator('#chapter-editor').waitFor({ state: 'visible' });
    if (await page.locator('#chapter-editor').isDisabled()) {
        throw new Error('Electron 正文编辑器仍处于禁用状态');
    }
    await page.locator('#chapter-editor').fill('Electron 正文输入正常。');

    await page.locator('.sidebar-tab[data-panel="chat"]').click();
    if (await page.locator('#chat-input').isDisabled()) {
        throw new Error('Electron 聊天输入框仍处于禁用状态');
    }
    await page.locator('#chat-input').fill('Electron 聊天输入正常。');

    const projects = await fs.readdir(path.join(dataRoot, 'novels'));
    if (!projects.includes('Electron输入测试')) {
        throw new Error('Electron 项目未写入隔离数据目录');
    }
    console.log('Electron smoke passed: project storage, chapter input, and chat input are available.');
} finally {
    await electronApp.close();
}
