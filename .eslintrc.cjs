module.exports = {
    root: true,
    env: {
        browser: true,
        es2022: true,
        node: true,
    },
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    globals: {
        ChatPanel: 'readonly',
        ChapterTree: 'readonly',
        PlotCandidates: 'readonly',
        ResizablePanels: 'readonly',
    },
    rules: {
        'no-undef': 'error',
        'no-redeclare': 'error',
        'no-unused-vars': ['warn', {
            argsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
        }],
    },
};
