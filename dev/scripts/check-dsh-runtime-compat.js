import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
    DSH_PLUGIN_ABI_PACKAGES,
    SUPPORTED_DSH_VERSION,
    assertDshRuntimeCompatibility,
} from '../../electron/intelligence/agent/dsh/dsh-runtime-contract.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_FILE = path.join(PROJECT_ROOT, 'package.json');
const LOCK_FILE = path.join(PROJECT_ROOT, 'package-lock.json');
const DSH_PACKAGE_PREFIX = '@deepseek-ai/dsh';

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isDshPackage(packageName) {
    return packageName === DSH_PACKAGE_PREFIX || packageName.startsWith(`${DSH_PACKAGE_PREFIX}-`);
}

function packageNameFromLockPath(lockPath) {
    const marker = 'node_modules/';
    const offset = lockPath.lastIndexOf(marker);
    return offset >= 0 ? lockPath.slice(offset + marker.length) : '';
}

function validateManifest(manifest, errors) {
    const dependencies = manifest.dependencies || {};
    for (const packageName of DSH_PLUGIN_ABI_PACKAGES) {
        if (dependencies[packageName] !== SUPPORTED_DSH_VERSION) {
            errors.push(
                `${packageName} must be an exact direct dependency at ${SUPPORTED_DSH_VERSION}`,
            );
        }
    }
    for (const [packageName, version] of Object.entries(dependencies)) {
        if (isDshPackage(packageName) && version !== SUPPORTED_DSH_VERSION) {
            errors.push(`${packageName} is pinned to ${version}, expected ${SUPPORTED_DSH_VERSION}`);
        }
    }
}

function validateLock(lock, errors) {
    const packages = lock.packages || {};
    const lockedDshPackages = new Map();
    for (const [lockPath, metadata] of Object.entries(packages)) {
        const packageName = packageNameFromLockPath(lockPath);
        if (!isDshPackage(packageName)) continue;
        lockedDshPackages.set(packageName, metadata);
        if (metadata.version !== SUPPORTED_DSH_VERSION) {
            errors.push(
                `${packageName} lock version is ${metadata.version || 'missing'}, `
                + `expected ${SUPPORTED_DSH_VERSION}`,
            );
        }
    }
    for (const packageName of DSH_PLUGIN_ABI_PACKAGES) {
        if (!lockedDshPackages.has(packageName)) {
            errors.push(`${packageName} is missing from package-lock.json`);
        }
    }
    for (const [owner, metadata] of lockedDshPackages) {
        for (const [peerName, peerRange] of Object.entries(metadata.peerDependencies || {})) {
            if (!isDshPackage(peerName)) continue;
            const peer = lockedDshPackages.get(peerName);
            if (!peer) {
                errors.push(`${owner} requires missing peer ${peerName}@${peerRange}`);
            } else if (peer.version !== SUPPORTED_DSH_VERSION) {
                errors.push(
                    `${owner} requires ${peerName}@${peerRange}, but lock has ${peer.version}`,
                );
            }
        }
    }
    return lockedDshPackages.size;
}

const errors = [];
const manifest = readJson(PACKAGE_FILE);
const lock = readJson(LOCK_FILE);
validateManifest(manifest, errors);
const lockedPackageCount = validateLock(lock, errors);

try {
    assertDshRuntimeCompatibility();
} catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
}

if (errors.length > 0) {
    console.error('DeepSeek Harness compatibility check failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
} else {
    console.log(
        `DeepSeek Harness compatibility check passed: ${lockedPackageCount} packages at `
        + `${SUPPORTED_DSH_VERSION}`,
    );
}
