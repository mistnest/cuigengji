import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from '../config.js';

const LOG_DIR = ['debug', 'api-calls'];
const RECENT_FULL_LIMIT = 5;
const MAX_CAPTURE_CHARS = Number(process.env.API_CALL_LOG_MAX_CHARS || 2_000_000);
const SENSITIVE_HEADER_RE = /^(authorization|x-api-key|api-key|apikey)$/i;
const SENSITIVE_QUERY_RE = /^(key|api_key|apikey|access_token|token)$/i;

export function createApiCallId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
    return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function logApiCall(entry = {}) {
    try {
        const safeEntry = normalizeApiCallEntry(entry);
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
        const seen = new Set();
        for (const file of files) {
            const text = await fs.readFile(path.join(dir, file), 'utf8');
            const lines = text.trim().split(/\r?\n/).filter(Boolean).reverse();
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (seen.has(entry.id)) continue;
                    seen.add(entry.id);
                    rows.push(summarizeEntry(entry));
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

export function normalizeApiCallEntry(entry = {}) {
    const timestamp = entry.timestamp || new Date().toISOString();
    const normalized = {
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
            headers: sanitizeHeaders(entry.response?.headers || {}),
            body: normalizeBody(entry.response?.body),
            bodyTruncated: Boolean(entry.response?.bodyTruncated),
            streamEvents: normalizeStreamEvents(entry.response?.streamEvents),
            finalMessage: entry.response?.finalMessage || null,
        },
    };
    normalized.response.readableTranscript = buildReadableTranscript(normalized.response);
    normalized.response.readableText = formatReadableTranscript(normalized.response.readableTranscript);
    return normalized;
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
        hasResponseBody: entry.response?.body !== undefined && entry.response?.body !== null,
        streamEventCount: Array.isArray(entry.response?.streamEvents) ? entry.response.streamEvents.length : 0,
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

function normalizeBody(body) {
    if (body === undefined) return undefined;
    if (typeof body !== 'string') return body ?? null;
    const limited = limitText(body);
    return parseRequestBody(limited.text);
}

function normalizeStreamEvents(events) {
    if (!Array.isArray(events)) return [];
    return events.map(event => {
        if (typeof event === 'string') {
            const limited = limitText(event);
            return { raw: limited.text, truncated: limited.truncated };
        }
        const raw = typeof event?.raw === 'string' ? limitText(event.raw) : null;
        return {
            ...event,
            ...(raw ? { raw: raw.text, truncated: Boolean(event.truncated || raw.truncated) } : {}),
        };
    });
}

function buildReadableTranscript(response = {}) {
    const message = response.finalMessage || extractMessageFromBody(response.body);
    const streamParts = extractPartsFromStreamEvents(response.streamEvents);
    const reasoning = message?.reasoning_content || message?.reasoning || streamParts.reasoning || '';
    const content = message?.content || streamParts.content || '';
    const toolCalls = normalizeToolCalls(message?.tool_calls || streamParts.toolCalls);
    const transcript = [];

    if (reasoning) {
        transcript.push({
            type: 'reasoning',
            label: '思考过程',
            content: reasoning,
            length: reasoning.length,
        });
    }
    if (content) {
        transcript.push({
            type: 'content',
            label: '正文输出',
            content,
            length: content.length,
        });
    }
    for (const toolCall of toolCalls) {
        transcript.push({
            type: 'tool_call',
            label: '工具调用',
            id: toolCall.id || '',
            name: toolCall.function?.name || '',
            arguments: parseMaybeJson(toolCall.function?.arguments || ''),
        });
    }
    if (!transcript.length && response.error) {
        transcript.push({
            type: 'error',
            label: '错误',
            content: response.error,
            length: String(response.error).length,
        });
    }
    return transcript;
}

function formatReadableTranscript(transcript = []) {
    if (!Array.isArray(transcript) || !transcript.length) return '';
    return transcript.map(part => {
        const title = part.name ? `${part.label}: ${part.name}` : part.label;
        if (part.type === 'tool_call') {
            return `## ${title}\n${formatToolArguments(part.arguments)}`;
        }
        return `## ${title}\n${part.content || ''}`;
    }).join('\n\n');
}

function extractMessageFromBody(body) {
    const parsed = typeof body === 'string' ? parseRequestBody(body) : body;
    if (!parsed || typeof parsed !== 'object') return null;
    const message = parsed.choices?.[0]?.message;
    if (message) return message;
    if (Array.isArray(parsed.content)) {
        return {
            role: 'assistant',
            content: parsed.content.map(part => part?.text || '').join(''),
        };
    }
    if (typeof parsed.response === 'string') {
        return { role: 'assistant', content: parsed.response };
    }
    return null;
}

function extractPartsFromStreamEvents(events = []) {
    const toolCallsByIndex = new Map();
    let reasoning = '';
    let content = '';
    if (!Array.isArray(events)) return { reasoning, content, toolCalls: [] };

    for (const event of events) {
        const parsed = event?.parsed || parseMaybeJson(event?.raw);
        if (!parsed || typeof parsed !== 'object') continue;
        const delta = parsed.choices?.[0]?.delta || parsed.delta || {};
        reasoning += delta.reasoning_content || delta.reasoning || delta.thinking || '';
        content += delta.content || delta.text || '';
        if (Array.isArray(delta.tool_calls)) {
            mergeToolCallDeltas(toolCallsByIndex, delta.tool_calls);
        }
        if (parsed.type === 'content_block_delta') {
            reasoning += parsed.delta?.thinking || '';
            content += parsed.delta?.text || '';
        }
    }

    return {
        reasoning,
        content,
        toolCalls: [...toolCallsByIndex.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, call]) => call),
    };
}

function mergeToolCallDeltas(target, deltas = []) {
    for (const delta of deltas) {
        const index = Number(delta.index || 0);
        const current = target.get(index) || {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
        };
        if (delta.id) current.id += delta.id;
        if (delta.type) current.type = delta.type;
        if (delta.function?.name) current.function.name += delta.function.name;
        if (delta.function?.arguments) current.function.arguments += delta.function.arguments;
        target.set(index, current);
    }
}

function normalizeToolCalls(toolCalls = []) {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls.filter(call => call?.function?.name || call?.id);
}

function parseMaybeJson(value) {
    if (typeof value !== 'string') return value ?? null;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function formatToolArguments(args) {
    if (typeof args === 'string') return args;
    return JSON.stringify(args ?? {}, null, 2);
}

function limitText(text = '') {
    const value = String(text || '');
    if (MAX_CAPTURE_CHARS <= 0 || value.length <= MAX_CAPTURE_CHARS) {
        return { text: value, truncated: false };
    }
    return {
        text: value.slice(0, MAX_CAPTURE_CHARS),
        truncated: true,
    };
}
