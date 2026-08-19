import { spawn } from 'child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import electronPath from 'electron';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const workspaceRuntimeRoot = path.resolve(
    projectRoot,
    '..',
    'workspace-local',
    'cuigengji',
    'runtime',
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (!env.CUIGENGJI_DATA_ROOT && existsSync(path.join(workspaceRuntimeRoot, 'data'))) {
    env.CUIGENGJI_DATA_ROOT = path.join(workspaceRuntimeRoot, 'data');
}
if (!env.CUIGENGJI_DSH_ROOT && existsSync(workspaceRuntimeRoot)) {
    env.CUIGENGJI_DSH_ROOT = path.join(workspaceRuntimeRoot, 'deepseek-harness');
}

const args = process.argv.slice(2);
const electronArgs = args.length > 0 ? args : ['.'];

const child = spawn(electronPath, electronArgs, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    windowsHide: false,
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});
