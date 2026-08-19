export const ST_MARKER_TO_IMPORT = {
    worldInfoBefore: 'worldInfoBefore',
    worldInfoAfter: 'worldInfoAfter',
    charDescription: 'charDescription',
    charPersonality: 'charPersonality',
    scenario: 'scenario',
    personaDescription: 'authorPreference',
    dialogueExamples: 'dialogueExamples',
};

export const ST_SPECIAL_MARKERS = new Set([
    'chatHistory',
]);

export const ST_IMPORT_MARKERS = new Set(Object.values(ST_MARKER_TO_IMPORT));

export const ST_MARKER_IDENTIFIERS = new Set([
    ...Object.keys(ST_MARKER_TO_IMPORT),
    ...ST_SPECIAL_MARKERS,
]);

export function isStMarkerIdentifier(identifier = '') {
    return ST_MARKER_IDENTIFIERS.has(String(identifier || ''));
}

export function getStImportKey(markerId = '') {
    return ST_MARKER_TO_IMPORT[String(markerId || '')] || '';
}

export function isStSpecialMarker(markerId = '') {
    return ST_SPECIAL_MARKERS.has(String(markerId || ''));
}
