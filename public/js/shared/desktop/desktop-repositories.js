(function () {
    'use strict';

    const desktop = window.DesktopApi;
    if (!desktop) throw new Error('DesktopApi is required');

    const modules = window.CuigengjiModules || {};
    modules.repositories = Object.freeze({
        projects: desktop.project.projects,
        chapters: desktop.project.chapters,
        outlines: desktop.project.outlines,
        sessions: desktop.agent.workspaceSessions,
        workspaces: desktop.project.workspace,
        references: desktop.knowledge.references,
        presets: desktop.configuration.presets,
        imports: desktop.exchange.imports,
        exports: desktop.exchange.exports,
        settings: Object.freeze({
            secretStatus: desktop.configuration.secrets.status,
            saveSecret: desktop.configuration.secrets.save,
            deleteSecret: desktop.configuration.secrets.delete,
            getPreferences: desktop.configuration.preferences.get,
            updatePreferences: desktop.configuration.preferences.update,
        }),
        providers: Object.freeze({
            listModels: desktop.models.catalog.list,
            testConnection: desktop.models.connection.test,
            detectProxy: desktop.models.connection.detectProxy,
        }),
    });
    window.CuigengjiModules = Object.freeze(modules);
}());
