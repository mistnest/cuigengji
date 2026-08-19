import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'dev', 'architecture', 'runtime-closure.json');
const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['\"]([^'\"]+)['\"]\s*;?/gm;
const RE_EXPORT_RE = /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['\"]([^'\"]+)['\"]\s*;?/gm;
const SCRIPT_SRC_RE = /<script\s+[^>]*src=['\"]([^'\"]+)['\"][^>]*>/gi;

function normalize(filePath) {
    return filePath.split(path.sep).join('/');
}

function projectRelative(filePath) {
    return normalize(path.relative(PROJECT_ROOT, filePath));
}

function listFiles(root, predicate) {
    const files = [];
    if (!fs.existsSync(root)) return files;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) files.push(...listFiles(target, predicate));
        else if (predicate(target)) files.push(target);
    }
    return files;
}

function resolveLocalModule(importer, specifier) {
    if (!specifier.startsWith('.')) return null;
    const unresolved = path.resolve(path.dirname(importer), specifier);
    const candidates = path.extname(unresolved)
        ? [unresolved]
        : [unresolved, `${unresolved}.js`, path.join(unresolved, 'index.js')];
    const resolved = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) {
        throw new Error(`Missing local import ${specifier} from ${projectRelative(importer)}`);
    }
    return resolved;
}

function moduleSpecifiers(source) {
    // Production modules currently use static ESM imports. Anchoring to the
    // beginning of a line avoids treating JSDoc `import()` type references as
    // runtime dependencies.
    return [IMPORT_RE, RE_EXPORT_RE]
        .flatMap(pattern => [...source.matchAll(pattern)].map(match => match[1]));
}

function collectHostFiles(entrypoint) {
    const visited = new Set();
    const visit = filePath => {
        const resolved = path.resolve(filePath);
        if (visited.has(resolved)) return;
        visited.add(resolved);
        const source = fs.readFileSync(resolved, 'utf8');
        for (const specifier of moduleSpecifiers(source)) {
            const dependency = resolveLocalModule(resolved, specifier);
            if (dependency) visit(dependency);
        }
    };
    visit(entrypoint);
    return [...visited].map(projectRelative).sort();
}

function collectRendererScripts(htmlPath) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const htmlDir = path.dirname(htmlPath);
    return [...html.matchAll(SCRIPT_SRC_RE)].map(match => {
        const scriptPath = path.resolve(htmlDir, match[1]);
        if (!fs.existsSync(scriptPath)) {
            throw new Error(`Missing renderer script ${match[1]} from ${projectRelative(htmlPath)}`);
        }
        return projectRelative(scriptPath);
    });
}

export function collectRuntimeClosure() {
    const hostEntrypoints = [
        path.join(PROJECT_ROOT, 'electron', 'index.js'),
        path.join(PROJECT_ROOT, 'electron', 'preload.cjs'),
    ];
    const rendererEntrypoint = path.join(PROJECT_ROOT, 'public', 'index.html');
    const hostFiles = [...new Set(hostEntrypoints.flatMap(collectHostFiles))].sort();
    const reachableSrc = new Set(hostFiles.filter(file => file.startsWith('src/')));
    const allSrcFiles = listFiles(path.join(PROJECT_ROOT, 'src'), file => file.endsWith('.js'))
        .map(projectRelative)
        .sort();

    return {
        schemaVersion: 2,
        hostEntrypoints: hostEntrypoints.map(projectRelative),
        hostFiles,
        rendererEntrypoint: projectRelative(rendererEntrypoint),
        rendererScripts: collectRendererScripts(rendererEntrypoint),
        unreachableSrcFiles: allSrcFiles.filter(file => !reachableSrc.has(file)),
    };
}

function stableJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function run() {
    const actual = collectRuntimeClosure();
    if (process.argv.includes('--write')) {
        fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
        fs.writeFileSync(MANIFEST_PATH, stableJson(actual), 'utf8');
        console.log(`Updated ${projectRelative(MANIFEST_PATH)}`);
        return;
    }

    if (!fs.existsSync(MANIFEST_PATH)) {
        throw new Error('Runtime closure manifest is missing. Run npm run architecture:update intentionally.');
    }
    const expected = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (stableJson(actual) !== stableJson(expected)) {
        console.error('Production runtime closure changed.');
        console.error('Review the dependency change, then run npm run architecture:update if it is intentional.');
        process.exitCode = 1;
        return;
    }

    const activeBackendCount = actual.hostFiles.filter(file => file.startsWith('src/')).length;
    console.log(`Runtime closure OK: ${activeBackendCount} active src files, ${actual.unreachableSrcFiles.length} unreachable src files.`);
}

const isMainModule = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
    try {
        run();
    } catch (error) {
        console.error(error?.stack || error);
        process.exitCode = 1;
    }
}
