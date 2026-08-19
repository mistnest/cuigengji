/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function showMemoryExtractionResults(extractions) {
    const section = document.getElementById('extraction-section');
    const results = document.getElementById('extraction-results');
    if (!section || !results) return;

    const items = [];

    if (extractions.suggestions?.length > 0) {
        extractions.suggestions.forEach(s => {
            items.push({ icon: '💡', text: s.message, type: s.type });
        });
    }
    if (extractions.newCharacters?.length > 0) {
        extractions.newCharacters.forEach(c => {
            items.push({ icon: '👤', text: `新角色候选: ${c.name}`, type: 'character' });
        });
    }
    if (extractions.newWorldElements?.length > 0) {
        extractions.newWorldElements.forEach(e => {
            items.push({ icon: '🌍', text: `新世界观元素: ${e.element || e}`, type: 'world' });
        });
    }

    if (items.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    results.innerHTML = items.map(item => `
        <div class="extraction-item">
            <span>${item.icon}</span>
            <span style="font-size:11px;">${escHtml(item.text)}</span>
            <button class="extraction-add-btn" data-text="${escHtml(item.text)}">＋</button>
        </div>
    `).join('');

    // Auto-hide after 15 seconds
    clearTimeout(section._hideTimer);
    section._hideTimer = setTimeout(() => { section.style.display = 'none'; }, 15000);
}

// ==================== Editor ====================

async function generateSummary(text, type = 'worldbook') {
    const config = state.aiConfig || {};
    const presetName = state.presetName || '__default__';
    const data = await AutomationRuntime.execute('summary.generate', {
        text, type, config, presetName,
    });
    return data.summary || '';
}

// ==================== Preset Management ====================
