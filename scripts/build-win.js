import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const builderCli = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
const winCodeSignVersion = '2.6.0';

function defaultBuilderCache() {
    if (process.platform === 'win32') {
        return path.join(projectRoot, '.cache', 'electron-builder');
    }
    return path.join(os.homedir(), '.cache', 'electron-builder');
}

const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false',
    ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || defaultBuilderCache(),
    ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

const args = ['--win', '--x64', '--publish', 'never', ...process.argv.slice(2)];

async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function findExistingWinCodeSign(vendorDir, targetDir) {
    const roots = [vendorDir];
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
        roots.push(path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign'));
    }

    for (const root of roots) {
        if (!await pathExists(root)) continue;
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const candidate = path.join(root, entry.name);
            if (path.resolve(candidate) === path.resolve(targetDir)) continue;
            if (await pathExists(path.join(candidate, 'rcedit-x64.exe'))) {
                return candidate;
            }
        }
    }
    return null;
}

async function downloadFile(url, target) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(target, data);
}

function runCommand(command, commandArgs) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, {
            cwd: projectRoot,
            env,
            stdio: 'inherit',
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

async function ensureWinCodeSignCache() {
    if (process.platform !== 'win32') return;

    const vendorDir = path.join(env.ELECTRON_BUILDER_CACHE, 'winCodeSign');
    const targetDir = path.join(vendorDir, `winCodeSign-${winCodeSignVersion}`);
    const targetRcedit = path.join(targetDir, 'rcedit-x64.exe');
    if (await pathExists(targetRcedit)) return;

    await fs.mkdir(vendorDir, { recursive: true });

    const existing = await findExistingWinCodeSign(vendorDir, targetDir);
    if (existing) {
        await fs.rm(targetDir, { recursive: true, force: true });
        await fs.cp(existing, targetDir, { recursive: true });
        if (await pathExists(targetRcedit)) return;
    }

    const archiveName = `winCodeSign-${winCodeSignVersion}.7z`;
    const archivePath = path.join(vendorDir, archiveName);
    const extractDir = path.join(vendorDir, `winCodeSign-${winCodeSignVersion}-extracting`);
    const archiveUrl = `${env.ELECTRON_BUILDER_BINARIES_MIRROR}winCodeSign-${winCodeSignVersion}/${archiveName}`;
    const sevenZip = path.join(projectRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

    await downloadFile(archiveUrl, archivePath);
    await fs.rm(extractDir, { recursive: true, force: true });
    await fs.mkdir(extractDir, { recursive: true });

    try {
        await runCommand(sevenZip, ['x', '-y', '-bd', archivePath, `-o${extractDir}`]);
    } catch (error) {
        if (!await pathExists(path.join(extractDir, 'rcedit-x64.exe'))) {
            throw error;
        }
        console.warn('[build-win] winCodeSign extracted with non-critical symlink warnings; continuing.');
    }

    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.rename(extractDir, targetDir).catch(async () => {
        await fs.cp(extractDir, targetDir, { recursive: true });
        await fs.rm(extractDir, { recursive: true, force: true });
    });

    if (!await pathExists(targetRcedit)) {
        throw new Error(`winCodeSign cache is incomplete: ${targetRcedit} not found`);
    }
}

await ensureWinCodeSignCache();

const child = spawn(process.execPath, [builderCli, ...args], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
