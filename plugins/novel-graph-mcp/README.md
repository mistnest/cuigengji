# novel-graph-mcp

Local stdio MCP server for one or more novel property graphs. It stores world-book and character-card nodes plus typed edges without SQLite or native addons. Multiple Writer sessions (for example, separate runs or workspaces) can share the same store root.

Each novel uses `manifest.json`, `snapshot.json`, an fsynced `journal.jsonl`, and a short-lived directory lock. Commits validate both the graph version and every touched entity version, then apply the whole batch or nothing. Deletes create tombstones so old revision sources remain auditable.

The server exposes five stable MCP tools:

- `search_nodes`: search names and summaries; omits full bodies.
- `get_node`: fetch one node and optionally its complete body.
- `list_edges`: inspect incoming/outgoing typed relationships.
- `get_edge`: fetch one relationship by stable ID, without list-window truncation.
- `commit_changes`: atomically perform `upsert_node`, `delete_node`, `upsert_edge`, and `delete_edge` operations.

Build and test:

```bash
source env.sh
pnpm --dir plugins/novel-graph-mcp install --frozen-lockfile
pnpm --dir plugins/novel-graph-mcp test
```

Run directly:

```bash
WRITING_NOVEL_GRAPH_DB=/absolute/path/to/novel-graphs \
  node plugins/novel-graph-mcp/lib/bin.js
```

stdout is reserved for MCP JSON-RPC. Diagnostics go to stderr.
# Historical revision graphs

`lib/history-branch-bin.js` prepares an unpublished physical graph for a historical
revision. Pass `--source-novel-id`, `--branch-novel-id`, `--run-id`,
`--original-handoffs`, `--graph-root`, `--results-root`, and `--receipt`.
The handoff manifest is `{ "handoffs": [{ "path": "...", "retire": true }] }`,
containing **all** canonical handoffs in scene order. Retire the affected suffix;
new chapter commits then rebuild that suffix in chronological order.

Old pipeline contributions are replayed and compared exactly against live node
and edge contents before retraction. Untouched manual entities are preserved.
Overlapping manual edits, untracked merged content, and orphaned retained edges
cause `unsafe_history_retraction`; the tool never guesses a reverse edit.
Summaries, names and source revisions come from the last retained contribution,
while bodies use the same deduplicating append rule as chapter commits.

Preparation fences the old physical graph against writes and saves its snapshot.
After chapter review/rebuild, use `--action seal --receipt ...`, publish the catalog
atomically, then `--action unseal-published --receipt ... --results-root ...`.
The old graph remains fenced as an immutable edition. Rollback uses
`--action seal-rollback` before the catalog rollback, then `--action unseal-rollback`
afterwards; graph changes made after publication make rollback fail safely.

MCP resolves logical novel IDs through one `graph_novel_id` catalog pointer,
preserving logical IDs in responses. Set `WRITING_PIPELINE_RESULTS_ROOT` explicitly
for nondefault result directories; the default is
`$WRITING_ROOT/evals/results/proxy-pipeline`. Pointers are not recursively followed.
