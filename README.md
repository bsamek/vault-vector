# Vault Vector

Semantic search across your Obsidian vault. Two backends:

- **Voyage direct (local)** — default. The plugin calls Voyage AI itself, stores embeddings in a local JSON cache, and ranks by brute-force cosine similarity in-process. Just needs an API key.
- **Atlas auto-embed** — MongoDB Atlas owns the embeddings and runs `$vectorSearch` server-side. Requires a configured Atlas cluster and vector index.

See [`docs/architecture.html`](docs/architecture.html) for a visual walkthrough of both modes.

## Which mode should I use?

| | Voyage direct (local) | Atlas auto-embed |
|---|---|---|
| Where embeddings live | Local JSON file under the plugin folder | Atlas collection |
| Who calls Voyage | The plugin, with your API key | Atlas (under the hood) |
| Network dependency | api.voyageai.com | Atlas cluster |
| Search algorithm | Brute-force cosine in-process | Atlas `$vectorSearch` (ANN) |
| Setup | Voyage API key | Atlas cluster + vector index |
| Good fit | You don't want to host a cluster; vaults up to a few thousand notes | You already run Atlas, or want server-side search |

Both modes coexist behind a settings toggle. You can switch freely.

## Install the plugin

Until this is published to the community plugins gallery, clone and build:

```
git clone <repo-url> vault-vector
cd vault-vector
npm install && npm run build
```

The build produces `main.js` and `manifest.json` under `packages/plugin/`. Those two files are what Obsidian needs. Pick one of the following ways to get them into your vault.

### Option A — symlink (recommended for development)

Edits to the built files in this repo show up in the vault on next reload:

```
mkdir -p "<your vault>/.obsidian/plugins/vault-vector"
ln -sf "$PWD/packages/plugin/main.js" "$PWD/packages/plugin/manifest.json" "<your vault>/.obsidian/plugins/vault-vector/"
```

### Option B — copy (one-off install)

```
mkdir -p "<your vault>/.obsidian/plugins/vault-vector"
cp packages/plugin/main.js packages/plugin/manifest.json "<your vault>/.obsidian/plugins/vault-vector/"
```

After either option: in Obsidian, Settings → Community plugins → Reload, then enable **Vault Vector**. (If community plugins are disabled, turn off Restricted Mode first.)

## Configure

In **Settings → Vault Vector**:

- **Embedding provider** — `Voyage direct (local)` (default) or `Atlas auto-embed`. Only the selected provider's fields are shown.

### Voyage direct (local) — default

- **Voyage API key** — your Voyage AI API key.
- **Voyage model** — default `voyage-4`. Changing this wipes the local cache on next sync.
- **Result limit** — default `10`.

The local cache lives at `<vault>/.obsidian/plugins/vault-vector/embeddings.json`.

### Atlas auto-embed

- **Connection URI** — `mongodb+srv://<user>:<pass>@<cluster>/...`
- **Database** — default `vault-vector`
- **Collection** — default `notes`
- **Index name** — default `vault_vector`
- **Result limit** — default `10`

One-time Atlas setup:

1. Create the database and collection in your cluster.
2. Create a **Vector Search** index on the collection. Name it to match **Index name** in settings (`vault_vector` by default). Paste this JSON into the Atlas index editor:

   ```json
   {
     "fields": [{
       "type": "text",
       "path": "content",
       "model": "voyage-3-large"
     }]
   }
   ```

   To use a different Voyage model, change the `model` value and recreate the index.

### Reranking (optional)

Reranking applies to both modes. When enabled, the plugin over-fetches candidates from the active backend (5× **Result limit**, capped at 50), sends them to Voyage's `/v1/rerank` endpoint, and returns the reordered top results. Most of the gain comes from promoting notes the embedding model ranked 11-50 into the top slots.

- **Enable reranking** — toggle. Default off.
- **Rerank model** — `rerank-2.5-lite` (faster) or `rerank-2.5` (more accurate). Default `rerank-2.5-lite`.
- **Rerank instruction (optional)** — free-form text prepended to the query, e.g. _"Prefer notes that explain why over notes that list how."_

Reranking always calls Voyage, even in Atlas mode. In Atlas mode the **Voyage API key** field appears inside the Reranking section once the toggle is on. Settings shows an inline warning if the toggle is on without a key. If a rerank call fails at search time, the modal falls back to vector-ordered results and shows a Notice.

## Use

- **Vault Vector: Sync** — Embeds and stores every `.md` file in your vault. In Atlas mode, pushes to the collection; in Voyage mode, writes to the local cache. Removes entries for deleted files. Reports counts in a notification.
- **Vault Vector: Search** — Opens a search modal. Type a natural-language query; results are ranked by semantic similarity. Enter opens the selected note.

## Use from AI tools (MCP)

The repo also ships an MCP server (`packages/mcp/`) that exposes the same search to AI tools like Claude Code. It reads the plugin's settings from `<vault>/.obsidian/plugins/vault-vector/data.json` and queries the same `embeddings.json` the plugin maintains, so no duplicate configuration.

Build, then register with Claude Code:

```
npm run build
claude mcp add vault-vector node "$PWD/packages/mcp/dist/bin.js" --vault "<your vault>"
```

The server registers one tool, `search(query, limit?, rerank?)`. It hot-reloads the embeddings file on mtime change, so indexing done by the plugin (auto-sync or manual) shows up in the next MCP call without restarting. While Obsidian isn't running, the index is frozen at its last sync.

Environment overrides: `VOYAGE_API_KEY` overrides the `voyageApiKey` from `data.json`; `VAULT_VECTOR_MODEL` overrides the embedding model.

## Smoke test

Run against the in-house Evergreen documentation (good topical breadth):

1. Clone the Evergreen docs repo and open it as an Obsidian vault.
2. Run **Vault Vector: Sync**. Atlas mode: confirm collection count equals markdown file count. Voyage mode: confirm `embeddings.json` exists with roughly that many entries.
3. Run **Vault Vector: Search** with each query and verify the top results are semantically on-topic, not just keyword matches:
   - "how do I retry a failed task"
   - "configuring task priorities"
   - "patch builds"
4. Pick a result from the modal and verify the correct note opens.
5. Delete two doc files from the vault clone, re-run Sync. Confirm count drops by 2.
6. Add a single huge note (over the model's token limit). Confirm the sync Notice reports it as rejected and that all other notes synced cleanly.
7. (Voyage mode) Change the Voyage model in settings, re-run Sync. Confirm the cache is wiped and rebuilt.
8. (Reranking) Set a Voyage API key, enable **Reranking**, re-run Search on the same queries. Top order should shift compared to step 3. Add a rerank instruction and confirm the order shifts again. Break the API key (append junk) and confirm the Notice "Rerank failed, showing vector results." and that the modal still opens with vector-ordered results.

## Auto-sync

Vault Vector watches the vault for changes and reindexes notes automatically. Edits flush after about 8 seconds of idle. A status bar item shows current state:

- `VV ✓` idle (hover for last sync time)
- `VV •N` N changes queued
- `VV ⟳` syncing now
- `VV !` last sync failed (click to retry)

Click the status bar item to force a sync. Disable auto-sync via Settings if you prefer to run `Vault Vector: Sync` manually.

## Limitations (MVP)

- One embedding per note. Notes over the model's token limit are rejected and skipped.
- Desktop-only (Atlas mode uses the Node `mongodb` driver).
- `.md` files only.
- Secrets (connection URI, Voyage API key) are stored unencrypted in Obsidian's plugin data file.
- Voyage mode uses brute-force cosine similarity; expect it to start feeling slow above ~10K notes.
