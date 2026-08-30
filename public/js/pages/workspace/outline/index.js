/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
async function onAddOutlineNode() {
    const title = prompt('大纲节点名称:');
    if (!title) return;

    const projectId = state.currentNovel?.id;
    const workspaceToken = Number(state.workspaceActionToken || 0);
    const mutationToken = ++state.outlineMutationToken;
    if (!projectId) return;

    try {
        const node = await Repositories.outlines.createNode(projectId, {
            title,
            description: '',
            type: 'plot',
            expectedRevision: state.outlineRevision,
            expectedContentHash: state.outlineContentHash,
        });
        if (!isOutlineMutationCurrent(projectId, workspaceToken, mutationToken)) return;
        state.outlineRevision = Number(node.revision || state.outlineRevision + 1);
        state.outlineContentHash = String(node.contentHash || state.outlineContentHash || '');
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
    const projectId = state.currentNovel?.id;
    const workspaceToken = Number(state.workspaceActionToken || 0);
    const mutationToken = ++state.outlineMutationToken;
    if (!projectId) return;
    const previous = node.completed;
    node.completed = !previous;
    renderOutlineTree();
    try {
        const updated = await Repositories.outlines.updateNode(projectId, id, {
            completed: node.completed,
            expectedRevision: state.outlineRevision,
            expectedContentHash: state.outlineContentHash,
        });
        if (!isOutlineMutationCurrent(projectId, workspaceToken, mutationToken)) return;
        Object.assign(node, updated);
        state.outlineRevision = Number(updated.revision || state.outlineRevision + 1);
        state.outlineContentHash = String(updated.contentHash || state.outlineContentHash || '');
    } catch (error) {
        if (!isOutlineMutationCurrent(projectId, workspaceToken, mutationToken)) return;
        node.completed = previous;
        // A failed CAS may mean another window already committed a different
        // outline. Reload the authoritative aggregate instead of rolling back
        // to a local snapshot that is no longer valid.
        try {
            const latest = await Repositories.outlines.get(projectId);
            if (!isOutlineMutationCurrent(projectId, workspaceToken, mutationToken)) return;
            state.outline = Array.isArray(latest?.nodes) ? latest.nodes : [];
            state.outlineRevision = Number(latest?.revision || 0);
            state.outlineContentHash = String(latest?.contentHash || '');
        } catch {
            // Keep the local value if the recovery read itself fails.
        }
        renderOutlineTree();
        setStatus(`更新大纲失败: ${error.message}`, 'error');
    }
}

function isOutlineMutationCurrent(projectId, workspaceToken, mutationToken) {
    return Boolean(projectId)
        && state.currentNovel?.id === projectId
        && Number(state.workspaceActionToken || 0) === workspaceToken
        && Number(state.outlineMutationToken || 0) === mutationToken;
}
