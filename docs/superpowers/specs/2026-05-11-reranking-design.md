# Reranking Design

## Goal

Add an optional Voyage AI reranking step to Vault Vector search. Applies to both backends (Atlas auto-embed and Voyage direct local). When enabled, the plugin over-fetches candidates from the active backend, sends them to Voyage's `/v1/rerank` endpoint, and returns the reordered top results.

## Motivation

Embedding-based retrieval ranks by vector similarity, which is fast but coarse. Rerankers do joint query-document attention and tend to lift the truly relevant note from the middle of the candidate set into the top results. Most of the gain comes from over-fetching candidates the embedding model ranked 11-50 and giving the reranker a chance to promote them.

## Voyage Reranker API (reference)

- Endpoint: `POST https://api.voyageai.com/v1/rerank`
- Auth: `Authorization: Bearer <apiKey>` (same key as the embeddings endpoint).
- Request body: `{ query: string, documents: string[], model: string, top_k?: number, return_documents?: boolean, truncation?: boolean }`.
- Response: `{ data: [{ index: number, relevance_score: number, document?: string }, ...], total_tokens: number }`.
- Models: `rerank-2.5` (more accurate), `rerank-2.5-lite` (faster, better for interactive search). Both have 32K-token context per doc, max 1000 docs, max 600K total tokens.
- `truncation` defaults to `true` — long notes auto-truncate to fit. We rely on that.
- **Instructions:** No dedicated parameter. Per Voyage's docs, instructions are prepended or appended to the `query` string itself.

## Architecture

Reranking is a search-time post-processing step. Sync is unchanged. The pipeline:

1. Embed the user's query (for Voyage local) or pass it to Atlas (for atlas-auto).
2. Retrieve **5× `resultLimit`, capped at 50** candidates from the active backend, each with its `content`.
3. If `rerankEnabled` and the Voyage API key is set:
   a. Build the effective query: `instruction.trim() ? `${instruction.trim()}\n\n${query}` : query`.
   b. Call `/v1/rerank` with `{query: effectiveQuery, documents: candidates.map(c => c.content), model: rerankModel, top_k: resultLimit}`.
   c. Reorder candidates by returned `index`, set each hit's `score` to `relevance_score`.
4. Return the top `resultLimit` hits to the modal.

## Settings

Three new fields on `VaultVectorSettings`:

```ts
rerankEnabled: boolean;     // default false
rerankModel: string;        // default 'rerank-2.5-lite'
rerankInstruction: string;  // default ''
```

UI additions (new "Reranking" section in `VaultVectorSettingTab`, below the existing provider-specific fields):

- **Enable reranking** — `Setting.addToggle`. Tied to `rerankEnabled`.
- **Rerank model** — `Setting.addDropdown` with options `rerank-2.5-lite` and `rerank-2.5`. Tied to `rerankModel`.
- **Rerank instruction (optional)** — `Setting.addTextArea`. Placeholder: `e.g. Prefer notes that explain why over notes that list how.`
- **Inline warning** — rendered as a `Setting.setDesc` or a small `<div>` below the toggle in red text, only when `rerankEnabled && !voyageApiKey.trim()`: "Reranking requires a Voyage API key (set above)." Hidden otherwise.

The Voyage API key field stays where it is (in the Voyage-direct section) and is shared between embedding and reranking.

## Candidate Sizing

```ts
const RERANK_CANDIDATE_MULTIPLIER = 5;
const RERANK_CANDIDATE_CAP = 50;
function candidateCount(limit: number): number {
  return Math.min(limit * RERANK_CANDIDATE_MULTIPLIER, RERANK_CANDIDATE_CAP);
}
```

When rerank is enabled, `executeSearch` and `executeLocalSearch` use `candidateCount(resultLimit)` for their initial pull; when disabled, they use `resultLimit` directly. Constants live in `src/search.ts`.

## Code Layout

**`src/voyage.ts`** — add a sibling export:

```ts
export interface VoyageReranker {
  rerank(query: string, documents: string[], topK: number): Promise<RerankResult[]>;
}
export interface RerankResult {
  index: number;
  relevanceScore: number;
}
export function createVoyageReranker(opts: { apiKey: string; model: string }): VoyageReranker;
```

POSTs to `https://api.voyageai.com/v1/rerank`. Bearer auth. Body: `{query, documents, model, top_k: topK}`. Throws on non-2xx with `Voyage rerank <status>: <body>`. Maps response `data[].index` and `data[].relevance_score` to `RerankResult[]`. Does **not** know about instructions — that prepending happens in the caller (`applyRerank`).

**`src/search.ts`** — add:

```ts
export interface RerankConfig {
  reranker: VoyageReranker;
  instruction: string;
}
export async function applyRerank(
  hits: SearchHit[],
  query: string,
  cfg: RerankConfig,
): Promise<SearchHit[]>;
```

`applyRerank` builds the effective query (instruction prepended if non-empty after trim), calls `cfg.reranker.rerank(effectiveQuery, hits.map(h => h.content), hits.length)`, then maps each result back to the corresponding hit with `score` set to `relevanceScore`. Preserves the reranker's order.

Modify `executeSearch` and `executeLocalSearch` to accept an optional `rerank?: RerankConfig` parameter:

- Initial retrieval size: `rerank ? candidateCount(limit) : limit`.
- If `rerank`: wrap `applyRerank` in `try/catch`. On error, log to `console.error`, call `new Notice('Rerank failed, showing vector results.')`, return `hits.slice(0, limit)` unmodified. On success, return `reranked.slice(0, limit)`.
- If no `rerank`: behavior unchanged.

The `Notice` import lives at the call site in `main.ts` normally, so to keep `search.ts` testable we'll inject a `notify: (msg: string) => void` callback into the `rerank` config, or — simpler — let `applyRerank` throw and have `main.ts`'s search closure handle the Notice + fallback. **Decision:** `applyRerank` throws on failure; the closure built in `main.ts` does the try/catch + Notice + fallback. Keeps `search.ts` free of Obsidian imports.

**`src/main.ts`** — at search-modal-open time:

1. If `settings.rerankEnabled && !settings.voyageApiKey.trim()`: `new Notice('Reranking is enabled but Voyage API key is missing. Configure it in Settings.')`, abort (don't open the modal).
2. Lazily construct a `VoyageReranker` via `getReranker()` (mirrors `getVoyage()` / `getAtlas()` lazy pattern). Cache as `this.reranker`. Invalidate in `saveSettings()` and `onunload()` alongside the other clients.
3. Build the search closure to over-fetch and call `applyRerank` inside a try/catch. The closure runs once per user query inside the modal.

```ts
const rerankCfg: RerankConfig | undefined = settings.rerankEnabled
  ? { reranker: this.getReranker(), instruction: settings.rerankInstruction }
  : undefined;
const search: SearchFn = async (query) => {
  const hits = await executeSearch(collection, { ..., limit: rerankCfg ? candidateCount(limit) : limit });
  if (!rerankCfg) return hits;
  try {
    const reranked = await applyRerank(hits, query, rerankCfg);
    return reranked.slice(0, limit);
  } catch (err) {
    console.error('Vault Vector rerank failed', err);
    new Notice('Rerank failed, showing vector results.');
    return hits.slice(0, limit);
  }
};
```

The Voyage-local path mirrors this with `executeLocalSearch`.

## Failure Modes

| Scenario | Behavior |
|---|---|
| `rerankEnabled` true, API key missing | Search command aborts with Notice. Modal does not open. |
| Rerank network/HTTP error | Notice "Rerank failed, showing vector results.", `console.error` with detail, modal shows vector-ordered top `limit`. |
| Rerank returns fewer results than requested | Use what's returned; if zero, fall back to vector ordering. |
| User toggles rerank in settings | `saveSettings()` clears `this.reranker` so the next search builds a fresh client. |
| Empty candidate list (no notes match) | Skip rerank entirely; return `[]`. |

## Tests (TDD order)

1. **`tests/voyage.test.ts`** — extend with `createVoyageReranker`:
   - Builds correct request body and headers.
   - Parses `data[].index` and `relevance_score` into `RerankResult[]`.
   - Throws on non-2xx with the documented message format.
2. **`tests/search.test.ts`** — extend:
   - `applyRerank` with empty instruction sends bare query.
   - `applyRerank` with instruction sends prepended `${instruction}\n\n${query}`.
   - `applyRerank` reorders hits by reranker's response.
   - `applyRerank` propagates reranker errors (caller handles fallback).
   - `executeSearch` with `rerank` config requests `candidateCount(limit)` from the collection then trims to `limit`.
   - `executeLocalSearch` with `rerank` config behaves the same.
   - `candidateCount` math: `(1, 5, 10, 11, 20, 100)` → `(5, 25, 50, 50, 50, 50)`.
3. **`tests/settings.test.ts`** — defaults: `rerankEnabled === false`, `rerankModel === 'rerank-2.5-lite'`, `rerankInstruction === ''`.

`main.ts` integration (closure + Notice + lazy reranker) is verified by manual smoke, not unit tests.

## Manual Smoke

1. `npm run build`, reload Obsidian.
2. With **Atlas auto-embed** mode and rerank **off**: run a known query, note the result order.
3. Enable rerank without an API key. Confirm: settings shows inline red warning, running the Search command shows the missing-key Notice and does not open the modal.
4. Paste a Voyage API key, enable rerank with `rerank-2.5-lite`. Run the same query. Top result order should change (rerank effect visible on the Evergreen smoke queries from the README).
5. Add a rerank instruction like "Prefer how-to instructions over conceptual overviews." Re-run. Order should shift.
6. Switch to **Voyage direct (local)** mode. Re-run with rerank on. Confirm same behavior.
7. Break the API key (append junk). Confirm: Notice "Rerank failed, showing vector results.", modal still opens with vector-ordered results, console has the error.
8. Turn rerank off. Confirm behavior reverts to pre-rerank.

## Out of Scope

- Batching documents past 1000 (cap of 50 is far below the limit).
- Caching reranker results across queries (each query rebuilds context).
- Per-search instruction override (settings instruction only; revisit if users want).
- A separate rerank-time API key (we reuse the embeddings Voyage key).
- Showing both vector and rerank scores in the modal (we replace `score` with `relevance_score`).
