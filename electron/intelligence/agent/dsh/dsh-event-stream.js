export function createDshEventStream({
    WebSocketImpl = globalThis.WebSocket,
    onPayload = () => {},
    onState = () => {},
    reconnectDelays = [100, 300, 1_000, 2_000, 5_000],
}) {
    let socket = null;
    let endpoint = '';
    let generation = 0;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let stopped = true;
    let connectedOnce = false;

    function connect(baseUrl, nextGeneration) {
        closeSocket();
        endpoint = toSocketUrl(baseUrl);
        generation = nextGeneration;
        stopped = false;
        reconnectAttempt = 0;
        connectedOnce = false;
        return openSocket();
    }

    function openSocket() {
        return new Promise((resolve, reject) => {
            if (stopped) {
                reject(new Error('DSH event stream is stopped'));
                return;
            }
            let settled = false;
            const current = new WebSocketImpl(endpoint);
            socket = current;
            current.addEventListener('open', () => {
                if (current !== socket || stopped) return;
                const reconnected = connectedOnce;
                connectedOnce = true;
                reconnectAttempt = 0;
                onState({ state: 'connected', generation, reconnected });
                settled = true;
                resolve();
            }, { once: true });
            current.addEventListener('message', event => {
                if (current !== socket || stopped) return;
                try {
                    if (typeof event.data !== 'string') throw new Error('binary DSH frame rejected');
                    const envelope = JSON.parse(event.data);
                    if (!envelope || typeof envelope.payload !== 'object') {
                        throw new Error('invalid DSH event envelope');
                    }
                    onPayload(envelope.payload, generation);
                } catch {
                    onState({ state: 'invalid-frame', generation });
                }
            });
            current.addEventListener('error', () => {
                if (!settled) {
                    settled = true;
                    reject(new Error('DSH event WebSocket failed'));
                }
            });
            current.addEventListener('close', () => {
                if (current !== socket) return;
                socket = null;
                if (stopped) return;
                onState({ state: 'reconnecting', generation });
                scheduleReconnect();
            }, { once: true });
        });
    }

    function scheduleReconnect() {
        clearTimeout(reconnectTimer);
        const delay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)] ?? 5_000;
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void openSocket().catch(() => {
                if (!stopped && !reconnectTimer) scheduleReconnect();
            });
        }, delay);
    }

    async function stop() {
        stopped = true;
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        const current = socket;
        socket = null;
        if (!current) return;
        if (current.readyState === WebSocketImpl.CONNECTING || current.readyState === WebSocketImpl.OPEN) {
            current.close();
        }
    }

    function status() {
        return {
            connected: Boolean(socket && socket.readyState === WebSocketImpl.OPEN),
            generation,
            reconnecting: Boolean(reconnectTimer),
        };
    }

    function closeSocket() {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        if (socket && (socket.readyState === WebSocketImpl.CONNECTING || socket.readyState === WebSocketImpl.OPEN)) {
            socket.close();
        }
        socket = null;
    }

    return { connect, stop, status };
}

function toSocketUrl(baseUrl) {
    const url = new URL('/api/events.mux', baseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
        throw new Error('DSH event endpoint must be loopback HTTP');
    }
    url.protocol = 'ws:';
    return url.href;
}
