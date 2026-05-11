# Vault Vector

Semantic search across your Obsidian vault using MongoDB Atlas Vector Search and automated Voyage embeddings.

## How it works

`Vault Vector: Sync` pushes every Markdown file in your vault to a MongoDB Atlas collection as `{ _id: path, path, content, mtime }`. Atlas auto-generates a Voyage embedding for the `content` field on insert. `Vault Vector: Search` runs `$vectorSearch` with your raw query text; Atlas auto-embeds the query and returns the nearest notes.

The plugin never calls an embedding API directly.

## Prerequisites

- An Atlas cluster you control.
- An Atlas database user with read/write access to the target database.
- Network access from your machine to the cluster (IP allowlist or VPC peering as appropriate).

## Atlas setup (one time)

1. Create a database (default: `vault-vector`) and collection (default: `notes`) in your cluster.
2. Create a **Vector Search** index on the collection. Name it `vault_vector` (or whatever you'll put in plugin settings). Paste this JSON into the Atlas index editor:

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

## Install the plugin

Until this is published to the community plugins gallery:

1. Clone this repo into `<your vault>/.obsidian/plugins/vault-vector`.
2. From inside that directory: `npm install && npm run build`.
3. In Obsidian: Settings → Community plugins → Reload, then enable **Vault Vector**.

## Configure

In **Settings → Vault Vector**:

- **Connection URI** — `mongodb+srv://<user>:<pass>@<cluster>/...`
- **Database** — default `vault-vector`
- **Collection** — default `notes`
- **Index name** — default `vault_vector`
- **Result limit** — default `10`

## Use

- **Vault Vector: Sync** — Pushes every `.md` file in your vault to Atlas and deletes Atlas docs whose files no longer exist. Reports counts in a notification.
- **Vault Vector: Search** — Opens a search modal. Type a natural-language query; results are ranked by semantic similarity. Enter opens the selected note.

## Smoke test

This is the MVP's manual verification, run against the in-house Evergreen documentation (which has good topical breadth):

1. Clone the Evergreen docs repo and open it as an Obsidian vault.
2. Run **Vault Vector: Sync**. Confirm the Atlas collection's document count equals the markdown file count.
3. Run **Vault Vector: Search** with each query and verify the top results are semantically on-topic, not just keyword matches:
   - "how do I retry a failed task"
   - "configuring task priorities"
   - "patch builds"
4. Pick a result from the modal and verify the correct note opens.
5. Delete two doc files from the vault clone, re-run Sync. Confirm Atlas count drops by 2.
6. Add a single huge note (>32K tokens). Confirm the sync Notice reports it as rejected and that all other notes synced cleanly.

## Limitations (MVP)

- Manual sync only — no live updates on file change.
- One embedding per note — notes over the model's token limit are rejected by Atlas and skipped.
- Desktop-only (uses the Node `mongodb` driver).
- `.md` files only.
- Connection URI is stored unencrypted in Obsidian's plugin data file.
