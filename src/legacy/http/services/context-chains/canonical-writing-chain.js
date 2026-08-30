/**
 * The only runtime context order used by the compatibility automation path.
 *
 * Presets describe writing policy.  They do not choose where project data is
 * inserted.  World books, character cards and plot context are always
 * normalized into these fixed sections, which keeps cache prefixes stable and
 * prevents imported marker formats from changing application behavior.
 */
export const CANONICAL_IMPORT_ORDER = Object.freeze([
    'worldSetting',
    'characterState',
    'plotHistory',
    'recentPlot',
]);

export function sortCanonicalImportMessages(messages = [], importMeta = {}) {
    const order = new Map(CANONICAL_IMPORT_ORDER.map((key, index) => [
        importMeta[key]?.name,
        index,
    ]));
    return [...messages].sort((left, right) => (
        (order.get(left?.name) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(right?.name) ?? Number.MAX_SAFE_INTEGER)
    ));
}

export function isCanonicalImportBeforePreset(message = {}, importMeta = {}) {
    return message.name === importMeta.worldSetting?.name
        || message.name === importMeta.characterState?.name;
}
