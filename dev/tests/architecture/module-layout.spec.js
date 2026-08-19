import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const PROJECT_ROOT = process.cwd();
const BACKEND_ROOT = path.join(PROJECT_ROOT, 'src', 'backend');
const MODULES = [
    { group: 'domains', id: 'project', interfaceId: 'project' },
    { group: 'domains', id: 'knowledge', interfaceId: 'knowledge' },
    { group: 'intelligence', id: 'agent', interfaceId: 'agent' },
    { group: 'intelligence', id: 'models', interfaceId: 'models' },
    { group: 'intelligence', id: 'automation', interfaceId: 'automation' },
    { group: 'interchange', id: 'exchange', interfaceId: 'exchange' },
    { group: 'foundation', id: 'configuration', interfaceId: 'configuration' },
    { group: 'foundation', id: 'platform', interfaceId: 'app' },
];

test('@architecture P7 keeps backend modules and flat interface modules aligned', async () => {
    for (const module of MODULES) {
        const backend = path.join(BACKEND_ROOT, module.group, module.id);
        const ipc = path.join(PROJECT_ROOT, 'electron', 'ipc', module.interfaceId);
        const contract = path.join(PROJECT_ROOT, 'shared', 'desktop-api', module.interfaceId);

        await expectFile(path.join(backend, 'index.js'));
        await expectFile(path.join(backend, 'MODULE.md'));
        await expectFile(path.join(ipc, 'index.js'));
        await expectFile(path.join(contract, 'index.js'));

        const manifest = JSON.parse(await fs.readFile(path.join(backend, 'module.json'), 'utf8'));
        expect(manifest.id).toBe(module.id);
        expect(manifest.group).toBe(module.group);
        expect(manifest.entry).toBe('./index.js');
        expect(Array.isArray(manifest.dependsOn)).toBe(true);
        expect(JSON.parse(await fs.readFile(path.join(ipc, 'module.json'), 'utf8')).id)
            .toBe(module.interfaceId);
        expect(JSON.parse(await fs.readFile(path.join(contract, 'module.json'), 'utf8')).id)
            .toBe(module.interfaceId);
    }
});

test('@architecture backend capabilities and page-oriented Renderer stay at bounded depth', async () => {
    for (const module of MODULES) {
        const root = path.join(BACKEND_ROOT, module.group, module.id);
        for (const directory of await listDirectories(root)) {
            const depth = path.relative(root, directory).split(path.sep).filter(Boolean).length;
            expect(depth, `${path.relative(PROJECT_ROOT, directory)} exceeds capability/adapter depth`)
                .toBeLessThanOrEqual(2);
        }
    }

    const pagesRoot = path.join(PROJECT_ROOT, 'public', 'js', 'pages');
    for (const directory of await listDirectories(pagesRoot)) {
        const depth = path.relative(pagesRoot, directory).split(path.sep).filter(Boolean).length;
        expect(depth, `${path.relative(PROJECT_ROOT, directory)} exceeds page/area/component depth`)
            .toBeLessThanOrEqual(3);
    }
});

test('@architecture backend cross-module imports use public entries and declared dependencies', async () => {
    const moduleRoots = new Map(MODULES.map(module => [
        path.resolve(BACKEND_ROOT, module.group, module.id),
        module,
    ]));
    const manifests = new Map(await Promise.all(MODULES.map(async module => [
        module.id,
        JSON.parse(await fs.readFile(
            path.join(BACKEND_ROOT, module.group, module.id, 'module.json'),
            'utf8',
        )),
    ])));

    for (const [sourceRoot, sourceModule] of moduleRoots) {
        for (const file of await listJavaScriptFiles(sourceRoot)) {
            const source = await fs.readFile(file, 'utf8');
            for (const specifier of localSpecifiers(source)) {
                const target = path.resolve(path.dirname(file), specifier);
                const targetEntry = [...moduleRoots.entries()].find(([root]) => isInside(root, target));
                if (!targetEntry || targetEntry[0] === sourceRoot) continue;

                const [targetRoot, targetModule] = targetEntry;
                expect(path.resolve(target), `${path.relative(PROJECT_ROOT, file)} deep-imports ${targetModule.id}`)
                    .toBe(path.join(targetRoot, 'index.js'));
                expect(
                    manifests.get(sourceModule.id).dependsOn,
                    `${sourceModule.id} must declare its dependency on ${targetModule.id}`,
                ).toContain(targetModule.id);
            }
        }
    }
});

test('@architecture retired flat module paths are absent', async () => {
    const removedPaths = [
        ['src', 'modules'],
        ['public', 'js', 'features'],
        ['public', 'js', 'platform'],
        ['electron', 'ipc', 'modules'],
        ['shared', 'desktop-api', 'modules'],
        ['public', 'js', 'app.js'],
    ];
    for (const segments of removedPaths) {
        await expect(fs.access(path.join(PROJECT_ROOT, ...segments))).rejects.toThrow();
    }
});

async function expectFile(filePath) {
    const stat = await fs.stat(filePath);
    expect(stat.isFile(), path.relative(PROJECT_ROOT, filePath)).toBe(true);
}

async function listDirectories(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async entry => {
        if (!entry.isDirectory()) return [];
        const target = path.join(root, entry.name);
        return [target, ...await listDirectories(target)];
    }));
    return nested.flat();
}

async function listJavaScriptFiles(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async entry => {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) return listJavaScriptFiles(target);
        return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
    }));
    return nested.flat();
}

function localSpecifiers(source) {
    const pattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
    return [...source.matchAll(pattern)].map(match => match[1]);
}

function isInside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
