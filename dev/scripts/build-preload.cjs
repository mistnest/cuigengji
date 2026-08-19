'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const sourceRoot = path.join(projectRoot, 'electron', 'preload-src');
const target = path.join(projectRoot, 'electron', 'preload.cjs');
const sources = [
    'core/runtime.cjs',
    'app.cjs',
    'project.cjs',
    'knowledge.cjs',
    'configuration.cjs',
    'models.cjs',
    'agent.cjs',
    'automation.cjs',
    'exchange.cjs',
    'entry.cjs',
];

const banner = [
    "'use strict';",
    '',
    '// GENERATED FILE. Edit electron/preload-src and run npm run build:preload.',
    '// The concatenated bundle is required because Electron sandbox preload cannot load local modules.',
    '',
].join('\n');
const output = banner + sources.map(file => {
    const content = fs.readFileSync(path.join(sourceRoot, file), 'utf8')
        .replace(/^['"]use strict['"];\s*/u, '');
    return `// ---- ${file} ----\n${content.trim()}\n`;
}).join('\n');

if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== output) {
        console.error('electron/preload.cjs is stale. Run npm run build:preload.');
        process.exitCode = 1;
    }
} else {
    fs.writeFileSync(target, output, 'utf8');
    console.log(`Generated ${path.relative(projectRoot, target)} from ${sources.length} sources.`);
}
