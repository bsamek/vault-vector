# Vault Vector — MVP Design

**Date:** 2026-05-11
**Tracking:** [SKUNK-449](https://jira.mongodb.org/browse/SKUNK-449)
**Status:** Approved, ready for implementation planning

## Goal

An Obsidian plugin that enables semantic search across a personal Obsidian vault by storing notes in MongoDB Atlas and using Atlas's automated Voyage embeddings + Vector Search. Built during Skunkworks 2026 (May 11-15).

## Non-goals (MVP)

- Incremental sync on file change. MVP supports manual full sync only.
- Chunking long notes. MVP embeds whole notes; oversized notes are truncated.
- Mobile support. Desktop-only (`isDesktopOnly: true`) because the plugin uses the Node `mongodb` driver.
- Indexing attachments, PDFs, images, or canvases. `.md` files only.
- Automatic Atlas Vector Search index creation. User pastes a provided JSON index definition into the Atlas UI once.
- Hardened secret storage. The connection URI lives in plugin settings (Obsidian's normal `data.json`); no extra encryption.

## Architecture

Five TypeScript modules, all bundled with esbuild into a single `main.js`.

| Module | Responsibility |
|---|---|
| `main.ts` | Plugin entry. Registers commands `Vault Vector: Sync` and `Vault Vector: Search`. Registers settings tab. Owns the Atlas client lifecycle (open on first use, close on `onunload`). |
| `settings.ts` | Settings tab UI + persistence via `Plugin.saveData`. Fields: connection URI, database name, collection name, vector index name, Voyage model, result limit. |
| `atlas.ts` | Thin wrapper around `MongoClient`. Lazy-connects on first call, returns the shared collection handle. Closes the client on plugin unload. |
| `sync.ts` | Implements full-rescan sync. Reads vault markdown files, upserts each into Atlas, deletes orphans. Reports progress via Obsidian `Notice`. |
| `search.ts` | `SuggestModal<SearchResult>` subclass. Runs `$vectorSearch` against Atlas with raw query text, renders filename + snippet, opens the selected note on Enter. |

## Connection method

Bundled MongoDB Node driver. Justification:

- Obsidian plugins have full Node.js access in Electron with `isDesktopOnly: true`.
- Prior art exists (`sync-db-os` plugin uses MongoDB/CouchDB drivers directly).
- Atlas Data API was deprecated in 2024, so an HTTPS option doesn't exist as a clean alternative.
- An HTTPS proxy would add a second service to build and host with no benefit for a single-user hackathon plugin.

## Data model

One Atlas document per vault `.md` file. `_id` is the vault-relative path, which is unique and stable enough for MVP (rename = delete + insert).

```json
{
  "_id": "Areas/Work/2026-05-11.md",
  "path": "Areas/Work/2026-05-11.md",
  "content": "<full markdown body, truncated to model's token limit if needed>",
  "mtime": 1715432400000
}
```

The Vector Search index targets `content` with automated embedding. The plugin never sees a vector.

## Atlas vector index

User creates this once in the Atlas UI before first use. The plugin README includes the exact JSON. Default model is `voyage-3-large`.

```json
{
  "fields": [{
    "type": "text",
    "path": "content",
    "model": "voyage-3-large"
  }]
}
```

Index name: `vault_vector` (configurable in settings).

## Commands

### `Vault Vector: Sync`

1. List vault markdown files via `this.app.vault.getMarkdownFiles()`.
2. For each file:
   - Read content with `vault.cachedRead`.
   - Upsert `{_id: path, path, content, mtime}` into the configured collection.
   - If Atlas rejects the upsert (e.g., content exceeds the model's token limit), record the path and continue.
3. Query Atlas for all `_id`s; delete docs whose `_id` is not in the vault file list.
4. Emit a final `Notice` with counts: upserted, deleted, rejected (with rejected paths logged to the dev console).

Atlas auto-embeds `content` on insert/update. The plugin does not call any embedding API directly.

### `Vault Vector: Search`

1. Open a `SuggestModal`. On query input change (debounced ~300ms), run:
   ```js
   [
     {$vectorSearch: {
        index: "<index name from settings>",
        path: "content",
        query: "<user input text>",
        limit: <result limit from settings>,
        numCandidates: <limit * 10>
     }},
     {$project: {path: 1, content: 1, score: {$meta: "vectorSearchScore"}}}
   ]
   ```
2. Render each hit as `<basename>` + first 200 chars of content + score.
3. On selection, call `workspace.openLinkText(path, "", false)`.

Atlas auto-embeds the query text. The plugin does not call any embedding API directly.

## Settings

| Field | Default | Purpose |
|---|---|---|
| Connection URI | (empty) | `mongodb+srv://user:pass@cluster/...` |
| Database name | `vault-vector` | |
| Collection name | `notes` | |
| Index name | `vault_vector` | Must match the Atlas index |
| Result limit | `10` | |

The embedding model is baked into the Atlas index definition, not the plugin. To change models, recreate the index with a different `model` value.

## Error handling

All thrown errors surface as Obsidian `Notice` with a short user message and full detail in the dev console. Specific cases:

- No URI configured -> Notice "Configure Vault Vector connection in Settings."
- Connection failure -> Notice "Atlas connection failed: <message>."
- Index missing or misconfigured -> Notice "Vector search index not found. See README for setup."
- Token-limit truncation -> aggregated end-of-sync Notice listing file paths.

## Testing

Built test-first (red/green/refactor) using Vitest. Three layers:

### Unit tests (pure logic, fast, no network)

- **Sync diff** (`sync.ts`): given a list of vault paths and a list of Atlas `_id`s, produce the set to upsert and the set to delete. Tested with fixed inputs.
- **Snippet rendering** (`search.ts`): given raw note content and a query, produce the 200-char snippet shown in the modal. Tested with edge cases (empty content, content shorter than 200 chars, content with newlines).
- **Settings validation** (`settings.ts`): given user-entered URI strings, classify as valid / missing / malformed.

Mock the Atlas `Collection` boundary via a hand-rolled fake implementing only the methods we use (`bulkWrite`, `find`, `deleteMany`, `aggregate`). Keep the fake small and obvious.

### Integration tests (live Atlas, gated on env)

Run against a real cluster when `VAULT_VECTOR_TEST_URI` is set. CI in the hackathon timeframe is the developer's machine, so these are run manually before each commit but skipped otherwise.

- Sync inserts the expected docs.
- Sync deletes orphans on second run after files are removed.
- `$vectorSearch` returns sensible top-3 results for a known-good query against a known-good seed corpus.
- Oversized document is rejected without aborting the run.

### Manual smoke test (final gate)

Run against the in-house Evergreen documentation as the test vault — better signal than a synthetic test vault, since Evergreen docs cover many distinct topics:

1. Point the plugin at a clone of the Evergreen docs repo as an Obsidian vault.
2. Run Sync. Verify Atlas doc count matches the markdown file count.
3. Run Search with three semantic queries (e.g., "how do I retry a failed task", "configuring task priorities", "patch builds"). Verify the top results are documents that actually cover those topics, not just keyword matches.
4. Open a result from the modal. Verify the correct note opens.
5. Delete two doc files from the vault clone, re-run Sync. Verify Atlas count drops by 2.
6. Add a giant note (>32K tokens). Verify the rejection is reported in the final sync Notice and that the sync run completes successfully for all other notes.

## Build and packaging

- Bootstrapped from [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin).
- esbuild bundles `main.ts` and `mongodb` into a single `main.js`.
- `manifest.json`: `isDesktopOnly: true`, `minAppVersion: 1.5.0`.
- Distribution for Skunkworks: load via Obsidian's "Install plugin from folder" / BRAT, not the community plugins gallery.

## Open questions for v2 (not blocking MVP)

- Incremental sync triggered by `vault.on('modify' | 'create' | 'delete' | 'rename')`.
- Chunking strategy for long notes (by heading? by token window?).
- Surfacing match highlights inside the snippet.
- Storing per-note metadata (tags, frontmatter) and supporting metadata filters in `$vectorSearch`.
