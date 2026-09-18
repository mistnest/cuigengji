# Writing project tools and graph workspace

## Agent manuscript tools

The DSH writing preset now starts `plugins/writing-project-mcp` over stdio. The
MCP process receives only a short-lived bearer capability and calls the
Electron loopback bridge. The bridge invokes the existing chapter domain
service, so CAS checks, backups, summaries, audit actors and
`project.changed` events are shared with the desktop editor.

Tools are intentionally small:

- `manuscript_list` returns the volume/chapter tree without body text.
- `manuscript_get` supports metadata-only reads and bounded `start`/`maxChars`
  windows for long chapters.
- `manuscript_create` creates a chapter or a volume.
- `manuscript_update` requires the current revision and optionally content hash.
- `manuscript_delete` requires `confirmed=true` and the current revision.

No shell, filesystem or direct project JSON access is granted to the Agent.

## Novel graph

`src/backend/domains/knowledge/graph-service.js` is the shared repository
adapter for the existing journaled `GraphStore`. Legacy world books and
character cards are imported lazily as `world_book` and `character_card`
nodes; their complete JSON is kept in node `body`, while the list surface only
returns names and summaries. The graph supports node and edge CAS CRUD.

The renderer exposes a graph tab with search, type filtering, lazy body
loading, node editing/deletion and relationship creation/deletion. Graph
mutations publish the same project event stream. The graph MCP callback uses
the DSH capability bridge so Agent edits refresh the renderer without granting
the MCP process access to project files.

The JSON world-book and character-card files remain a compatibility import/
export surface. Desktop saves synchronize their corresponding graph node.
