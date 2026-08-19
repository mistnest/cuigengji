import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const PROJECT_ROOT = process.cwd();

test('@architecture development assets stay under dev', async () => {
    for (const directory of ['architecture', 'docs', 'scripts', 'tests']) {
        await expect(fs.access(path.join(PROJECT_ROOT, directory))).rejects.toThrow();
        await expect(fs.access(path.join(PROJECT_ROOT, 'dev', directory))).resolves.toBeUndefined();
    }
    for (const localPath of ['data', path.join('dev', 'local')]) {
        await expect(fs.access(path.join(PROJECT_ROOT, localPath))).rejects.toThrow();
    }
});

test('@architecture generated output and DSH runtime dependencies stay outside the product tree', async () => {
    const manifest = JSON.parse(await fs.readFile(
        path.join(PROJECT_ROOT, 'package.json'),
        'utf8',
    ));

    expect(manifest.build.directories.output).toBe('../cuigengji-build/dist');
    expect(manifest.build.files).not.toContain('dev/**/*');
    expect(manifest.dependencies['@deepseek-ai/cordis-plugin-group']).toBe('1.0.1');
    expect(manifest.build.extraResources).toContainEqual({
        from: 'node_modules/@deepseek-ai',
        to: 'app.asar.unpacked/node_modules/@deepseek-ai',
        filter: [
            '**/*',
            '!**/*.map',
            '!**/{test,tests,__tests__,example,examples}/**',
        ],
    });
    expect(manifest.build.files).toEqual(expect.arrayContaining([
        '!node_modules/**/*.map',
        '!node_modules/**/{test,tests,__tests__,example,examples}/**',
    ]));
    expect(manifest.build.win).toMatchObject({
        target: ['nsis'],
        compression: 'maximum',
        electronLanguages: ['zh-CN', 'en-US'],
    });
});
