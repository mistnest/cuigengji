import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const PUBLIC_JS = path.join(process.cwd(), 'public', 'js');

test('@architecture renderer keeps domain persistence out of HTTP and browser storage', async () => {
    const files = await listJavaScriptFiles(PUBLIC_JS);
    const sources = await Promise.all(files.map(async file => ({
        file,
        source: await fs.readFile(file, 'utf8'),
    })));

    for (const { file, source } of sources) {
        expect(source, `${file} must not use browser storage as a data authority`)
            .not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
        expect(source, `${file} must not use the removed HTTP-to-IPC transport`)
            .not.toContain('DesktopTransport');
        expect(source, `${file} must not own network transport`).not.toMatch(/\bfetch\s*\(/);
        expect(source, `${file} must not know legacy automation routes`)
            .not.toMatch(/["'`]\/api\/(?:ai|chat|debug)(?:\/|["'`])/);
    }

    const appSource = sources.find(item => item.file.endsWith(
        `${path.sep}app${path.sep}bootstrap.js`,
    ))?.source || '';
    const forbiddenDomainRoutes = [
        '/api/chapters',
        '/api/outline',
        '/api/sessions',
        '/api/novels',
        '/api/save',
        '/api/import',
        '/api/ai-secrets',
    ];
    for (const route of forbiddenDomainRoutes) expect(appSource).not.toContain(route);

    const automationRuntime = sources.find(item =>
        item.file.endsWith([
            'pages',
            'workspace',
            'automation',
            'automation-runtime.js',
        ].join(path.sep)),
    )?.source || '';
    expect(automationRuntime).toContain("return 'electron-ipc-automation'");
    expect(automationRuntime).toContain('DesktopApi?.automation');
    expect(automationRuntime).toContain('window.AutomationRuntimePort');
    expect(automationRuntime).not.toContain('fetch(');

    const agentSources = sources.filter(item => item.file.includes([
        'pages',
        'workspace',
        'agent',
    ].join(path.sep)));
    expect(agentSources).not.toHaveLength(0);
    for (const { file, source } of agentSources) {
        expect(source, `${file} must use the DSH Desktop API boundary`).not.toContain('fetch(');
        expect(source, `${file} must not open a DSH event socket`).not.toContain('WebSocket');
        expect(source, `${file} must not know DSH wire routes`).not.toMatch(/\/api\//u);
        expect(source, `${file} must not receive a private runtime address`)
            .not.toMatch(/(?:127\.0\.0\.1|localhost|runtimeUrl)/u);
        expect(source, `${file} must not import the DSH implementation`)
            .not.toContain('@deepseek-ai/dsh');
        expect(source, `${file} must not expose the removed legacy Agent runtime`)
            .not.toContain('AgentRuntimePort');
    }

    const [electronEntry, preload] = await Promise.all([
        fs.readFile(path.join(process.cwd(), 'electron', 'index.js'), 'utf8'),
        fs.readFile(path.join(process.cwd(), 'electron', 'preload.cjs'), 'utf8'),
    ]);
    for (const source of [electronEntry, preload]) {
        expect(source).not.toContain('openWorkbench');
        expect(source).not.toContain('setViewLayout');
        expect(source).not.toContain('hideView');
        expect(source).not.toContain('dsh-view-host');
        expect(source).not.toContain('WebContentsView');
    }
});

async function listJavaScriptFiles(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) return listJavaScriptFiles(target);
        return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
    }));
    return nested.flat();
}
