export function createDshSessionRegistry() {
    let projectId = '';
    let workspaceId = '';
    let activeSessionId = '';
    let generation = 0;
    const knownSessionIds = new Set();
    const seenSeqs = new Map();
    const maxSeqs = new Map();

    function reset(input = {}) {
        projectId = input.projectId || '';
        workspaceId = input.workspaceId || '';
        activeSessionId = input.activeSessionId || '';
        generation = Number(input.generation || 0);
        knownSessionIds.clear();
        seenSeqs.clear();
        maxSeqs.clear();
        for (const sessionId of input.sessionIds || []) addSession(sessionId);
        if (activeSessionId) addSession(activeSessionId);
    }

    function addSession(sessionId) {
        validateId(sessionId, 'sessionId');
        knownSessionIds.add(sessionId);
        if (!seenSeqs.has(sessionId)) seenSeqs.set(sessionId, new Set());
    }

    function setActive(sessionId) {
        assertSession(sessionId, projectId);
        activeSessionId = sessionId;
    }

    function assertProject(candidateProjectId) {
        if (!projectId || candidateProjectId !== projectId) {
            const error = new Error('Agent project does not match the active runtime');
            error.code = 'AGENT_SESSION_PROJECT_MISMATCH';
            throw error;
        }
    }

    function assertSession(sessionId, candidateProjectId) {
        assertProject(candidateProjectId);
        if (!knownSessionIds.has(sessionId)) {
            const error = new Error('Agent session does not belong to the active project');
            error.code = 'AGENT_SESSION_NOT_FOUND';
            throw error;
        }
    }

    function accept(sessionId, seq, candidateGeneration = generation) {
        if (candidateGeneration !== generation || !knownSessionIds.has(sessionId)) return false;
        if (!Number.isInteger(seq) || seq < 0) return false;
        const seen = seenSeqs.get(sessionId) || new Set();
        if (seen.has(seq)) return false;
        seen.add(seq);
        seenSeqs.set(sessionId, seen);
        maxSeqs.set(sessionId, Math.max(maxSeqs.get(sessionId) ?? -1, seq));
        if (seen.size > 4_000) {
            const floor = (maxSeqs.get(sessionId) ?? 0) - 2_000;
            for (const value of seen) if (value < floor) seen.delete(value);
        }
        return true;
    }

    function remember(sessionId, events = []) {
        for (const item of events) accept(sessionId, item?.event?.seq, generation);
    }

    function snapshot() {
        return {
            projectId,
            workspaceId,
            activeSessionId,
            generation,
            knownSessionIds: [...knownSessionIds],
            lastSeqBySession: Object.fromEntries(maxSeqs),
        };
    }

    function clear() {
        reset();
    }

    return {
        reset,
        clear,
        addSession,
        setActive,
        assertProject,
        assertSession,
        accept,
        remember,
        snapshot,
    };
}

function validateId(value, name) {
    if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string`);
}
