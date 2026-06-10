/**
 * Novel AI Editor — Chapter Tree Component
 * 章节树管理：展开/折叠、拖拽排序、右键菜单
 */
const ChapterTree = (function () {
    'use strict';

    let state = {
        chapters: [],
        currentChapterId: null,
        expandedVolumes: {},
    };

    // Events
    const listeners = {};

    function on(event, fn) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
    }

    function emit(event, data) {
        (listeners[event] || []).forEach(fn => fn(data));
    }

    // ==================== Render ====================
    function render(chapters, currentId) {
        state.chapters = chapters || [];
        state.currentChapterId = currentId;

        const tree = document.getElementById('chapter-tree');
        if (!tree) return;

        if (state.chapters.length === 0) {
            tree.innerHTML = `<div class="tree-placeholder">尚未创建章节<br>点击 "+ 新章节" 开始写作</div>`;
            updateChapterSelect();
            return;
        }

        // Group chapters by volume
        const volumes = [];
        let currentVolume = null;
        for (const ch of state.chapters) {
            if (ch.type === 'volume') {
                currentVolume = { ...ch, chapters: [] };
                volumes.push(currentVolume);
            } else if (currentVolume) {
                currentVolume.chapters.push(ch);
            } else {
                // Chapters without a volume
                if (!volumes.find(v => v.id === '__orphan__')) {
                    volumes.push({ id: '__orphan__', title: '未分卷', type: 'volume', chapters: [] });
                }
                volumes.find(v => v.id === '__orphan__').chapters.push(ch);
            }
        }

        tree.innerHTML = volumes.map(vol => renderVolume(vol)).join('');

        // Bind events
        tree.querySelectorAll('.tree-volume-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const volId = btn.dataset.volumeId;
                state.expandedVolumes[volId] = !state.expandedVolumes[volId];
                render(state.chapters, state.currentChapterId);
            });
        });

        tree.querySelectorAll('.tree-chapter-item').forEach(item => {
            item.addEventListener('click', () => {
                const chapterId = item.dataset.chapterId;
                emit('select', chapterId);
            });

            item.addEventListener('dblclick', () => {
                const chapterId = item.dataset.chapterId;
                emit('rename', chapterId);
            });
        });

        updateChapterSelect();
    }

    function renderVolume(vol) {
        const isExpanded = state.expandedVolumes[vol.id] !== false; // default expanded
        const icon = isExpanded ? '▼' : '▶';
        const isOrphan = vol.id === '__orphan__';

        let html = '';
        if (!isOrphan) {
            html += `<div class="tree-volume" data-volume-id="${vol.id}">
                <span class="tree-volume-toggle" data-volume-id="${vol.id}">${icon}</span>
                <span class="tree-volume-title">📁 ${escHtml(vol.title)}</span>
            </div>`;
        }

        if (isExpanded && vol.chapters?.length > 0) {
            html += vol.chapters.map(ch => renderChapter(ch)).join('');
        }

        return html;
    }

    function renderChapter(ch) {
        const isActive = ch.id === state.currentChapterId;
        const cls = `tree-chapter-item${isActive ? ' active' : ''}`;
        const statusIcon = ch.status === 'completed' ? '✅' :
                          ch.status === 'revised' ? '📝' : '📄';

        return `<div class="${cls}" data-chapter-id="${ch.id}">
            <span class="tree-chapter-icon">${statusIcon}</span>
            <span class="tree-chapter-title">${escHtml(ch.title)}</span>
            <span class="tree-chapter-meta">${ch.wordCount || 0}字</span>
        </div>`;
    }

    function updateChapterSelect() {
        const select = document.getElementById('chapter-select');
        if (!select) return;

        select.innerHTML = '<option value="">— 选择章节 —</option>';
        for (const ch of state.chapters) {
            if (ch.type !== 'volume') {
                const selected = ch.id === state.currentChapterId ? ' selected' : '';
                select.innerHTML += `<option value="${ch.id}"${selected}>${escHtml(ch.title)}</option>`;
            }
        }
    }

    // ==================== Public API ====================
    return {
        render,
        on,
        getState: () => state,
        getCurrentId: () => state.currentChapterId,
    };
})();

// Utility
function escHtml(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}
