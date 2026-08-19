/**
 * Chapter tree, VS Code style.
 * Volumes are folders, chapters are files. Chapters can be dragged between volumes.
 */
const ChapterTree = (function () {
    'use strict';

    let state = { chapters: [], currentChapterId: null, openVolumes: {} };
    const listeners = {};
    let dragChapterId = null;
    let isDragging = false;
    let openTimer = null;

    function on(eventName, fn) {
        (listeners[eventName] = listeners[eventName] || []).push(fn);
    }

    function emit(eventName, data) {
        (listeners[eventName] || []).forEach(fn => fn(data));
    }

    function render(chapters, currentId) {
        state.chapters = chapters || [];
        state.currentChapterId = currentId;

        const tree = document.getElementById('chapter-tree');
        if (!tree) return;
        tree.innerHTML = '';

        if (!state.chapters.length) {
            tree.innerHTML = '<div class="tree-placeholder">尚未创建章节<br>点击“新章节”开始写作</div>';
            return;
        }

        const volumes = state.chapters.filter(c => c.type === 'volume');
        const orphan = state.chapters.filter(c => c.type !== 'volume' && !c.volumeId);
        const chaptersByVolume = new Map();
        for (const chapter of state.chapters) {
            if (chapter.type === 'volume' || !chapter.volumeId) continue;
            const group = chaptersByVolume.get(chapter.volumeId) || [];
            group.push(chapter);
            chaptersByVolume.set(chapter.volumeId, group);
        }
        const fragment = document.createDocumentFragment();

        volumes.forEach(volume => {
            fragment.appendChild(buildVolume(volume, chaptersByVolume.get(volume.id) || []));
        });

        const orphanArea = document.createElement('div');
        orphanArea.className = 'tree-orphan-area';
        orphanArea.dataset.dropLabel = 'root';

        if (orphan.length) {
            orphan.forEach(chapter => orphanArea.appendChild(buildChapterItem(chapter)));
        } else {
            const empty = document.createElement('div');
            empty.className = 'tree-chapter-empty';
            empty.textContent = '拖到这里移出卷';
            orphanArea.appendChild(empty);
        }
        makeDropTarget(orphanArea, null);
        fragment.appendChild(orphanArea);
        tree.appendChild(fragment);

        updateSelect();

        requestAnimationFrame(() => {
            if (window.DomAnimator && state.chapters.length <= 300) {
                window.DomAnimator.staggerIn(tree, '.tree-chapter-item, .tree-volume-wrapper', 0.04);
            }
        });
    }

    function buildVolume(volume, chapters) {
        const wrapper = document.createElement('div');
        wrapper.className = 'tree-volume-wrapper';
        wrapper.dataset.volumeId = volume.id;

        const header = document.createElement('div');
        header.className = 'tree-volume-header';
        header.dataset.volumeId = volume.id;

        const isOpen = state.openVolumes[volume.id] !== false;
        header.innerHTML = `
            <span class="tree-twistie">${isOpen ? '▾' : '▸'}</span>
            <span class="tree-volume-name">${esc(volume.title)}</span>
            <button class="tree-volume-delete" title="删除卷">×</button>
        `;

        header.querySelector('.tree-twistie').addEventListener('click', event => {
            event.stopPropagation();
            state.openVolumes[volume.id] = !isOpen;
            render(state.chapters, state.currentChapterId);
        });

        header.querySelector('.tree-volume-delete').addEventListener('click', event => {
            event.stopPropagation();
            const count = chapters.length;
            const message = count > 0
                ? `删除卷“${volume.title}”？\n其中的 ${count} 个章节将变为未归卷。`
                : `删除卷“${volume.title}”？`;
            if (confirm(message)) emit('delete', volume.id);
        });

        wrapper.appendChild(header);

        if (isOpen) {
            const group = document.createElement('div');
            group.className = 'tree-chapter-group';
            group.dataset.volumeId = volume.id;

            if (chapters.length) {
                chapters.forEach(chapter => group.appendChild(buildChapterItem(chapter)));
            } else {
                const empty = document.createElement('div');
                empty.className = 'tree-chapter-empty';
                empty.textContent = '拖拽章节到此卷';
                group.appendChild(empty);
            }

            wrapper.appendChild(group);
            makeDropTarget(group, volume.id);
        }

        makeDropTarget(header, volume.id);
        makeDropTarget(wrapper, volume.id, { volumeWrapper: true });
        return wrapper;
    }

    function buildChapterItem(chapter) {
        const el = document.createElement('div');
        el.className = 'tree-chapter-item' + (chapter.id === state.currentChapterId ? ' active' : '');
        el.dataset.chapterId = chapter.id;
        el.draggable = true;

        const icon = chapter.status === 'completed' ? '✓' : chapter.status === 'revised' ? '✎' : '📄';
        el.innerHTML = `
            <span class="tree-drag-handle" title="拖拽移动">⋮⋮</span>
            <span class="tree-chapter-icon">${icon}</span>
            <span class="tree-chapter-title">${esc(chapter.title)}</span>
            <span class="tree-chapter-meta">${chapter.wordCount || 0}字</span>
            <button class="tree-chapter-delete" title="删除">×</button>
        `;

        el.addEventListener('click', event => {
            if (event.target.closest('.tree-chapter-delete') || event.target.closest('.tree-drag-handle')) return;
            if (isDragging) return;
            emit('select', chapter.id);
        });

        el.querySelector('.tree-chapter-delete').addEventListener('click', event => {
            event.stopPropagation();
            if (confirm(`删除“${chapter.title}”？`)) emit('delete', chapter.id);
        });

        el.addEventListener('dragstart', event => {
            dragChapterId = chapter.id;
            isDragging = true;
            el.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', chapter.id);
            event.dataTransfer.setData('application/x-novel-chapter-id', chapter.id);
        });

        el.addEventListener('dragend', clearDragState);
        return el;
    }

    function makeDropTarget(el, volumeId, options = {}) {
        el.addEventListener('dragover', event => {
            if (!getDraggedChapterId(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            el.classList.add('drag-over');

            if (options.volumeWrapper && volumeId && state.openVolumes[volumeId] === false) {
                clearTimeout(openTimer);
                openTimer = setTimeout(() => {
                    state.openVolumes[volumeId] = true;
                    render(state.chapters, state.currentChapterId);
                }, 450);
            }
        });

        el.addEventListener('dragleave', event => {
            if (el.contains(event.relatedTarget)) return;
            el.classList.remove('drag-over');
            if (options.volumeWrapper) clearTimeout(openTimer);
        });

        el.addEventListener('drop', event => {
            const chapterId = getDraggedChapterId(event);
            if (!chapterId) return;
            event.preventDefault();
            event.stopPropagation();
            clearTimeout(openTimer);
            el.classList.remove('drag-over');

            // Find which chapter to insert before (for within-volume reordering)
            let beforeChapterId = null;
            const dropY = event.clientY;
            const chapterItems = el.querySelectorAll('.tree-chapter-item');
            let closestDist = Infinity;
            chapterItems.forEach(item => {
                if (item.dataset.chapterId === chapterId) return; // skip self
                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const dist = Math.abs(dropY - midY);
                if (dist < closestDist) {
                    closestDist = dist;
                    beforeChapterId = item.dataset.chapterId;
                }
            });

            emit('reorder', { chapterId, volumeId, beforeChapterId });
            clearDragState();
        });
    }

    function getDraggedChapterId(event) {
        return event?.dataTransfer?.getData('application/x-novel-chapter-id')
            || event?.dataTransfer?.getData('text/plain')
            || dragChapterId;
    }

    function clearDragState() {
        clearTimeout(openTimer);
        openTimer = null;
        dragChapterId = null;
        isDragging = false;
        document.querySelectorAll('.dragging, .drag-over').forEach(el => {
            el.classList.remove('dragging', 'drag-over');
        });
    }

    function updateSelect() {
        const select = document.getElementById('chapter-select');
        if (!select) return;

        // Find current chapter's volume
        const currentChapter = state.chapters.find(c => c.id === state.currentChapterId);
        const currentVolumeId = currentChapter?.volumeId;

        // Only show chapters in the same volume (or same orphan status)
        const chapters = state.chapters.filter(c => {
            if (c.type === 'volume') return false;
            if (currentVolumeId) return c.volumeId === currentVolumeId;
            return !c.volumeId;
        });

        const fragment = document.createDocumentFragment();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— 选择章节 —';
        fragment.appendChild(placeholder);
        chapters.forEach(chapter => {
            const option = document.createElement('option');
            option.value = chapter.id;
            option.textContent = chapter.title || '';
            option.selected = chapter.id === state.currentChapterId;
            fragment.appendChild(option);
        });
        select.replaceChildren(fragment);
    }

    function select(currentId) {
        const previous = state.chapters.find(chapter => chapter.id === state.currentChapterId);
        const current = state.chapters.find(chapter => chapter.id === currentId);
        state.currentChapterId = currentId;

        document.querySelector('.tree-chapter-item.active')?.classList.remove('active');
        const active = [...document.querySelectorAll('.tree-chapter-item')]
            .find(item => item.dataset.chapterId === currentId);
        active?.classList.add('active');

        if (previous?.volumeId !== current?.volumeId) {
            updateSelect();
        } else {
            const chapterSelect = document.getElementById('chapter-select');
            if (chapterSelect) chapterSelect.value = currentId || '';
        }
    }

    function esc(value) {
        const el = document.createElement('span');
        el.textContent = value || '';
        return el.innerHTML;
    }

    return {
        render,
        select,
        on,
        getState: () => state,
        getCurrentId: () => state.currentChapterId,
    };
})();
window.ChapterTree = ChapterTree;
