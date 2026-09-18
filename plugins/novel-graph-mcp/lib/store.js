/** Crash-recoverable, process-shared property graph backed by snapshots and a journal. */
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, rm, stat, truncate, writeFile, } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NOVEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NODE_KINDS = new Set(['world_book', 'world_entry', 'character_card']);
export class GraphStoreError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'GraphStoreError';
        this.code = code;
        this.details = details;
    }
}
function assertInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new GraphStoreError('invalid_input', `${label} must be a non-negative safe integer`);
    }
}
function assertId(value, label) {
    if (!ID_PATTERN.test(value)) {
        throw new GraphStoreError('invalid_input', `${label} contains unsupported characters`);
    }
}
function assertText(value, label, maximum) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
        throw new GraphStoreError('invalid_input', `${label} must contain 1-${maximum} characters`);
    }
}
function validateNodeInput(node) {
    assertId(node.id, 'node.id');
    if (!NODE_KINDS.has(node.kind))
        throw new GraphStoreError('invalid_input', 'node.kind is unsupported');
    assertText(node.name, 'node.name', 160);
    assertText(node.summary, 'node.summary', 2_000);
    assertText(node.body, 'node.body', 2_000_000);
    if (!REVISION_PATTERN.test(node.sourceRevisionId)) {
        throw new GraphStoreError('invalid_input', 'node.sourceRevisionId is invalid');
    }
}
function validateEdgeInput(edge) {
    for (const [label, value] of [
        ['edge.id', edge.id],
        ['edge.type', edge.type],
        ['edge.fromNodeId', edge.fromNodeId],
        ['edge.toNodeId', edge.toNodeId],
    ])
        assertId(value, label);
    assertText(edge.summary, 'edge.summary', 2_000);
    assertText(edge.body, 'edge.body', 50_000);
    if (!REVISION_PATTERN.test(edge.sourceRevisionId)) {
        throw new GraphStoreError('invalid_input', 'edge.sourceRevisionId is invalid');
    }
}
function cloneNode(node) {
    return { ...node };
}
function cloneEdge(edge) {
    return { ...edge };
}
function versionConflict(entity, id, expected, actual) {
    throw new GraphStoreError('version_conflict', `${entity} version conflict: ${id}`, {
        entity,
        id,
        expectedVersion: expected,
        currentVersion: actual,
    });
}
async function exists(path) {
    try {
        await access(path, constants.F_OK);
        return true;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    }
}
async function atomicJson(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx');
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await rename(temporary, path);
}
export class GraphStore {
    root;
    snapshotInterval;
    lockTimeoutMs;
    staleLockMs;
    constructor(root, options = {}) {
        if (!root.trim())
            throw new GraphStoreError('invalid_config', 'graph store root is required');
        this.root = resolve(root);
        this.snapshotInterval = options.snapshotInterval ?? 100;
        this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
        this.staleLockMs = options.staleLockMs ?? 30_000;
        if (!Number.isSafeInteger(this.snapshotInterval) || this.snapshotInterval < 1) {
            throw new GraphStoreError('invalid_config', 'snapshotInterval must be positive');
        }
    }
    paths(novelId) {
        if (!NOVEL_ID_PATTERN.test(novelId)) {
            throw new GraphStoreError('invalid_input', 'novelId contains unsupported characters');
        }
        const root = join(this.root, novelId);
        return {
            root,
            manifest: join(root, 'manifest.json'),
            snapshot: join(root, 'snapshot.json'),
            journal: join(root, 'journal.jsonl'),
            lock: join(root, 'write.lock'),
            lockOwner: join(root, 'write.lock', 'owner.json'),
        };
    }
    async readJson(path) {
        try {
            return JSON.parse(await readFile(path, 'utf8'));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                throw error;
            throw new GraphStoreError('corrupt_store', `invalid JSON: ${path}`, { cause: String(error) });
        }
    }
    async load(novelId) {
        const paths = this.paths(novelId);
        const nodes = new Map();
        const edges = new Map();
        let requests = Object.create(null);
        let graphVersion = 0;
        if (await exists(paths.snapshot)) {
            const snapshot = await this.readJson(paths.snapshot);
            if (snapshot.schemaVersion !== 1 || snapshot.novelId !== novelId) {
                throw new GraphStoreError('corrupt_store', 'snapshot header is invalid');
            }
            graphVersion = snapshot.graphVersion;
            requests = Object.assign(Object.create(null), snapshot.requests ?? {});
            for (const node of snapshot.nodes)
                nodes.set(node.id, node);
            for (const edge of snapshot.edges)
                edges.set(edge.id, edge);
        }
        if (await exists(paths.journal)) {
            const journal = await readFile(paths.journal, 'utf8');
            const complete = journal.endsWith('\n') ? journal : journal.slice(0, journal.lastIndexOf('\n') + 1);
            for (const [index, line] of complete.split('\n').entries()) {
                if (!line)
                    continue;
                let transaction;
                try {
                    transaction = JSON.parse(line);
                }
                catch (error) {
                    throw new GraphStoreError('corrupt_store', `journal line ${index + 1} is invalid`, {
                        cause: String(error),
                    });
                }
                if (transaction.schemaVersion !== 1) {
                    throw new GraphStoreError('corrupt_store', `journal line ${index + 1} has an invalid schema`);
                }
                if (transaction.graphVersion <= graphVersion)
                    continue;
                if (transaction.baseGraphVersion !== graphVersion || transaction.graphVersion !== graphVersion + 1) {
                    throw new GraphStoreError('corrupt_store', `journal line ${index + 1} breaks graph version order`);
                }
                for (const node of transaction.nodes)
                    nodes.set(node.id, node);
                for (const edge of transaction.edges)
                    edges.set(edge.id, edge);
                if (transaction.request)
                    requests[transaction.request.id] = { hash: transaction.request.hash, result: transaction.request.result };
                graphVersion = transaction.graphVersion;
            }
        }
        if (await exists(paths.manifest)) {
            const manifest = await this.readJson(paths.manifest);
            if (manifest.schemaVersion !== 1 || manifest.novelId !== novelId || manifest.graphVersion > graphVersion) {
                throw new GraphStoreError('corrupt_store', 'manifest is ahead of recoverable graph data');
            }
        }
        return { graphVersion, nodes, edges, requests };
    }
    async clearStaleLock(lock, ownerPath) {
        let age;
        try {
            age = Date.now() - (await stat(lock)).mtimeMs;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return true;
            throw error;
        }
        let ownerPid;
        try {
            ownerPid = (await this.readJson(ownerPath)).pid;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        let alive = false;
        if (ownerPid !== undefined) {
            try {
                process.kill(ownerPid, 0);
                alive = true;
            }
            catch (error) {
                alive = error.code !== 'ESRCH';
            }
        }
        if (age <= this.staleLockMs || alive)
            return false;
        await rm(lock, { recursive: true, force: true });
        return true;
    }
    async withWriteLock(novelId, operation) {
        const paths = this.paths(novelId);
        await mkdir(paths.root, { recursive: true });
        const deadline = Date.now() + this.lockTimeoutMs;
        for (;;) {
            try {
                await mkdir(paths.lock);
                await writeFile(paths.lockOwner, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
                break;
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
                await this.clearStaleLock(paths.lock, paths.lockOwner);
                if (Date.now() >= deadline)
                    throw new GraphStoreError('lock_timeout', `timed out locking novel: ${novelId}`);
                await delay(15);
            }
        }
        try {
            return await operation();
        }
        finally {
            await rm(paths.lock, { recursive: true, force: true });
        }
    }
    /** Revision control uses the same process-shared lock as ordinary commits. */
    async revisionLock(novelId, operation) {
        return this.withWriteLock(novelId, operation);
    }
    async exportSnapshot(novelId) {
        const graph = await this.load(novelId);
        return { schemaVersion: 1, novelId, graphVersion: graph.graphVersion,
            nodes: [...graph.nodes.values()], edges: [...graph.edges.values()] };
    }
    async installRevisionSnapshot(snapshot) {
        const paths = this.paths(snapshot.novelId);
        if (await exists(paths.snapshot) || await exists(paths.journal)) {
            throw new GraphStoreError('revision_conflict', 'revision branch graph already exists');
        }
        await atomicJson(paths.snapshot, snapshot);
    }
    async searchNodes(novelId, query, kinds = [], limit = 20) {
        if (typeof query !== 'string' || query.length > 500) {
            throw new GraphStoreError('invalid_input', 'query must contain at most 500 characters');
        }
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            throw new GraphStoreError('invalid_input', 'limit must be between 1 and 100');
        }
        if (kinds.some(kind => !NODE_KINDS.has(kind))) {
            throw new GraphStoreError('invalid_input', 'kinds contains an unsupported node kind');
        }
        const graph = await this.load(novelId);
        const needle = query.normalize('NFKC').toLocaleLowerCase();
        const allowed = new Set(kinds);
        const ranked = [...graph.nodes.values()]
            .filter(node => !node.deleted && (allowed.size === 0 || allowed.has(node.kind)))
            .map(node => {
            const name = node.name.normalize('NFKC').toLocaleLowerCase();
            const summary = node.summary.normalize('NFKC').toLocaleLowerCase();
            const score = needle.length === 0 ? 1 : name === needle ? 100 : name.includes(needle) ? 70 : summary.includes(needle) ? 40 : 0;
            return { node, score };
        })
            .filter(item => item.score > 0)
            .sort((left, right) => right.score - left.score || (left.node.id < right.node.id ? -1 : 1))
            .slice(0, limit)
            .map(({ node }) => {
            const { body: _body, ...withoutBody } = node;
            return withoutBody;
        });
        return { novelId, graphVersion: graph.graphVersion, nodes: ranked };
    }
    async getNode(novelId, nodeId, includeBody = true) {
        assertId(nodeId, 'nodeId');
        const graph = await this.load(novelId);
        const node = graph.nodes.get(nodeId);
        if (node === undefined || node.deleted) {
            throw new GraphStoreError('not_found', `node not found: ${nodeId}`, { nodeId, graphVersion: graph.graphVersion });
        }
        if (includeBody)
            return { novelId, graphVersion: graph.graphVersion, node };
        const { body: _body, ...withoutBody } = node;
        return { novelId, graphVersion: graph.graphVersion, node: withoutBody };
    }
    async getEdge(novelId, edgeId) {
        assertId(edgeId, 'edgeId');
        const graph = await this.load(novelId);
        const edge = graph.edges.get(edgeId);
        if (edge === undefined || edge.deleted) {
            throw new GraphStoreError('not_found', `edge not found: ${edgeId}`, { edgeId, graphVersion: graph.graphVersion });
        }
        return { novelId, graphVersion: graph.graphVersion, edge };
    }
    async listEdges(novelId, nodeId, direction = 'both', types = [], limit = 50) {
        assertId(nodeId, 'nodeId');
        if (!['in', 'out', 'both'].includes(direction))
            throw new GraphStoreError('invalid_input', 'direction is unsupported');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
            throw new GraphStoreError('invalid_input', 'limit must be between 1 and 200');
        }
        for (const type of types)
            assertId(type, 'types[]');
        const graph = await this.load(novelId);
        const node = graph.nodes.get(nodeId);
        if (node === undefined || node.deleted) {
            throw new GraphStoreError('not_found', `node not found: ${nodeId}`, { nodeId, graphVersion: graph.graphVersion });
        }
        const typeSet = new Set(types);
        const edges = [...graph.edges.values()]
            .filter(edge => {
            if (edge.deleted || (typeSet.size > 0 && !typeSet.has(edge.type)))
                return false;
            return direction === 'in'
                ? edge.toNodeId === nodeId
                : direction === 'out'
                    ? edge.fromNodeId === nodeId
                    : edge.fromNodeId === nodeId || edge.toNodeId === nodeId;
        })
            .sort((left, right) => (left.id < right.id ? -1 : 1))
            .slice(0, limit);
        return { novelId, graphVersion: graph.graphVersion, edges };
    }
    async commit(request) {
        if (request.requestId !== undefined)
            assertId(request.requestId, 'requestId');
        const requestHash = createHash('sha256').update(JSON.stringify([request.expectedGraphVersion, request.operations])).digest('hex');
        assertInteger(request.expectedGraphVersion, 'expectedGraphVersion');
        if (!Array.isArray(request.operations) || request.operations.length < 1 || request.operations.length > 100) {
            throw new GraphStoreError('invalid_input', 'operations must contain 1-100 changes');
        }
        return this.withWriteLock(request.novelId, async () => {
            if (await exists(join(this.paths(request.novelId).root, 'history-fence.json'))) {
                throw new GraphStoreError('history_revision_active', 'graph writes are fenced by a historical revision');
            }
            const graph = await this.load(request.novelId);
            const previous = request.requestId === undefined || !Object.hasOwn(graph.requests, request.requestId) ? undefined : graph.requests[request.requestId];
            if (previous !== undefined) {
                if (previous.hash !== requestHash)
                    throw new GraphStoreError('invalid_input', 'requestId was reused with different changes');
                return previous.result;
            }
            if (request.expectedGraphVersion !== graph.graphVersion) {
                throw new GraphStoreError('version_conflict', 'graph version conflict', {
                    expectedGraphVersion: request.expectedGraphVersion,
                    currentGraphVersion: graph.graphVersion,
                });
            }
            const nodes = new Map([...graph.nodes].map(([id, node]) => [id, cloneNode(node)]));
            const edges = new Map([...graph.edges].map(([id, edge]) => [id, cloneEdge(edge)]));
            const changedNodes = new Map();
            const changedEdges = new Map();
            const applied = [];
            const now = new Date().toISOString();
            for (const operation of request.operations) {
                assertInteger(operation.expectedVersion, 'operation.expectedVersion');
                if (operation.op === 'upsert_node') {
                    validateNodeInput(operation.node);
                    const existing = nodes.get(operation.node.id);
                    const currentVersion = existing?.version ?? null;
                    if ((existing === undefined && operation.expectedVersion !== 0) || (existing !== undefined && operation.expectedVersion !== existing.version)) {
                        versionConflict('node', operation.node.id, operation.expectedVersion, currentVersion);
                    }
                    const node = {
                        ...operation.node,
                        version: (existing?.version ?? 0) + 1,
                        createdAt: existing?.createdAt ?? now,
                        updatedAt: now,
                        deleted: false,
                    };
                    nodes.set(node.id, node);
                    changedNodes.set(node.id, node);
                    applied.push({ op: operation.op, id: node.id, version: node.version, deleted: false });
                }
                else if (operation.op === 'delete_node') {
                    assertId(operation.nodeId, 'operation.nodeId');
                    const existing = nodes.get(operation.nodeId);
                    if (existing === undefined || operation.expectedVersion !== existing.version) {
                        versionConflict('node', operation.nodeId, operation.expectedVersion, existing?.version ?? null);
                    }
                    const node = { ...existing, version: existing.version + 1, updatedAt: now, deleted: true, deletedAt: now };
                    nodes.set(node.id, node);
                    changedNodes.set(node.id, node);
                    applied.push({ op: operation.op, id: node.id, version: node.version, deleted: true });
                }
                else if (operation.op === 'upsert_edge') {
                    validateEdgeInput(operation.edge);
                    const existing = edges.get(operation.edge.id);
                    const currentVersion = existing?.version ?? null;
                    if ((existing === undefined && operation.expectedVersion !== 0) || (existing !== undefined && operation.expectedVersion !== existing.version)) {
                        versionConflict('edge', operation.edge.id, operation.expectedVersion, currentVersion);
                    }
                    const edge = {
                        ...operation.edge,
                        version: (existing?.version ?? 0) + 1,
                        createdAt: existing?.createdAt ?? now,
                        updatedAt: now,
                        deleted: false,
                    };
                    edges.set(edge.id, edge);
                    changedEdges.set(edge.id, edge);
                    applied.push({ op: operation.op, id: edge.id, version: edge.version, deleted: false });
                }
                else if (operation.op === 'delete_edge') {
                    assertId(operation.edgeId, 'operation.edgeId');
                    const existing = edges.get(operation.edgeId);
                    if (existing === undefined || operation.expectedVersion !== existing.version) {
                        versionConflict('edge', operation.edgeId, operation.expectedVersion, existing?.version ?? null);
                    }
                    const edge = { ...existing, version: existing.version + 1, updatedAt: now, deleted: true, deletedAt: now };
                    edges.set(edge.id, edge);
                    changedEdges.set(edge.id, edge);
                    applied.push({ op: operation.op, id: edge.id, version: edge.version, deleted: true });
                }
                else {
                    const unsupported = operation;
                    throw new GraphStoreError('invalid_input', `unsupported operation: ${String(unsupported)}`);
                }
            }
            for (const edge of edges.values()) {
                if (edge.deleted)
                    continue;
                const from = nodes.get(edge.fromNodeId);
                const to = nodes.get(edge.toNodeId);
                if (from === undefined || from.deleted || to === undefined || to.deleted) {
                    throw new GraphStoreError('referential_conflict', `active edge references a missing node: ${edge.id}`, {
                        edgeId: edge.id,
                        fromNodeId: edge.fromNodeId,
                        toNodeId: edge.toNodeId,
                    });
                }
            }
            const transaction = {
                schemaVersion: 1,
                transactionId: randomUUID(),
                baseGraphVersion: graph.graphVersion,
                graphVersion: graph.graphVersion + 1,
                committedAt: now,
                nodes: [...changedNodes.values()],
                edges: [...changedEdges.values()],
            };
            const paths = this.paths(request.novelId);
            if (request.requestId !== undefined) {
                const result = { novelId: request.novelId, graphVersion: transaction.graphVersion, transactionId: transaction.transactionId, applied };
                transaction.request = { id: request.requestId, hash: requestHash, result };
                graph.requests[request.requestId] = { hash: requestHash, result };
            }
            if (await exists(paths.journal)) {
                const journalText = await readFile(paths.journal, 'utf8');
                if (!journalText.endsWith('\n')) {
                    const lastComplete = journalText.lastIndexOf('\n') + 1;
                    await truncate(paths.journal, Buffer.byteLength(journalText.slice(0, lastComplete), 'utf8'));
                }
            }
            const journal = await open(paths.journal, 'a');
            try {
                await journal.writeFile(`${JSON.stringify(transaction)}\n`, 'utf8');
                await journal.sync();
            }
            finally {
                await journal.close();
            }
            let snapshotGraphVersion = 0;
            if (await exists(paths.manifest)) {
                snapshotGraphVersion = (await this.readJson(paths.manifest)).snapshotGraphVersion;
            }
            if (transaction.graphVersion % this.snapshotInterval === 0) {
                const snapshot = {
                    requests: graph.requests,
                    schemaVersion: 1,
                    novelId: request.novelId,
                    graphVersion: transaction.graphVersion,
                    nodes: [...nodes.values()],
                    edges: [...edges.values()],
                };
                await atomicJson(paths.snapshot, snapshot);
                snapshotGraphVersion = transaction.graphVersion;
            }
            const manifest = {
                schemaVersion: 1,
                novelId: request.novelId,
                graphVersion: transaction.graphVersion,
                snapshotGraphVersion,
            };
            await atomicJson(paths.manifest, manifest);
            return {
                novelId: request.novelId,
                graphVersion: transaction.graphVersion,
                transactionId: transaction.transactionId,
                applied,
            };
        });
    }
}
//# sourceMappingURL=store.js.map