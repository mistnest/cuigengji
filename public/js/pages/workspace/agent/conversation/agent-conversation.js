(function (root) {
    'use strict';

    function mountAgentConversation({ store, viewport, list, empty, jumpButton }) {
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
            list.replaceChildren(...latestState.items.map(item => renderItem(item, store)));
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

    function renderItem(item, store) {
        if (item.kind === 'assistant') return assistantItem(item);
        if (item.kind === 'tool') return toolItem(item);
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
        article.append(element('div', 'agent-message__text agent-message__answer', item.text || '…'));
        return article;
    }
    function toolItem(item) {
        const article = element('article', `agent-tool-card is-${item.status || 'running'}`);
        article.dataset.key = item.key;
        const status = item.status === 'running' ? '进行中' : item.status === 'success' ? '完成' : '失败';
        article.append(
            element('div', 'agent-tool-card__title', item.label || '项目资料工具'),
            element('div', 'agent-tool-card__summary', item.summary || ''),
            element('span', 'agent-tool-card__status', status),
        );
        return article;
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
    root.AgentConversationModule = Object.freeze({ mountAgentConversation });
}(window));
