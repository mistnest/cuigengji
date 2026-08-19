import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { collectRuntimeClosure } from '../../scripts/check-runtime-closure.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('@architecture production runtime closure matches the reviewed manifest', () => {
    const expected = JSON.parse(fs.readFileSync(
        path.join(PROJECT_ROOT, 'dev', 'architecture', 'runtime-closure.json'),
        'utf8',
    ));

    expect(collectRuntimeClosure()).toEqual(expected);
});

test('@architecture repository contains no unreachable production source', () => {
    const closure = collectRuntimeClosure();

    expect(closure.unreachableSrcFiles).toEqual([]);
});
