export const NATIVE_IMPORT_ORDER = ['worldSetting', 'characterState', 'plotHistory', 'recentPlot'];

export const NATIVE_MARKER_TO_IMPORT = {
    'cgj-import-worldSetting': 'worldSetting',
    'cgj-import-characterState': 'characterState',
    'cgj-import-plotHistory': 'plotHistory',
    'cgj-import-recentPlot': 'recentPlot',
};

export const NATIVE_IMPORT_MARKERS = new Set(Object.values(NATIVE_MARKER_TO_IMPORT));

export function isNativeMarkerIdentifier(identifier = '') {
    return Object.prototype.hasOwnProperty.call(NATIVE_MARKER_TO_IMPORT, String(identifier || ''));
}

export function getNativeImportKey(markerId = '') {
    return NATIVE_MARKER_TO_IMPORT[String(markerId || '')] || '';
}

export function isNativeReferenceMode(context = {}) {
    if (context.nativeReference === true) return true;
    const mode = String(context.referenceMode || context.contextMode || context.writingReference?.mode || '').toLowerCase();
    return ['tool', 'tools', 'compact', 'reference_tools', 'novel_tools', 'native'].includes(mode)
        || context.compactReference === true
        || context.referenceTools === true
        || context.enableReferenceTools === true;
}

export function sortNativeImportMessages(messages = [], importMeta = {}) {
    const order = new Map(NATIVE_IMPORT_ORDER.map((key, index) => [importMeta[key]?.name, index]));
    return [...messages].sort((a, b) =>
        (order.get(a?.name) ?? Number.MAX_SAFE_INTEGER) - (order.get(b?.name) ?? Number.MAX_SAFE_INTEGER));
}

export function isNativeImportBeforePreset(message = {}, importMeta = {}) {
    return message.name === importMeta.worldSetting?.name
        || message.name === importMeta.characterState?.name;
}
