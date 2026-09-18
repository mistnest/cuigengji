import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceRoots = [
    path.join(projectRoot, 'shared', 'contracts'),
    path.join(projectRoot, 'src', 'backend', 'foundation', 'platform', 'events'),
    path.join(projectRoot, 'src', 'backend', 'foundation', 'platform', 'versioning'),
    path.join(projectRoot, 'src', 'backend', 'intelligence', 'agent', 'coordination'),
];
const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    // The package is ESM.  Transpilation only needs to preserve imports; the
    // repository's separate `typecheck` command performs NodeNext resolution.
    moduleResolution: ts.ModuleResolutionKind.Node10,
    sourceMap: false,
    removeComments: false,
};

async function collectTypeScriptFiles(root) {
    const result = [];
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
        if (error?.code === 'ENOENT') return result;
        throw error;
    }
    for (const entry of entries) {
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) result.push(...await collectTypeScriptFiles(file));
        else if (entry.isFile() && file.endsWith('.ts')) result.push(file);
    }
    return result;
}

async function render(file) {
    const source = await fs.readFile(file, 'utf8');
    const result = ts.transpileModule(source, {
        compilerOptions,
        fileName: file,
        reportDiagnostics: true,
    });
    const diagnostics = result.diagnostics || [];
    if (diagnostics.length > 0) {
        const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
            getCurrentDirectory: () => projectRoot,
            getCanonicalFileName: value => value,
            getNewLine: () => '\n',
        });
        throw new Error(message);
    }
    return result.outputText;
}

const checkOnly = process.argv.includes('--check');
const files = (await Promise.all(sourceRoots.map(collectTypeScriptFiles)))
    .flat()
    .sort();
const mismatches = [];
for (const file of files) {
    const output = await render(file);
    const target = file.replace(/\.ts$/u, '.js');
    let current = null;
    try {
        current = await fs.readFile(target, 'utf8');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    if (checkOnly) {
        if (current !== output) mismatches.push(path.relative(projectRoot, target));
    } else if (current !== output) {
        await fs.writeFile(target, output, 'utf8');
    }
}

if (checkOnly && mismatches.length > 0) {
    console.error('Generated TypeScript output is stale:');
    for (const file of mismatches) console.error(`- ${file}`);
    process.exitCode = 1;
} else {
    console.log(`${checkOnly ? 'Generated TypeScript output is current' : 'Generated TypeScript output'} (${files.length} files).`);
}
