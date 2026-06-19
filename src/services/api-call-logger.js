import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from '../config.js';

const LOG_DIR = ['debug', 'api-calls'];
const RECENT_FULL_LIMIT = 5;
const SENSITIVE_HEADER_RE = /^(authorization|x-api-key|api-key|apikey)$/i;
const SENSITIVE_QUERY_RE = /^(key|api_key|apikey|access_token|token)$/i;

export function createApiCallId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
    return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function logApiCall(entry = {}) {
    try {
        const safeEntry = normalizeEntry(entry);
        const dir = getLogDir();
        await fs.mkdir(dir, { recursive: true });
        await fs.appendFile(path.join(dir, `${safeEntry.date}.jsonl`), `${JSON.stringify(safeEntry)}\n`, 'utf8');
        await fs.writeFile(path.join(dir, 'last-api-call.json'), JSON.stringify(safeEntry, null, 2), 'utf8');
        await writeRecentFullApiCalls(dir, safeEntry);
    } catch (err) {
        console.warn('[API Call Logger]', err.message);
    }
}

export async function readLastApiCall() {
    try {
        const file = path.join(getLogDir(), 'last-api-call.json');
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        return null;
    }
}

export async function readRecentApiCalls(limit = 20) {
    try {
        const dir = getLogDir();
        const files = (await fs.readdir(dir))
            .filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
            .sort()
            .reverse();
        const rows = [];
        for (const file of files) {
            const text = await fs.readFile(path.join(dir, file), 'utf8');
            const lines = text.trim().split(/\r?\n/).filter(Boolean).reverse();
            for (const line of lines) {
                try {
                    rows.push(summarizeEntry(JSON.parse(line)));
                } catch {}
                if (rows.length >= limit) return rows;
            }
        }
        return rows;
    } catch {
        return [];
    }
}

export async function readRecentFullApiCalls() {
    try {
        const file = path.join(getLogDir(), 'recent-api-calls.json');
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        return [];
    }
}

export function sanitizeRequestUrl(url) {
    try {
        const parsed = new URL(url);
        for (const key of [...parsed.searchParams.keys()]) {
            if (SENSITIVE_QUERY_RE.test(key)) parsed.searchParams.set(key, redactValue(parsed.searchParams.get(key)));
        }
        return parsed.toString();
    } catch {
        return String(url || '');
    }
}

export function sanitizeHeaders(headers = {}) {
    const normalized = {};
    if (headers instanceof Headers) {
        headers.forEach((value, key) => {
            normalized[key] = SENSITIVE_HEADER_RE.test(key) ? redactValue(value) : value;
        });
        return normalized;
    }
    for (const [key, value] of Object.entries(headers || {})) {
        normalized[key] = SENSITIVE_HEADER_RE.test(key) ? redactValue(value) : value;
    }
    return normalized;
}

export function parseRequestBody(body) {
    if (typeof body !== 'string') return body ?? null;
    try {
        return JSON.parse(body);
    } catch {
        return body;
    }
}

function normalizeEntry(entry = {}) {
    const timestamp = entry.timestamp || new Date().toISOString();
    return {
        id: entry.id || createApiCallId(),
        timestamp,
        date: timestamp.slice(0, 10),
        provider: entry.provider || '',
        model: entry.model || '',
        mode: entry.mode || '',
        stream: Boolean(entry.stream),
        toolChoice: entry.toolChoice ?? null,
        url: sanitizeRequestUrl(entry.url || ''),
        method: entry.method || 'POST',
        request: {
            headers: sanitizeHeaders(entry.request?.headers || {}),
            body: parseRequestBody(entry.request?.body),
        },
        response: {
            ok: entry.response?.ok ?? null,
            status: entry.response?.status ?? null,
            statusText: entry.response?.statusText || '',
            durationMs: entry.response?.durationMs ?? null,
            error: entry.response?.error || '',
        },
    };
}

function summarizeEntry(entry = {}) {
    const body = entry.request?.body || {};
    return {
        id: entry.id,
        timestamp: entry.timestamp,
        provider: entry.provider,
        model: entry.model || body.model || '',
        mode: entry.mode,
        stream: entry.stream,
        toolChoice: entry.toolChoice ?? body.tool_choice ?? null,
        status: entry.response?.status ?? null,
        durationMs: entry.response?.durationMs ?? null,
        messageCount: Array.isArray(body.messages) ? body.messages.length : null,
        toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    };
}

async function writeRecentFullApiCalls(dir, entry) {
    const file = path.join(dir, 'recent-api-calls.json');
    let recent = [];
    try {
        const text = await fs.readFile(file, 'utf8');
        recent = JSON.parse(text);
        if (!Array.isArray(recent)) recent = [];
    } catch {}
    const next = [entry, ...recent.filter(item => item?.id !== entry.id)].slice(0, RECENT_FULL_LIMIT);
    await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
}

function getLogDir() {
    return path.join(getDataRoot(), ...LOG_DIR);
}

function redactValue(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.startsWith('Bearer ')) return 'Bearer ***';
    if (text.length <= 8) return '***';
    return `${text.slice(0, 4)}***${text.slice(-4)}`;
}
