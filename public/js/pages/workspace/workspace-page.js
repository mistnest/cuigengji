/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function switchTab(tab) {
    const sidebar = tab.closest('.sidebar');
    const panelName = tab.dataset.panel;
    sidebar.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    sidebar.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
    const panel = sidebar.querySelector(`#panel-${panelName}`);
    if (panel) panel.classList.add('active');
    if (sidebar.id === 'right-sidebar') {
        window.AgentWorkbenchFeature?.setVisible(panelName === 'chat');
    }
    setPreference('rightSidebarTab', panelName);
}

function restoreSidebarTab() {
    const panelName = Preferences.get('rightSidebarTab', '');
    if (!panelName) return;
    const tab = document.querySelector(`#right-sidebar .sidebar-tab[data-panel="${CSS.escape(panelName)}"]`);
    if (tab) switchTab(tab);
}

// ==================== Toolbar Actions ====================
