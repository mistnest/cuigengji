/* Graph workspace: summary-first node list, lazy body editor, CAS mutations. */
'use strict';
/* eslint-disable no-undef */

(function graphWorkspace() {
    let selected;
    let graphVersion = 0;
    let nodes = [];
    const kindLabels = { world_book: '世界书', world_entry: '世界书条目', character_card: '角色卡' };
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const projectId = () => (typeof state !== 'undefined' ? state.currentNovel?.id : '') || '';
    const api = () => window.cuigengji?.knowledge?.graph;

    async function refresh() {
        const id = projectId();
        const list = document.querySelector('#graph-node-list');
        if (!id || !list || !api()) return;
        list.innerHTML = '<div class="list-placeholder">加载图谱中…</div>';
        try {
            const query = document.querySelector('#graph-search')?.value || '';
            const kind = document.querySelector('#graph-kind-filter')?.value;
            const response = await api().searchNodes(id, query, { kinds: kind ? [kind] : undefined, limit: 200 });
            nodes = response?.data?.nodes || response?.nodes || [];
            graphVersion = Number(response?.data?.graphVersion || response?.graphVersion || 0);
            renderList();
        } catch (error) {
            list.innerHTML = `<div class="list-placeholder">图谱加载失败：${escapeHtml(error?.message || error)}</div>`;
        }
    }

    function renderList() {
        const list = document.querySelector('#graph-node-list');
        if (!nodes.length) { list.innerHTML = '<div class="list-placeholder">暂无图谱节点</div>'; return; }
        list.innerHTML = nodes.map(node => `<button class="graph-node-row ${selected?.id === node.id ? 'active' : ''}" data-node-id="${escapeHtml(node.id)}">
            <span class="graph-node-kind">${escapeHtml(kindLabels[node.kind] || node.kind)}</span>
            <strong>${escapeHtml(node.name)}</strong><small>${escapeHtml(node.summary || '')}</small>
        </button>`).join('');
        list.querySelectorAll('[data-node-id]').forEach(button => button.addEventListener('click', () => selectNode(button.dataset.nodeId)));
    }

    async function selectNode(nodeId) {
        try {
            const response = await api().getNode(projectId(), nodeId, true);
            selected = response?.data?.node || response?.node;
            graphVersion = Number(response?.data?.graphVersion || response?.graphVersion || graphVersion);
            renderList();
            renderDetail();
        } catch (error) { document.querySelector('#graph-detail').innerHTML = `<div class="list-placeholder">读取失败：${escapeHtml(error?.message || error)}</div>`; }
    }

    function renderDetail() {
        const detail = document.querySelector('#graph-detail');
        if (!selected) { detail.innerHTML = '<div class="list-placeholder">选择一个节点查看详情</div>'; return; }
        detail.innerHTML = `<div class="graph-editor" data-node-id="${escapeHtml(selected.id)}">
            <label>类型<select id="graph-edit-kind" class="ai-select" ${selected.version ? 'disabled' : ''}>${Object.entries(kindLabels).map(([value, label]) => `<option value="${value}" ${selected.kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <label>名称<input id="graph-edit-name" class="ai-input" value="${escapeHtml(selected.name)}"></label>
            <label>摘要<textarea id="graph-edit-summary" class="ai-input" rows="3">${escapeHtml(selected.summary)}</textarea></label>
            <label>正文<textarea id="graph-edit-body" class="graph-body-editor">${escapeHtml(selected.body || '')}</textarea></label>
            <div class="graph-editor-actions"><button id="graph-save-node" class="ai-btn-primary">保存</button><button id="graph-delete-node" class="ai-btn-secondary">删除</button><button id="graph-add-edge" class="ai-btn-secondary">添加关系</button></div>
            <div id="graph-edge-list" class="graph-edge-list">加载关系…</div>
            <div class="graph-version">版本 ${selected.version} · 图谱 ${graphVersion}</div>
        </div>`;
        detail.querySelector('#graph-save-node').addEventListener('click', () => saveNode(false));
        detail.querySelector('#graph-delete-node').addEventListener('click', () => saveNode(true));
        detail.querySelector('#graph-add-edge').addEventListener('click', createEdge);
        loadEdges();
    }

    async function loadEdges() {
        if (!selected) return;
        const response = await api().listEdges(projectId(), selected.id, { direction: 'both', limit: 100 });
        const edges = response?.data?.edges || response?.edges || [];
        const list = document.querySelector('#graph-edge-list');
        if (!list) return;
        list.innerHTML = edges.length ? `<strong>关系</strong>${edges.map(edge => `<div class="graph-edge-row"><button class="graph-edge-edit" data-edge-id="${escapeHtml(edge.id)}">${escapeHtml(edge.type)} · ${escapeHtml(edge.fromNodeId === selected.id ? edge.toNodeId : edge.fromNodeId)}</button><button class="graph-edge-delete" data-edge-id="${escapeHtml(edge.id)}">删除</button></div>`).join('')}` : '<span class="graph-version">暂无关系</span>';
        list.querySelectorAll('.graph-edge-edit').forEach(button => button.addEventListener('click', () => editEdge(button.dataset.edgeId, edges.find(edge => edge.id === button.dataset.edgeId))));
        list.querySelectorAll('.graph-edge-delete').forEach(button => button.addEventListener('click', () => deleteEdge(button.dataset.edgeId, edges.find(edge => edge.id === button.dataset.edgeId))));
    }

    async function createEdge() {
        if (!selected) return;
        const target = prompt('目标节点 ID：')?.trim();
        const type = prompt('关系类型：', 'related_to')?.trim();
        if (!target || !type) return;
        const result = await api().commit(projectId(), { expectedGraphVersion: graphVersion, operations: [{
            op: 'upsert_edge', expectedVersion: 0, edge: {
                id: `edge_${Date.now()}`, type, fromNodeId: selected.id, toNodeId: target,
                summary: prompt('关系摘要：', '') || type, body: prompt('关系正文：', '') || type, sourceRevisionId: 'manual',
            },
        }] });
        const payload = result?.data || result; graphVersion = Number(payload.graphVersion || graphVersion + 1); loadEdges();
    }

    async function deleteEdge(edgeId, edge) {
        if (!edge || !(typeof globalThis.safeConfirm === 'function' ? globalThis.safeConfirm(`删除关系 ${edgeId}？`) : confirm(`删除关系 ${edgeId}？`))) return;
        const result = await api().commit(projectId(), { expectedGraphVersion: graphVersion, operations: [{ op: 'delete_edge', expectedVersion: edge.version, edgeId }] });
        const payload = result?.data || result; graphVersion = Number(payload.graphVersion || graphVersion + 1); loadEdges();
    }

    async function editEdge(edgeId, edge) {
        if (!edge) return;
        const type = prompt('关系类型：', edge.type)?.trim();
        if (!type) return;
        const summary = prompt('关系摘要：', edge.summary)?.trim();
        const body = prompt('关系正文：', edge.body)?.trim();
        const result = await api().commit(projectId(), { expectedGraphVersion: graphVersion, operations: [{
            op: 'upsert_edge', expectedVersion: edge.version,
            edge: { ...edge, type, summary: summary || edge.summary, body: body || edge.body, sourceRevisionId: 'manual' },
        }] });
        const payload = result?.data || result; graphVersion = Number(payload.graphVersion || graphVersion + 1); loadEdges();
    }

    async function saveNode(deleteNode) {
        if (!selected) return;
        if (deleteNode && !(typeof globalThis.safeConfirm === 'function' ? globalThis.safeConfirm(`删除节点「${selected.name}」？`) : confirm(`删除节点「${selected.name}」？`))) return;
        const request = { expectedGraphVersion: graphVersion, operations: [{
            op: deleteNode ? 'delete_node' : 'upsert_node', expectedVersion: selected.version,
            ...(deleteNode ? { nodeId: selected.id } : { node: {
                id: selected.id, kind: selected.kind,
                name: document.querySelector('#graph-edit-name').value.trim(),
                summary: document.querySelector('#graph-edit-summary').value.trim(),
                body: document.querySelector('#graph-edit-body').value || '暂无正文',
                sourceRevisionId: selected.sourceRevisionId || String(selected.version),
            } }),
        }] };
        try {
            const result = await api().commit(projectId(), request);
            const payload = result?.data || result;
            graphVersion = Number(payload.graphVersion || graphVersion + 1);
            selected = null;
            await refresh();
            renderDetail();
        } catch (error) { alert(`图谱保存失败：${error?.message || error}`); }
    }

    function createNode() {
        const id = `node_${Date.now()}`;
        selected = { id, kind: 'world_book', name: '新节点', summary: '', body: '', sourceRevisionId: '0', version: 0 };
        renderDetail();
        document.querySelector('#graph-save-node')?.addEventListener('click', async () => {
            const request = { expectedGraphVersion: graphVersion, operations: [{ op: 'upsert_node', expectedVersion: 0, node: {
                id, kind: document.querySelector('#graph-edit-kind').value, name: document.querySelector('#graph-edit-name').value.trim(),
                summary: document.querySelector('#graph-edit-summary').value.trim() || '图谱节点', body: document.querySelector('#graph-edit-body').value || '暂无正文',
                sourceRevisionId: 'manual',
            } }] };
            try {
                const result = await api().commit(projectId(), request); const payload = result?.data || result;
                graphVersion = Number(payload.graphVersion || graphVersion + 1); selected = null; await refresh(); renderDetail();
            } catch (error) { alert(`图谱保存失败：${error?.message || error}`); }
        }, { once: true });
    }

    function bind() {
        document.querySelector('#btn-graph-refresh')?.addEventListener('click', refresh);
        document.querySelector('#btn-graph-new-node')?.addEventListener('click', createNode);
        document.querySelector('#btn-graph-new-edge')?.addEventListener('click', () => {
            if (selected) return createEdge();
            alert('请先选择关系的起点节点。');
        });
        document.querySelector('#graph-search')?.addEventListener('input', refresh);
        document.querySelector('#graph-kind-filter')?.addEventListener('change', refresh);
        window.CuigengjiGraphWorkspace = Object.freeze({ refresh });
        window.CuigengjiProjectEvents?.subscribe?.(event => {
            if (event?.projectId === projectId() && ['graph', 'worldbook', 'character'].includes(event.entityType)) void refresh();
        });
        window.addEventListener('cuigengji:project-changed', event => {
            if (event.detail?.projectId === projectId() && ['graph', 'worldbook', 'character'].includes(event.detail?.entityType)) void refresh();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else bind();
})();
