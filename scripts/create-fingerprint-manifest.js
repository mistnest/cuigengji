#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { APP_SIGNATURE } from '../src/app-signature.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = path.join(ROOT, '.private', 'cuigengji-fingerprint-manifest.json');
const args = parseArgs(process.argv.slice(2));
const output = path.resolve(ROOT, args.output || DEFAULT_OUTPUT);
const privateSalt = process.env.CGJ_FINGERPRINT_SALT || '';

const HIGH_SIGNAL_FILES = [
    'LICENSE',
    'NOTICE',
    'package.json',
    'src/app-signature.js',
    'src/server.js',
    'src/services/context-orchestrator.js',
    'src/services/preset-orchestrator.js',
    'src/services/ai-tools/reference/schemas.js',
    'src/services/ai-tools/reference/reference-store.js',
    'src/services/native/world-layer.js',
    'src/services/native/character-layer.js',
    'src/services/st/formatters.js',
    'public/index.html',
    'public/js/app-signature.js',
    'public/js/app.js',
    'public/js/ai/chat-panel.js',
    'public/js/editor/resizable-panels.js',
];

const manifest = {
    generatedAt: new Date().toISOString(),
    note: 'Private provenance manifest. Keep this file outside the public repository.',
    saltApplied: Boolean(privateSalt),
    appSignature: APP_SIGNATURE,
    fileHashes: await hashSelectedFiles(HIGH_SIGNAL_FILES),
    featurePrint: await buildFeaturePrint(),
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Fingerprint manifest written to ${path.relative(ROOT, output)}`);
console.log(`Files hashed: ${Object.keys(manifest.fileHashes).length}`);
console.log(`Salt applied: ${manifest.saltApplied ? 'yes' : 'no'}`);

function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i++) {
        const item = argv[i];
        if (item === '--output' || item === '-o') {
            parsed.output = argv[++i];
        }
    }
    return parsed;
}

async function hashSelectedFiles(files) {
    const hashes = {};
    for (const rel of files) {
        const abs = path.join(ROOT, rel);
        try {
            const content = await fs.readFile(abs);
            hashes[rel] = {
                sha256: hashBuffer(content),
                saltedSha256: privateSalt ? hashBuffer(Buffer.concat([Buffer.from(privateSalt), content])) : null,
                bytes: content.length,
            };
        } catch (err) {
            hashes[rel] = { missing: true, error: err.code || err.message };
        }
    }
    return hashes;
}

async function buildFeaturePrint() {
    const [server, app, html, schemas, resizable] = await Promise.all([
        readText('src/server.js'),
        readText('public/js/app.js'),
        readText('public/index.html'),
        readText('src/services/ai-tools/reference/schemas.js'),
        readText('public/js/editor/resizable-panels.js'),
    ]);

    return {
        apiRoutes: unique([...server.matchAll(/app\.(?:get|post|put|delete|use)\(['"`]([^'"`]+)['"`]/g)].map(m => m[1])),
        localStorageKeys: unique([
            ...[...app.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(['"`]([^'"`]+)['"`]/g)].map(m => m[1]),
            ...[...resizable.matchAll(/STORAGE_KEY_[A-Z_]+\s*=\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1]),
        ]),
        domIds: unique([...html.matchAll(/\sid=['"`]([^'"`]+)['"`]/g)].map(m => m[1])).slice(0, 300),
        cssClasses: unique([...html.matchAll(/\sclass=['"`]([^'"`]+)['"`]/g)]
            .flatMap(m => m[1].split(/\s+/).filter(Boolean))).slice(0, 300),
        referenceTools: unique([...schemas.matchAll(/(search_reference|get_reference_detail|get_scene_context)/g)].map(m => m[1])),
        stableStrings: unique([
            APP_SIGNATURE.buildSignature,
            APP_SIGNATURE.schemaOwner,
            APP_SIGNATURE.appId,
            APP_SIGNATURE.provenanceVersion,
        ]),
    };
}

async function readText(rel) {
    try {
        return await fs.readFile(path.join(ROOT, rel), 'utf8');
    } catch {
        return '';
    }
}

function hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function unique(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
