import { spawn } from 'child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const electronArgs = args.length > 0 ? args : ['.'];

const child = spawn(electronPath, electronArgs, {
    cwd: process.cwd(),
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
