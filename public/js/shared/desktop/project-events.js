(function (root) {
    'use strict';

    const listeners = new Set();
    const latestByProject = new Map();
    const seen = new Set();
    let unsubscribeDesktop = null;

    function start() {
        if (unsubscribeDesktop || !root.DesktopApi?.project?.projects?.onChanged) return;
        unsubscribeDesktop = root.DesktopApi.project.projects.onChanged(handle);
    }

    function handle(event) {
        if (!event || event.schemaVersion !== 1 || !event.projectId) return;
        const key = `${event.streamId || 'default'}:${event.projectId}:${event.seq || event.eventId || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (seen.size > 2_000) {
            const first = seen.values().next().value;
            if (first) seen.delete(first);
        }
        latestByProject.set(event.projectId, event);
        for (const listener of listeners) {
            try { listener(event); } catch { /* one view cannot break synchronisation */ }
        }
        root.dispatchEvent(new CustomEvent('cuigengji:project-changed', { detail: event }));
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        start();
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function latest(projectId) {
        return latestByProject.get(String(projectId || '')) || null;
    }

    async function sync(projectId, options = {}) {
        start();
        const changesApi = root.DesktopApi?.project?.projects?.changes;
        if (!changesApi || !projectId) return { streamId: '', resetRequired: false, events: [] };
        const result = await changesApi(projectId, {
            sinceSeq: options.sinceSeq || 0,
            sinceStreamId: options.sinceStreamId,
        });
        for (const event of result?.events || []) handle(event);
        return result;
    }

    function stop() {
        unsubscribeDesktop?.();
        unsubscribeDesktop = null;
        listeners.clear();
    }

    start();
    root.CuigengjiProjectEvents = Object.freeze({ subscribe, latest, sync, stop });
}(window));
