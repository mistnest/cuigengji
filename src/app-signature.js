export const APP_SIGNATURE = Object.freeze({
    name: 'cuigengji',
    displayName: '催更姬',
    version: '1.0.0',
    owner: 'mistnest',
    repository: 'https://github.com/mistnest/cuigengji',
    appId: 'com.mistnest.cuigengji',
    schemaOwner: 'mistnest-cuigengji',
    licenseName: 'Cuigengji Community License 1.0',
    licenseFile: 'LICENSE',
    sourceModel: 'source-available',
    buildSignature: 'cgj-mistnest-2026-community-source',
    provenanceVersion: 'cgj-provenance-v1',
});

export function getPublicAppSignature() {
    return {
        name: APP_SIGNATURE.name,
        displayName: APP_SIGNATURE.displayName,
        version: APP_SIGNATURE.version,
        owner: APP_SIGNATURE.owner,
        repository: APP_SIGNATURE.repository,
        appId: APP_SIGNATURE.appId,
        schemaOwner: APP_SIGNATURE.schemaOwner,
        license: APP_SIGNATURE.licenseName,
        licenseFile: APP_SIGNATURE.licenseFile,
        sourceModel: APP_SIGNATURE.sourceModel,
        buildSignature: APP_SIGNATURE.buildSignature,
        provenanceVersion: APP_SIGNATURE.provenanceVersion,
    };
}

export function getSignatureHeaders() {
    return {
        'X-Cuigengji-App': `${APP_SIGNATURE.owner}/${APP_SIGNATURE.name}`,
        'X-Cuigengji-App-Id': APP_SIGNATURE.appId,
        'X-Cuigengji-Signature': APP_SIGNATURE.buildSignature,
        'X-Cuigengji-License': APP_SIGNATURE.licenseName,
    };
}
