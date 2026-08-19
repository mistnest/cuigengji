/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function persistAppSignature() {
    const build = window.__CUIGENGJI_BUILD__;
    if (!build?.schemaOwner) return;
    setPreference('provenance', {
        schemaOwner: build.schemaOwner,
        appId: build.appId,
        signature: build.buildSignature,
        version: build.version,
    });
}
