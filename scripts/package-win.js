import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const node = process.execPath;
const rawArgs = process.argv.slice(2);

const options = {
    clean: !rawArgs.includes('--no-clean'),
    fingerprint: !rawArgs.includes('--skip-fingerprint'),
    tests: rawArgs.includes('--with-tests'),
    dryRun: rawArgs.includes('--dry-run'),
};

const builderArgs = rawArgs.filter(arg =>
    !['--no-clean', '--skip-fingerprint', '--with-tests', '--dry-run'].includes(arg));

function log(message = '') {
    console.log(`[package-win] ${message}`);
}

function run(command, args = []) {
    log(`> ${[command, ...args].join(' ')}`);
    if (options.dryRun) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: projectRoot,
            stdio: 'inherit',
            env: process.env,
        });
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`${command} exited with signal ${signal}`));
                return;
            }
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`${command} exited with code ${code}`));
        });
    });
}

async function readPackageInfo() {
    const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
    return {
        name: pkg.name || 'cuigengji',
        version: pkg.version || '0.0.0',
        productName: pkg.build?.productName || '催更姬',
    };
}

async function cleanDist() {
    if (!options.clean) return;
    log('Cleaning dist/');
    if (!options.dryRun) await fs.rm(distDir, { recursive: true, force: true });
}

async function listArtifacts() {
    if (options.dryRun) return;
    let files = [];
    try {
        files = await fs.readdir(distDir, { withFileTypes: true });
    } catch {
        log('No dist/ directory was produced.');
        return;
    }

    const artifacts = files
        .filter(file => file.isFile() && /\.(exe|blockmap|yml)$/i.test(file.name))
        .map(file => file.name)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));

    if (!artifacts.length) {
        log('No release artifacts found in dist/.');
        return;
    }

    log('Release artifacts:');
    for (const name of artifacts) {
        console.log(`  - dist/${name}`);
    }
}

const info = await readPackageInfo();
log(`${info.productName} ${info.name}@${info.version}`);
await cleanDist();

if (options.tests) {
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:smoke']);
}

if (options.fingerprint) {
    await run(node, ['scripts/create-fingerprint-manifest.js']);
}

await run(node, ['scripts/build-win.js', ...builderArgs]);
await listArtifacts();
log('Done.');
