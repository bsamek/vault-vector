# Vault Vector

Semantic search across your Obsidian vault. Two backends:

- **Atlas auto-embed** — MongoDB Atlas owns the embeddings and runs `$vectorSearch` server-side.
- **Voyage direct (local)** — the plugin calls Voyage AI itself, stores embeddings in a local JSON cache, and ranks by brute-force cosine similarity in-process.

See [`docs/architecture.html`](docs/architecture.html) for a visual walkthrough of both modes.

## Which mode should I use?

| | Atlas auto-embed | Voyage direct (local) |
|---|---|---|
| Where embeddings live | Atlas collection | Local JSON file under the plugin folder |
| Who calls Voyage | Atlas (under the hood) | The plugin, with your API key |
| Network dependency | Atlas cluster | api.voyageai.com |
| Search algorithm | Atlas `$vectorSearch` (ANN) | Brute-force cosine in-process |
| Setup | Atlas cluster + vector index | Voyage API key |
| Good fit | You already run Atlas, or want server-side search | You don't want to host a cluster; vaults up to a few thousand notes |

Both modes coexist behind a settings toggle. You can switch freely.

## Install the plugin

Until this is published to the community plugins gallery:

1. Clone this repo into `<your vault>/.obsidian/plugins/vault-vector`.
2. From inside that directory: `npm install && npm run build`.
3. In Obsidian: Settings → Community plugins → Reload, then enable **Vault Vector**.

## Configure

In **Settings → Vault Vector**:

- **Embedding provider** — `Atlas auto-embed` or `Voyage direct (local)`.

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

### Voyage direct (local)

- **Voyage API key** — your Voyage AI API key.
- **Voyage model** — default `voyage-4`. Changing this wipes the local cache on next sync.
- **Result limit** — default `10`.

The local cache lives at `<vault>/.obsidian/plugins/vault-vector/embeddings.json`.

## Use

- **Vault Vector: Sync** — Embeds and stores every `.md` file in your vault. In Atlas mode, pushes to the collection; in Voyage mode, writes to the local cache. Removes entries for deleted files. Reports counts in a notification.
- **Vault Vector: Search** — Opens a search modal. Type a natural-language query; results are ranked by semantic similarity. Enter opens the selected note.

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

## Limitations (MVP)

- Manual sync only, no live updates on file change.
- One embedding per note. Notes over the model's token limit are rejected and skipped.
- Desktop-only (Atlas mode uses the Node `mongodb` driver).
- `.md` files only.
- Secrets (connection URI, Voyage API key) are stored unencrypted in Obsidian's plugin data file.
- Voyage mode uses brute-force cosine similarity; expect it to start feeling slow above ~10K notes.
