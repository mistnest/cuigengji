/**
 * Novel AI Editor — Resizable Panels
 * 可拖拽调整左右侧边栏宽度
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

        // Load saved sizes
        const savedLeft = localStorage.getItem('panel-left-width');
        const savedRight = localStorage.getItem('panel-right-width');
        if (savedLeft) leftPanel.style.width = savedLeft + 'px';
        if (savedRight) rightPanel.style.width = savedRight + 'px';
    }

    function createResizer(id) {
        const el = document.createElement('div');
        el.className = 'panel-resizer';
        el.id = id;
        el.innerHTML = '<div class="panel-resizer-line"></div>';
        return el;
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
                const newWidth = Math.max(60, startWidth + delta);
                panel.style.width = newWidth + 'px';
                panel.style.minWidth = newWidth + 'px';
            }

            function onUp() {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                resizer.classList.remove('active');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                // Save
                const key = panel.id === 'left-sidebar' ? 'panel-left-width' : 'panel-right-width';
                localStorage.setItem(key, panel.offsetWidth);
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    return { init };
})();
