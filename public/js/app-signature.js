(function () {
    'use strict';

    const signature = Object.freeze({
        name: 'cuigengji',
        displayName: '催更姬',
        version: '0.1.0',
        owner: 'mistnest',
        repository: 'https://github.com/mistnest/cuigengji',
        appId: 'com.mistnest.cuigengji',
        schemaOwner: 'mistnest-cuigengji',
        license: 'Cuigengji Community License 1.0',
        sourceModel: 'source-available',
        buildSignature: 'cgj-mistnest-2026-community-source',
        provenanceVersion: 'cgj-provenance-v1',
    });

    window.__CUIGENGJI_BUILD__ = signature;
    document.documentElement.dataset.cuigengjiApp = signature.schemaOwner;
})();
