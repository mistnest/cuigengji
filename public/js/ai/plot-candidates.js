/**
 * Novel AI Editor — Plot Candidates Panel
 * 情节候选展示面板：模态窗口、卡片选择、直接填入
 */
const PlotCandidates = (function () {
    'use strict';

    // ==================== Show Candidates Modal ====================
    function show(candidates, onSelect) {
        // Remove existing modal
        close();

        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';
        overlay.id = 'plot-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'plot-modal';
        modal.innerHTML = `
            <div class="plot-modal-header">
                <h3>💡 情节发展候选</h3>
                <span class="plot-modal-count">共 ${candidates.length} 条建议</span>
                <button class="plot-modal-close" title="关闭">✕</button>
            </div>
            <div class="plot-modal-body">
                ${candidates.map((c, i) => renderCard(c, i)).join('')}
            </div>
            <div class="plot-modal-footer">
                <button class="plot-btn-cancel">取消</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Bind events
        overlay.querySelector('.plot-modal-close').addEventListener('click', close);
        overlay.querySelector('.plot-btn-cancel').addEventListener('click', close);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        modal.querySelectorAll('.plot-card-select').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const candidate = candidates[index];
                if (onSelect) onSelect(candidate);
                close();
            });
        });

        modal.querySelectorAll('.plot-card-preview-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.plot-card');
                const preview = card.querySelector('.plot-card-preview');
                preview.classList.toggle('expanded');
            });
        });

        // Animation
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function renderCard(c, i) {
        const excitementStars = '⭐'.repeat(Math.min(10, Math.max(1, c.excitement || 5)));
        return `
            <div class="plot-card">
                <div class="plot-card-header">
                    <span class="plot-card-index">候选 ${i + 1}</span>
                    <span class="plot-card-excitement">${excitementStars}</span>
                </div>
                <div class="plot-card-direction">
                    <span class="plot-card-label">情节走向</span>
                    <p>${escHtml(c.direction || '无描述')}</p>
                </div>
                ${c.conflict ? `
                <div class="plot-card-conflict">
                    <span class="plot-card-label">⚔️ 冲突点</span>
                    <p>${escHtml(c.conflict)}</p>
                </div>` : ''}
                <div class="plot-card-meta">
                    ${c.estimatedWords ? `<span>📏 预计 ${c.estimatedWords} 字</span>` : ''}
                    ${c.charactersInvolved?.length ? `<span>👥 ${c.charactersInvolved.join(', ')}</span>` : ''}
                </div>
                ${c.preview ? `
                <div class="plot-card-preview collapsed">
                    <span class="plot-card-label">📝 预览片段</span>
                    <p>${escHtml(c.preview)}</p>
                </div>
                <button class="plot-card-preview-btn">展开预览 ▼</button>` : ''}
                <button class="plot-card-select" data-index="${i}">✨ 选择这个方向</button>
            </div>
        `;
    }

    function close() {
        const overlay = document.getElementById('plot-modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 200);
        }
    }

    // ==================== Inspiration Panel ====================
    function showInspiration(data) {
        const overlay = document.createElement('div');
        overlay.className = 'plot-modal-overlay';
        overlay.id = 'inspire-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'plot-modal inspire-modal';
        modal.innerHTML = `
            <div class="plot-modal-header">
                <h3>🎲 灵感启发</h3>
                <button class="plot-modal-close">✕</button>
            </div>
            <div class="plot-modal-body inspiration-body">
                <div class="inspiration-content markdown-like">${formatInspiration(data.content || data.inspiration || '')}</div>
            </div>
            <div class="plot-modal-footer">
                <button class="plot-btn-cancel">关闭</button>
                <button class="plot-btn-refresh">🔄 换一批</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.querySelector('.plot-modal-close').addEventListener('click', () => overlay.remove());
        overlay.querySelector('.plot-btn-cancel').addEventListener('click', () => overlay.remove());
        overlay.querySelector('.plot-btn-refresh').addEventListener('click', () => {
            overlay.remove();
            // Trigger new inspiration (via event)
            document.dispatchEvent(new CustomEvent('inspire:refresh'));
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function formatInspiration(text) {
        if (!text) return '<p>暂无灵感内容</p>';
        // Convert markdown-like formatting to HTML
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/^#{1,3}\s+(.+)$/gm, '<h4>$1</h4>')
            .replace(/^-\s+(.+)$/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
    }

    // ==================== Quick Insert ====================
    function quickInsert(text, editorEl) {
        if (!editorEl) return;
        const start = editorEl.selectionStart;
        const end = editorEl.selectionEnd;
        const before = editorEl.value.substring(0, start);
        const after = editorEl.value.substring(end);
        editorEl.value = before + (before ? '\n\n' : '') + text + after;
        editorEl.focus();
        editorEl.selectionStart = editorEl.selectionEnd = editorEl.value.length;
    }

    return {
        show,
        close,
        showInspiration,
        quickInsert,
    };
})();
window.PlotCandidates = PlotCandidates;

function escHtml(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}
