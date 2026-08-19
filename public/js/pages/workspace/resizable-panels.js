/**
 * 催更姬 — Resizable Panels
 * 可拖拽调整左右侧边栏宽度，持久化到项目 workspace
 */
const ResizablePanels = (function () {
    'use strict';

    function init() {
        const container = document.getElementById('main-container');
        const leftPanel = document.getElementById('left-sidebar');
        const editor = document.getElementById('editor-area');
        const rightPanel = document.getElementById('right-sidebar');
        if (!container || !leftPanel || !editor || !rightPanel) return;

        // Create resizer elements
        const leftResizer = createResizer('resizer-left');
        const rightResizer = createResizer('resizer-right');

        // Insert resizers between panels
        leftPanel.after(leftResizer);
        rightPanel.before(rightResizer);

        // Make draggable
        makeResizable(leftResizer, leftPanel, 'right');
        makeResizable(rightResizer, rightPanel, 'left');

        // Load saved sizes from the authoritative project workspace.
        const saved = getSavedSizes();
        applySavedWidth(leftPanel, saved.left);
        applySavedWidth(rightPanel, saved.right);
    }

    // Called by app.js after workspace loads, to re-apply sizes from server state
    function applyServerSizes(sizes) {
        if (!sizes) return;
        const leftPanel = document.getElementById('left-sidebar');
        const rightPanel = document.getElementById('right-sidebar');
        if (sizes.left) applySavedWidth(leftPanel, sizes.left);
        if (sizes.right) applySavedWidth(rightPanel, sizes.right);
    }

    function getSavedSizes() {
        const state = window.editorState;
        const fromServer = state?.panelLayout;
        if (fromServer && (fromServer.left || fromServer.right)) {
            return { left: fromServer.left || 0, right: fromServer.right || 0 };
        }
        return { left: 0, right: 0 };
    }

    function persistSizes(left, right) {
        // Save through the project workspace owner.
        const state = window.editorState;
        if (state) {
            state.panelLayout = { left, right };
            // Use the debounced save, don't hammer the server on every mousemove
            if (window.saveWorkspaceState) {
                clearTimeout(_persistTimer);
                _persistTimer = setTimeout(() => {
                    window.saveWorkspaceState({ silent: true }).catch(() => {});
                }, 1500);
            }
        }
    }
    let _persistTimer = null;

    function clearPersistedSizes() {
        const state = window.editorState;
        if (state) {
            state.panelLayout = {};
        }
    }

    function createResizer(id) {
        const el = document.createElement('div');
        el.className = 'panel-resizer';
        el.id = id;
        el.innerHTML = '<div class="panel-resizer-line"></div>';
        return el;
    }

    function applySavedWidth(panel, value) {
        const width = Number(value || 0);
        if (!Number.isFinite(width) || width <= 0) return;
        const minimum = minimumWidth(panel);
        const nextWidth = Math.max(minimum, width);
        panel.style.width = nextWidth + 'px';
        panel.style.minWidth = nextWidth + 'px';
    }

    function makeResizable(resizer, panel, edge) {
        let startX, startWidth;

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            startWidth = panel.offsetWidth;

            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            resizer.classList.add('active');

            function onMove(e) {
                const delta = edge === 'right' ? e.clientX - startX : startX - e.clientX;
                const newWidth = Math.max(minimumWidth(panel), startWidth + delta);
                panel.style.width = newWidth + 'px';
                panel.style.minWidth = newWidth + 'px';
            }

            function onUp() {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                resizer.classList.remove('active');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);

                const leftPanel = document.getElementById('left-sidebar');
                const rightPanel = document.getElementById('right-sidebar');
                persistSizes(
                    leftPanel ? leftPanel.offsetWidth : 0,
                    rightPanel ? rightPanel.offsetWidth : 0
                );
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function minimumWidth(panel) {
        return panel?.id === 'right-sidebar' ? 320 : 220;
    }

    return { init, applyServerSizes, clearPersistedSizes };
})();
window.ResizablePanels = ResizablePanels;
