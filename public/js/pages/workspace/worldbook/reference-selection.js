/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function getIncompleteOutline() {
    return state.outline.filter(n => !n.completed);
}

function getReferencedWorldBook() {
    const mode = state.writingReference?.worldbookMode || 'all';
    if (mode === 'off') return { ...state.worldBook, entries: {} };
    if (mode !== 'selected') return state.worldBook;
    const groups = new Set(state.writingReference.selectedWorldbookGroups || []);
    return {
        ...state.worldBook,
        entries: Object.fromEntries(Object.entries(state.worldBook?.entries || {})
            .filter(([, entry]) => groups.has(getWorldBookFolder(entry)))),
    };
}

function getReferencedCharacters(text = '') {
    const mode = state.writingReference?.characterMode || 'auto';
    if (mode === 'off') return [];
    const selected = new Set(state.writingReference.selectedCharacters || []);
    return state.characters.filter(character => {
        if (isCharacterDisabled(character)) return false;
        const name = character.data?.name || character.name || '';
        if (!name) return false;
        if (mode === 'selected') return selected.has(name);
        return text.includes(name);
    });
}

function isCharacterDisabled(character = {}) {
    const data = character.data || character;
    return character.disable === true
        || character.disabled === true
        || character.enabled === false
        || data.disable === true
        || data.disabled === true
        || data.enabled === false
        || data.extensions?.cuigengji?.disabled === true
        || data.extensions?.novel_ai_editor?.disabled === true;
}

function setCharacterDisabled(character = {}, disabled = false) {
    character.disable = Boolean(disabled);
    character.disabled = Boolean(disabled);
    character.enabled = !disabled;
    if (character.data && typeof character.data === 'object') {
        character.data.disable = Boolean(disabled);
        character.data.disabled = Boolean(disabled);
        character.data.enabled = !disabled;
    }
}
