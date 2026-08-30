(function (root) {
    'use strict';

    function mountAgentConversation({
        store, viewport, list, empty, jumpButton,
        onApplyProposal = async () => {},
        getOutlineRevision = () => 0,
    }) {
        let frame = 0;
        let latestState;
        let followBottom = true;
        const onScroll = () => {
            followBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
            jumpButton.hidden = followBottom;
        };
        const jump = () => {
            viewport.scrollTop = viewport.scrollHeight;
            followBottom = true;
            jumpButton.hidden = true;
        };
        viewport.addEventListener('scroll', onScroll, { passive: true });
        jumpButton.addEventListener('click', jump);
        const unsubscribe = store.subscribe(state => {
            latestState = state;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(render);
        });
        function render() {
            frame = 0;
            const shouldFollow = followBottom;
            list.replaceChildren(...latestState.items.map(item => renderItem(item, store, {
                onApplyProposal,
                getOutlineRevision,
            })));
            empty.hidden = latestState.items.length > 0;
            if (shouldFollow) requestAnimationFrame(jump);
        }
        return () => {
            unsubscribe();
            cancelAnimationFrame(frame);
            viewport.removeEventListener('scroll', onScroll);
            jumpButton.removeEventListener('click', jump);
        };
    }

    function renderItem(item, store, options) {
        if (item.kind === 'assistant') return assistantItem(item);
        if (item.kind === 'tool') return toolItem(item);
        if (item.kind === 'proposal') return proposalItem(item, options);
        if (item.kind === 'error') return errorItem(item);
        return userItem(item, store);
    }
    function userItem(item, store) {
        const article = element('article', 'agent-message agent-message--user');
        article.dataset.key = item.key;
        article.append(element('div', 'agent-message__label', '你'));
        article.append(element('div', 'agent-message__text', item.text));
        if (item.status === 'sending' || item.status === 'accepted') {
            article.append(element('span', 'agent-message__meta', '等待 Agent 接收…'));
        }
        if (item.status === 'error') {
            article.classList.add('is-error');
            article.append(element('span', 'agent-message__meta', item.error || '发送失败'));
            const restore = element('button', 'agent-inline-action', '恢复到输入框');
            restore.type = 'button';
            restore.addEventListener('click', () => store.restorePending(item.pendingId));
            article.append(restore);
        }
        return article;
    }
    function assistantItem(item) {
        const article = element('article', 'agent-message agent-message--assistant');
        article.dataset.key = item.key;
        article.append(element('div', 'agent-message__label', item.status === 'streaming' ? 'Agent 正在回答' : 'Agent'));
        if (item.reasoning) {
            const details = element('details', 'agent-reasoning');
            details.append(
                element('summary', '', item.status === 'streaming' ? '思考过程 · 进行中' : '思考过程'),
                element('div', 'agent-reasoning__body', item.reasoning),
            );
            article.append(details);
        }
        const answer = element('div', 'agent-message__text agent-message__answer');
        appendSafeAnswer(answer, item.text || '…');
        article.append(answer);
        return article;
    }
    function toolItem(item) {
        const article = element('article', `agent-tool-card is-${item.status || 'running'}`);
        article.dataset.key = item.key;
        const status = item.status === 'running' ? '进行中' : item.status === 'success' ? '完成' : '失败';
        article.append(
            element('div', 'agent-tool-card__title', item.label || 'Agent 工具'),
            element('div', 'agent-tool-card__summary', item.summary || ''),
            element('span', 'agent-tool-card__status', status),
        );
        return article;
    }
    function proposalItem(item, { onApplyProposal, getOutlineRevision }) {
        const proposal = item.proposal;
        const article = element('article', 'agent-proposal-card');
        article.dataset.key = item.key;
        article.append(
            element('div', 'agent-proposal-card__eyebrow', '大纲修改提案'),
            element('strong', 'agent-proposal-card__title', proposal.summary),
            element('p', 'agent-proposal-card__reason', proposal.reason),
            element(
                'div',
                'agent-proposal-card__meta',
                `${proposal.operations.length} 项修改 · 基于大纲版本 ${proposal.baseRevision}`,
            ),
        );
        const operations = element('ul', 'agent-proposal-card__operations');
        for (const operation of proposal.operations) {
            operations.append(element('li', '', proposalOperationText(operation)));
        }
        article.append(operations);
        if (proposal.impact.length) article.append(proposalList('主要影响', proposal.impact));
        if (proposal.assumptions.length) article.append(proposalList('仍属假设', proposal.assumptions));
        if (proposal.hasDelete) {
            article.append(element('p', 'agent-proposal-card__warning', '包含删除操作，应用时需要再次确认。'));
        }

        const currentRevision = Number(getOutlineRevision());
        const stale = currentRevision !== Number(proposal.baseRevision);
        const actions = element('div', 'agent-proposal-card__actions');
        const button = element('button', 'agent-proposal-card__apply');
        button.type = 'button';
        button.disabled = stale || ['applying', 'applied'].includes(item.applyState);
        if (item.applyState === 'applying') button.textContent = '正在应用…';
        else if (item.applyState === 'applied') button.textContent = '已应用';
        else if (stale) button.textContent = '已应用或已过期';
        else button.textContent = '应用到大纲';
        button.addEventListener('click', () => void onApplyProposal(proposal));
        actions.append(button);
        if (item.applyMessage) {
            actions.append(element(
                'span',
                `agent-proposal-card__result is-${item.applyState}`,
                item.applyMessage,
            ));
        }
        article.append(actions);
        return article;
    }

    function proposalList(title, values) {
        const section = element('section', 'agent-proposal-card__section');
        section.append(element('strong', '', title));
        const list = element('ul', '');
        for (const value of values) list.append(element('li', '', value));
        section.append(list);
        return section;
    }

    function proposalOperationText(operation) {
        if (operation.kind === 'create') return `新增：${operation.title || operation.ref || '大纲节点'}`;
        if (operation.kind === 'update') return `修改：${operation.nodeId || operation.nodeRef || '大纲节点'}`;
        if (operation.kind === 'reorder') return `调整顺序：${operation.nodeId || operation.nodeRef || '大纲节点'}`;
        if (operation.kind === 'delete') return `删除：${operation.nodeId || operation.nodeRef || '大纲节点'}`;
        return '未知修改';
    }
    function errorItem(item) {
        const article = element('article', 'agent-error-notice');
        article.dataset.key = item.key;
        article.append(
            element('strong', '', item.reason === 'aborted' ? '生成已停止' : '本轮未完成'),
            element('span', '', item.text || '请重试。'),
        );
        return article;
    }
    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function appendSafeAnswer(container, text) {
        const source = String(text || '');
        const pattern = /\[([^\]\r\n]{1,300})\]\((https:\/\/[^\s)]+)\)/giu;
        let cursor = 0;
        for (const match of source.matchAll(pattern)) {
            const index = Number(match.index || 0);
            if (index > cursor) container.append(document.createTextNode(source.slice(cursor, index)));
            const link = safeExternalLink(match[1], match[2]);
            if (link) container.append(link);
            else container.append(document.createTextNode(match[0]));
            cursor = index + match[0].length;
        }
        if (cursor < source.length) container.append(document.createTextNode(source.slice(cursor)));
    }

    function safeExternalLink(label, rawUrl) {
        let url;
        try {
            url = new URL(rawUrl);
        } catch {
            return null;
        }
        if (url.protocol !== 'https:' || url.username || url.password) return null;
        const link = element('a', 'agent-source-link', label);
        link.href = url.href;
        link.rel = 'noreferrer';
        link.addEventListener('click', event => {
            event.preventDefault();
            void root.cuigengji?.app?.openExternal(url.href).catch(() => {});
        });
        return link;
    }
    root.AgentConversationModule = Object.freeze({ mountAgentConversation });
}(window));
