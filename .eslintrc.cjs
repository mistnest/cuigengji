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
    overrides: [
        {
            files: ['electron/preload-src/**/*.cjs'],
            globals: {
                DESKTOP_API_VERSION: 'readonly',
                createInvoke: 'readonly',
                createAppFacade: 'readonly',
                createProjectFacade: 'readonly',
                createKnowledgeFacade: 'readonly',
                createConfigurationFacade: 'readonly',
                createModelsFacade: 'readonly',
                createAgentFacade: 'readonly',
                createAutomationFacade: 'readonly',
                createExchangeFacade: 'readonly',
            },
            rules: {
                // These sources are concatenated into one sandbox preload bundle.
                'no-unused-vars': 'off',
            },
        },
    ],
};
