import { expect, test } from '@playwright/test';

await import('../../../public/js/pages/workspace/agent/state/agent-store.js');

function event(seq, type, data, overrides = {}) {
    return {
        schemaVersion: 1,
        projectId: 'project-1',
        sessionId: 'session-1',
        generation: 2,
        seq,
        time: seq,
        type,
        data,
        ...overrides,
    };
}

function readyStore() {
    const store = globalThis.AgentStoreModule.createAgentStore();
    store.setProject({
        projectId: 'project-1',
        sessionId: 'session-1',
        status: {
            state: 'ready', ready: true, hasCredential: true, generation: 2,
        },
        context: { chapterId: 'chapter-1', generatedAt: 'now', knowledgeEntries: 3 },
    });
    return store;
}

test('@interface Agent store folds history and live events deterministically', () => {
    const sequence = [
        event(1, 'turn.started', { turn: 1 }),
        event(2, 'message.user', { messageId: 'm1', text: '继续写作', source: 'user' }),
        event(3, 'assistant.delta', { turn: 1, step: 1, kind: 'reasoning', text: '先想。' }),
        event(4, 'assistant.delta', { turn: 1, step: 1, kind: 'text', text: '版本 A' }),
        event(5, 'assistant.completed', { turn: 1, step: 1, text: '最终版本' }),
        event(6, 'turn.completed', { turn: 1, reason: 'completed' }),
    ];
    const first = readyStore();
    first.applyEvent(sequence[5]);
    first.applyEvent(sequence[4]);
    first.applyHistory('session-1', sequence.slice(0, 5));
    first.applyEvent(sequence[4]);

    const second = readyStore();
    second.applyHistory('session-1', sequence);

    expect(first.debugSnapshot()).toEqual(second.debugSnapshot());
    expect(first.getState().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'user', text: '继续写作' }),
        expect.objectContaining({ kind: 'assistant', text: '最终版本', reasoning: '先想。' }),
    ]));
    expect(first.getState().running).toBe(false);
});

test('@interface Agent store reconciles optimistic prompts and isolates generations', () => {
    const store = readyStore();
    const pendingId = store.addOptimistic('同一句话', 'queue');
    store.acceptOptimistic(pendingId);
    expect(store.getState().pendingPrompts).toHaveLength(1);
    store.applyEvent(event(1, 'message.user', {
        messageId: 'm1', text: '同一句话', source: 'user',
    }));
    expect(store.getState().pendingPrompts).toHaveLength(0);

    store.applyEvent(event(2, 'message.user', { messageId: 'old', text: '旧代消息' }, { generation: 1 }));
    store.applyEvent(event(3, 'message.user', { messageId: 'other', text: '串项目' }, {
        projectId: 'project-2',
    }));
    expect(store.getState().items.map(item => item.text)).not.toEqual(
        expect.arrayContaining(['旧代消息', '串项目']),
    );
});

test('@interface Agent store keeps injected runtime context out of the conversation', () => {
    const store = readyStore();
    store.applyHistory('session-1', [
        event(1, 'message.user', {
            messageId: 'context', text: 'private runtime context', source: 'runtime',
        }),
        event(2, 'message.user', {
            messageId: 'human', text: '用户问题', source: 'user',
        }),
    ]);
    expect(store.getState().items.map(item => item.text)).toEqual(['用户问题']);
});

test('@interface Agent store keeps the safe tool summary when completion has no replacement', () => {
    const store = readyStore();
    store.applyHistory('session-1', [
        event(1, 'tool.started', {
            turn: 1,
            step: 1,
            callId: 'web-1',
            name: 'web_search',
            label: '搜索网络资料',
            summary: '搜索“明代县衙职位”',
        }),
        event(2, 'tool.completed', {
            turn: 1,
            step: 1,
            callId: 'web-1',
            status: 'success',
            summary: '',
        }),
    ]);

    expect(store.getState().items).toContainEqual(expect.objectContaining({
        kind: 'tool',
        name: 'web_search',
        status: 'success',
        summary: '搜索“明代县衙职位”',
    }));
});

test('@interface Agent store projects outline proposals and keeps local apply state', () => {
    const store = readyStore();
    const proposal = {
        proposalId: '12345678-1234-4234-8234-123456789abc',
        baseRevision: 2,
        summary: '补充阶段兑现',
        reason: '当前大纲缺少回报节点。',
        operations: [{ kind: 'create', ref: 'payoff', title: '第一次兑现' }],
        impact: ['增强回报'],
        assumptions: [],
        hasDelete: false,
    };
    store.applyHistory('session-1', [
        event(1, 'tool.started', {
            turn: 1,
            step: 1,
            callId: 'proposal-call',
            name: 'propose_outline_patch',
            label: '整理大纲修改提案',
            summary: '整理 1 项大纲修改',
        }),
        event(2, 'proposal.outline', {
            turn: 1,
            step: 1,
            callId: 'proposal-call',
            proposal,
        }),
    ]);
    expect(store.getState().items).toEqual(expect.arrayContaining([
        expect.objectContaining({
            kind: 'tool', status: 'success', summary: '大纲修改提案已整理',
        }),
        expect.objectContaining({
            kind: 'proposal', proposal, applyState: 'idle',
        }),
    ]));

    store.setProposalApplyState(proposal.proposalId, 'applied', '已应用。');
    expect(store.getState().items).toContainEqual(expect.objectContaining({
        kind: 'proposal', applyState: 'applied', applyMessage: '已应用。',
    }));
});

test('@interface Agent store restores rejected text without keeping duplicate pending items', () => {
    const store = readyStore();
    const pendingId = store.addOptimistic('恢复这段文字', 'queue');
    store.rejectOptimistic(pendingId, '暂时失败');
    expect(store.getState().items.at(-1)).toMatchObject({ status: 'error' });
    store.restorePending(pendingId);
    expect(store.getState().composer.text).toBe('恢复这段文字');
    expect(store.getState().pendingPrompts).toHaveLength(0);
});
