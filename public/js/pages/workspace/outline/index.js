/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
async function onAddOutlineNode() {
    const title = prompt('大纲节点名称:');
    if (!title) return;

    try {
        const node = await Repositories.outlines.createNode(state.currentNovel.id, {
            title,
            description: '',
            type: 'plot',
        });
        state.outlineRevision = Number(node.revision || state.outlineRevision + 1);
        state.outline.push(node);
        renderOutlineTree();
        setStatus(`大纲节点已添加: ${title}`, 'success');
    } catch (err) {
        setStatus(`添加大纲失败: ${err.message}`, 'error');
    }
}

function renderOutlineTree() {
    const tree = $('#outline-tree');
    if (!state.outline.length) {
        tree.innerHTML = '<div class="tree-placeholder">尚未创建大纲<br>点击 "+ 新节点" 规划情节</div>';
        return;
    }

    tree.innerHTML = state.outline.map(n => `
        <div class="tree-item outline-node" data-id="${n.id}">
            <span class="outline-check">${n.completed ? '✅' : '☐'}</span>
            <span class="outline-title">${escHtml(n.title)}</span>
            ${n.description ? `<span class="outline-desc"> — ${escHtml(n.description)}</span>` : ''}
        </div>
    `).join('');

    tree.querySelectorAll('.outline-node').forEach(node => {
        node.addEventListener('click', () => toggleOutlineNode(node.dataset.id));
    });
}

async function toggleOutlineNode(id) {
    const node = state.outline.find(n => n.id === id);
    if (!node) return;
    const previous = node.completed;
    node.completed = !previous;
    renderOutlineTree();
    try {
        const updated = await Repositories.outlines.updateNode(state.currentNovel.id, id, {
            completed: node.completed,
            expectedRevision: state.outlineRevision,
        });
        Object.assign(node, updated);
        state.outlineRevision = Number(updated.revision || state.outlineRevision + 1);
    } catch (error) {
        node.completed = previous;
        renderOutlineTree();
        setStatus(`更新大纲失败: ${error.message}`, 'error');
    }
}
