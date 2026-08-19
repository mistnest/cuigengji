import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const PROJECT_ROOT = process.cwd();
const FRONTEND_CATALOG = path.join(PROJECT_ROOT, 'dev', 'architecture', 'frontend-pages.json');
const INTERFACE_CATALOG = path.join(PROJECT_ROOT, 'dev', 'architecture', 'interface-modules.json');
const RUNTIME_CLOSURE = path.join(PROJECT_ROOT, 'dev', 'architecture', 'runtime-closure.json');
const OWNERSHIP_CATALOG = path.join(
    PROJECT_ROOT,
    'dev',
    'architecture',
    'frontend-bootstrap-ownership.json',
);

const INTERFACE_MODULES = [
    'app',
    'project',
    'knowledge',
    'configuration',
    'models',
    'agent',
    'automation',
    'exchange',
];

const BACKEND_MODULES = [
    'foundation/platform',
    'domains/project',
    'domains/knowledge',
    'foundation/configuration',
    'intelligence/models',
    'intelligence/agent',
    'intelligence/automation',
    'interchange/exchange',
];

test('@architecture P7 uses page-oriented frontend owners and flat interface entries', async () => {
    const [frontend, desktopApi, runtimeClosure] = await Promise.all([
        readJson(FRONTEND_CATALOG),
        readJson(INTERFACE_CATALOG),
        readJson(RUNTIME_CLOSURE),
    ]);
    const rendererScripts = new Set(runtimeClosure.rendererScripts);

    expect(frontend).toMatchObject({ schemaVersion: 1, phase: 'P7', status: 'active' });
    expect(desktopApi).toMatchObject({ schemaVersion: 1, phase: 'P7', status: 'active' });

    expect(frontend.target.pages.map(page => page.id)).toEqual([
        'welcome',
        'workspace',
        'settings',
    ]);
    expect(frontend.target.pages.map(page => page.root)).toEqual([
        'public/js/pages/welcome',
        'public/js/pages/workspace',
        'public/js/pages/settings',
    ]);
    for (const page of frontend.target.pages) {
        expectLoadedOwner(page.root, rendererScripts);
        for (const area of page.areas || []) {
            expectLoadedOwner(`${page.root}/${area.id}`, rendererScripts);
        }
    }
    for (const dialog of frontend.target.dialogs) {
        expectLoadedOwner(`${frontend.target.dialogRoot}/${dialog}`, rendererScripts);
    }
    for (const shared of frontend.target.shared) {
        expectLoadedOwner(`${frontend.target.sharedRoot}/${shared}`, rendererScripts);
    }

    const moduleIds = desktopApi.modules.map(module => module.id);
    expect(moduleIds).toEqual(INTERFACE_MODULES);
    expect(new Set(moduleIds).size).toBe(INTERFACE_MODULES.length);

    const validInterfaces = new Set(moduleIds);
    for (const page of frontend.target.pages) {
        expectValidInterfaceList(page.interfaceModules, validInterfaces, `page ${page.id}`);
        for (const area of page.areas || []) {
            expectValidInterfaceList(
                area.interfaceModules,
                validInterfaces,
                `page ${page.id}/${area.id}`,
            );
        }
    }

    const backendTargets = desktopApi.modules.map(module => (
        `${module.backend.group}/${module.backend.module}`
    ));
    expect(backendTargets).toEqual(BACKEND_MODULES);
    expect(new Set(backendTargets).size).toBe(BACKEND_MODULES.length);

    for (const module of desktopApi.modules) {
        expect(module.target.contractRoot).toBe(`shared/desktop-api/${module.id}`);
        expect(module.target.preloadSource).toBe(`electron/preload-src/${module.id}.cjs`);
        expect(module.target.ipcRoot).toBe(`electron/ipc/${module.id}`);
        await expectFile(path.join(PROJECT_ROOT, module.target.contractRoot, 'index.js'));
        await expectFile(path.join(PROJECT_ROOT, module.target.preloadSource));
        await expectFile(path.join(PROJECT_ROOT, module.target.ipcRoot, 'index.js'));
        const [contractManifest, ipcManifest] = await Promise.all([
            readJson(path.join(PROJECT_ROOT, module.target.contractRoot, 'module.json')),
            readJson(path.join(PROJECT_ROOT, module.target.ipcRoot, 'module.json')),
        ]);
        expect(contractManifest).toMatchObject({ id: module.id, entry: './index.js' });
        expect(ipcManifest).toMatchObject({ id: module.id, entry: './index.js' });
        const contractEntry = await fs.readFile(
            path.join(PROJECT_ROOT, module.target.contractRoot, 'index.js'),
            'utf8',
        );
        expect(contractEntry, `${module.id} contract must own its flat public exports`)
            .not.toMatch(/\.\.\/(?:domains|foundation|intelligence|interchange)\//u);
        const ipcEntry = await fs.readFile(
            path.join(PROJECT_ROOT, module.target.ipcRoot, 'index.js'),
            'utf8',
        );
        expect(ipcEntry, `${module.id} IPC must own its flat handlers`)
            .not.toMatch(/\.\.\/(?:domains|foundation|intelligence|interchange)\//u);
    }

    expect(desktopApi.preload).toMatchObject({
        runtimeEntry: 'electron/preload.cjs',
        targetSourceRoot: 'electron/preload-src',
        sandboxBundleRequired: true,
    });
    await expectFile(path.join(PROJECT_ROOT, desktopApi.preload.runtimeEntry));
    const preload = await fs.readFile(
        path.join(PROJECT_ROOT, desktopApi.preload.runtimeEntry),
        'utf8',
    );
    expect(preload).toContain('GENERATED FILE. Edit electron/preload-src');
    for (const moduleId of INTERFACE_MODULES) {
        expect(preload).toContain(`${moduleId}: ${moduleId}Facade`);
    }
});

test('@architecture P7 migrated the bootstrap ownership map into loaded page scripts', async () => {
    const ownership = await readJson(OWNERSHIP_CATALOG);
    const runtime = await readJson(path.join(PROJECT_ROOT, ownership.runtimeManifest));
    const [bootstrap, html] = await Promise.all([
        fs.readFile(path.join(PROJECT_ROOT, runtime.entry), 'utf8'),
        fs.readFile(path.join(PROJECT_ROOT, 'public/index.html'), 'utf8'),
    ]);

    expect(ownership).toMatchObject({ schemaVersion: 1, phase: 'P7', status: 'migrated' });
    expect(ownership.baselineFunctionCount).toBe(228);
    expect(runtime).toMatchObject({ schemaVersion: 1, phase: 'P7', status: 'active' });
    expect(new Set(runtime.scripts).size).toBe(runtime.scripts.length);
    expect(bootstrap.split(/\r?\n/u).length).toBeLessThan(80);
    expect((bootstrap.match(/(?:async\s+)?function\s+[A-Za-z0-9_]+/gu) || [])).toHaveLength(1);

    await expectFile(path.join(PROJECT_ROOT, runtime.context));
    for (const script of runtime.scripts) {
        await expectFile(path.join(PROJECT_ROOT, script));
        expect(html, `${script} must be loaded by the Electron Renderer`)
            .toContain(`src="${script.replace(/^public\//u, '')}"`);
    }

    let previousEnd = 0;
    for (const range of ownership.ownershipRanges) {
        expect(range.startLine).toBeGreaterThan(previousEnd);
        expect(range.endLine).toBeGreaterThanOrEqual(range.startLine);
        expect(range.target).toMatch(/^public\/js\/(?:app|pages|dialogs|shared)\//u);
        expect(range.responsibility.trim().length).toBeGreaterThan(0);
        previousEnd = range.endLine;
    }

    for (const legacyRoot of [
        'public/js/modules',
        'shared/desktop-api/domains',
        'shared/desktop-api/foundation',
        'shared/desktop-api/intelligence',
        'shared/desktop-api/interchange',
        'electron/ipc/domains',
        'electron/ipc/foundation',
        'electron/ipc/intelligence',
        'electron/ipc/interchange',
    ]) {
        await expect(fs.access(path.join(PROJECT_ROOT, legacyRoot))).rejects.toThrow();
    }
});

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function expectFile(filePath) {
    const stat = await fs.stat(filePath);
    expect(stat.isFile(), path.relative(PROJECT_ROOT, filePath)).toBe(true);
}

function expectValidInterfaceList(values, validInterfaces, owner) {
    expect(Array.isArray(values), `${owner} interfaceModules`).toBe(true);
    expect(new Set(values).size, `${owner} has duplicate interface modules`).toBe(values.length);
    for (const value of values) {
        expect(validInterfaces.has(value), `${owner} references unknown interface ${value}`).toBe(true);
    }
}

function expectLoadedOwner(root, rendererScripts) {
    const prefix = `${root}/`;
    expect(
        [...rendererScripts].some(script => script.startsWith(prefix)),
        `${root} must own at least one loaded Renderer script`,
    ).toBe(true);
}
