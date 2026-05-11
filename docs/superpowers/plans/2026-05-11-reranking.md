# Reranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Voyage AI reranking step that reorders search results from either backend (Atlas auto-embed or Voyage direct local).

**Architecture:** Reranking is a search-time post-process. The search call over-fetches `min(5 × resultLimit, 50)` candidates from the active backend, sends `(query, [content...])` to Voyage `/v1/rerank`, reorders by relevance score, and returns top `resultLimit`. Failure falls back silently to vector ordering with a Notice.

**Tech Stack:** TypeScript, Vitest, Obsidian plugin API, Voyage AI REST API.

**Reference spec:** `docs/superpowers/specs/2026-05-11-reranking-design.md`

---

## File Structure

**Modify:**
- `src/settings.ts` — add `rerankEnabled`, `rerankModel`, `rerankInstruction` to interface + defaults; add Reranking UI section.
- `src/voyage.ts` — add `VoyageReranker` interface, `RerankResult` type, `createVoyageReranker` factory.
- `src/search.ts` — add `content` to `SearchHit`; add `candidateCount`, `RerankConfig`, `applyRerank`; extend `executeSearch`/`executeLocalSearch` to accept optional rerank config.
- `src/local-search.ts` — include `content` in returned hits.
- `src/main.ts` — lazy reranker construction, search-time key validation, search closure with try/catch fallback.

**Test files modified:**
- `tests/settings.test.ts` — new defaults.
- `tests/voyage.test.ts` — reranker tests.
- `tests/search.test.ts` — `content` on hits, `candidateCount`, `applyRerank`, over-fetch behavior.
- `tests/local-search.test.ts` — `content` on hits.

---

## Task 1: Settings schema and defaults

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/settings.test.ts` inside the `DEFAULT_SETTINGS` describe block:

```typescript
  it('defaults reranking off, with rerank-2.5-lite and empty instruction', () => {
    expect(DEFAULT_SETTINGS.rerankEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.rerankModel).toBe('rerank-2.5-lite');
    expect(DEFAULT_SETTINGS.rerankInstruction).toBe('');
  });
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL on `rerankEnabled is undefined` (or similar) for the new test.

- [ ] **Step 3: Add fields to interface and defaults**

In `src/settings.ts`, extend `VaultVectorSettings`:

```typescript
export interface VaultVectorSettings {
  uri: string;
  database: string;
  collection: string;
  indexName: string;
  resultLimit: number;
  embeddingProvider: EmbeddingProvider;
  voyageApiKey: string;
  voyageModel: string;
  rerankEnabled: boolean;
  rerankModel: string;
  rerankInstruction: string;
}
```

And extend `DEFAULT_SETTINGS`:

```typescript
export const DEFAULT_SETTINGS: VaultVectorSettings = {
  uri: '',
  database: 'vault-vector',
  collection: 'notes',
  indexName: 'vault_vector',
  resultLimit: 10,
  embeddingProvider: 'atlas-auto',
  voyageApiKey: '',
  voyageModel: 'voyage-4',
  rerankEnabled: false,
  rerankModel: 'rerank-2.5-lite',
  rerankInstruction: '',
};
```

- [ ] **Step 4: Run tests, confirm green**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "Add rerank settings fields and defaults"
```

---

## Task 2: Voyage reranker client

**Files:**
- Modify: `src/voyage.ts`
- Test: `tests/voyage.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/voyage.test.ts`:

```typescript
import { createVoyageReranker } from '../src/voyage';

describe('createVoyageReranker', () => {
  it('sends a POST to /v1/rerank with the correct shape', async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({
        data: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.3 },
        ],
        total_tokens: 42,
      })
    );

    const reranker = createVoyageReranker({ apiKey: 'k', model: 'rerank-2.5-lite' });
    const out = await reranker.rerank('query text', ['doc a', 'doc b'], 2);

    expect(out).toEqual([
      { index: 1, relevanceScore: 0.9 },
      { index: 0, relevanceScore: 0.3 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.voyageai.com/v1/rerank');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer k');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      query: 'query text',
      documents: ['doc a', 'doc b'],
      model: 'rerank-2.5-lite',
      top_k: 2,
    });
  });

  it('throws on non-2xx with status and body', async () => {
    mockFetch(() => new Response('rerank limit', { status: 429 }));
    const reranker = createVoyageReranker({ apiKey: 'k', model: 'rerank-2.5-lite' });
    await expect(reranker.rerank('q', ['d'], 1)).rejects.toThrow(/429/);
    await expect(reranker.rerank('q', ['d'], 1)).rejects.toThrow(/rerank limit/);
  });

  it('returns [] for empty documents without calling fetch', async () => {
    const { fn } = mockFetch(() => jsonResponse({ data: [], total_tokens: 0 }));
    const reranker = createVoyageReranker({ apiKey: 'k', model: 'rerank-2.5-lite' });
    const out = await reranker.rerank('q', [], 5);
    expect(out).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npx vitest run tests/voyage.test.ts`
Expected: FAIL — `createVoyageReranker` is not exported.

- [ ] **Step 3: Implement the reranker**

Append to `src/voyage.ts`:

```typescript
export interface RerankResult {
  index: number;
  relevanceScore: number;
}

export interface VoyageReranker {
  rerank(query: string, documents: string[], topK: number): Promise<RerankResult[]>;
}

interface VoyageRerankResponse {
  data: Array<{ index: number; relevance_score: number }>;
}

const RERANK_ENDPOINT = 'https://api.voyageai.com/v1/rerank';

export function createVoyageReranker(opts: {
  apiKey: string;
  model: string;
}): VoyageReranker {
  return {
    async rerank(query, documents, topK) {
      if (documents.length === 0) return [];
      const res = await fetch(RERANK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          documents,
          model: opts.model,
          top_k: topK,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Voyage rerank ${res.status}: ${body}`);
      }
      const json = (await res.json()) as VoyageRerankResponse;
      return json.data.map(d => ({
        index: d.index,
        relevanceScore: d.relevance_score,
      }));
    },
  };
}
```

- [ ] **Step 4: Run tests, confirm green**

Run: `npx vitest run tests/voyage.test.ts`
Expected: PASS for all reranker tests, no regressions in `createVoyageClient`.

- [ ] **Step 5: Commit**

```bash
git add src/voyage.ts tests/voyage.test.ts
git commit -m "Add Voyage reranker client"
```

---

## Task 3: Expose `content` on `SearchHit`

This is a prep step. The reranker needs full content for each candidate; the modal already ignores it. We pass `content` through the `SearchHit` so downstream rerank logic doesn't need a second data structure.

**Files:**
- Modify: `src/search.ts` (`SearchHit` type, `executeSearch` mapping)
- Modify: `src/local-search.ts`
- Test: `tests/search.test.ts`, `tests/local-search.test.ts`

- [ ] **Step 1: Update search tests to expect `content`**

In `tests/search.test.ts`, replace the existing `'maps Atlas docs to search hits with rendered snippets'` test body's `expect(hits).toEqual(...)` with:

```typescript
    expect(hits).toEqual([
      { path: 'a.md', snippet: 'line one line two', content: 'line one\n\nline two', score: 0.93 },
      { path: 'b.md', snippet: 'b content', content: 'b content', score: 0.81 },
    ]);
```

- [ ] **Step 2: Update local-search tests to expect `content`**

Open `tests/local-search.test.ts` and find any test that asserts the exact hit shape via `toEqual` — update those expectations to include `content`. (At minimum: any test that uses `toEqual` on a hit must now expect `content`. Tests that only assert ordering via `toBe('path.md')` are unaffected.)

- [ ] **Step 3: Run tests, confirm failure**

Run: `npx vitest run tests/search.test.ts tests/local-search.test.ts`
Expected: FAIL — actual hits missing `content`.

- [ ] **Step 4: Add `content` to `SearchHit`**

In `src/search.ts`, change the type:

```typescript
export type SearchHit = {
  path: string;
  snippet: string;
  content: string;
  score: number;
};
```

In `executeSearch`, change the mapping:

```typescript
  return docs.map(d => ({
    path: String(d.path),
    snippet: renderSnippet(String(d.content)),
    content: String(d.content),
    score: typeof d.score === 'number' ? d.score : 0,
  }));
```

In `src/local-search.ts`, update the final map:

```typescript
  return scored.slice(0, limit).map(s => ({
    path: s.path,
    snippet: renderSnippet(s.content),
    content: s.content,
    score: s.score,
  }));
```

- [ ] **Step 5: Run tests, confirm green**

Run: `npx vitest run`
Expected: PASS across all suites.

- [ ] **Step 6: Commit**

```bash
git add src/search.ts src/local-search.ts tests/search.test.ts tests/local-search.test.ts
git commit -m "Expose content field on SearchHit for downstream rerank"
```

---

## Task 4: `candidateCount` helper

**Files:**
- Modify: `src/search.ts`
- Test: `tests/search.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/search.test.ts`:

```typescript
import { candidateCount } from '../src/search';

describe('candidateCount', () => {
  it('multiplies limit by 5 and caps at 50', () => {
    expect(candidateCount(1)).toBe(5);
    expect(candidateCount(5)).toBe(25);
    expect(candidateCount(10)).toBe(50);
    expect(candidateCount(11)).toBe(50);
    expect(candidateCount(100)).toBe(50);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npx vitest run tests/search.test.ts`
Expected: FAIL — `candidateCount` not exported.

- [ ] **Step 3: Implement**

Add to top of `src/search.ts` (after imports):

```typescript
export const RERANK_CANDIDATE_MULTIPLIER = 5;
export const RERANK_CANDIDATE_CAP = 50;

export function candidateCount(limit: number): number {
  return Math.min(limit * RERANK_CANDIDATE_MULTIPLIER, RERANK_CANDIDATE_CAP);
}
```

- [ ] **Step 4: Run test, confirm green**

Run: `npx vitest run tests/search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/search.ts tests/search.test.ts
git commit -m "Add candidateCount helper for rerank over-fetching"
```

---

## Task 5: `applyRerank` helper

**Files:**
- Modify: `src/search.ts`
- Test: `tests/search.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/search.test.ts`:

```typescript
import { applyRerank, type RerankConfig } from '../src/search';
import type { VoyageReranker } from '../src/voyage';

function fakeReranker(reorder: (docs: string[]) => Array<{ index: number; relevanceScore: number }>): VoyageReranker {
  return {
    async rerank(_query, documents, _topK) {
      return reorder(documents);
    },
  };
}

describe('applyRerank', () => {
  const hits = [
    { path: 'a.md', snippet: 'aa', content: 'aaa', score: 0.9 },
    { path: 'b.md', snippet: 'bb', content: 'bbb', score: 0.8 },
    { path: 'c.md', snippet: 'cc', content: 'ccc', score: 0.7 },
  ];

  it('reorders hits by reranker response and replaces score with relevanceScore', async () => {
    const reranker = fakeReranker(() => [
      { index: 2, relevanceScore: 0.99 },
      { index: 0, relevanceScore: 0.55 },
      { index: 1, relevanceScore: 0.10 },
    ]);
    const cfg: RerankConfig = { reranker, instruction: '' };

    const out = await applyRerank(hits, 'find', cfg);

    expect(out.map(h => h.path)).toEqual(['c.md', 'a.md', 'b.md']);
    expect(out[0].score).toBe(0.99);
    expect(out[1].score).toBe(0.55);
    expect(out[2].score).toBe(0.10);
  });

  it('passes the bare query when instruction is empty', async () => {
    let received = '';
    const reranker: VoyageReranker = {
      async rerank(query, documents) {
        received = query;
        return documents.map((_, i) => ({ index: i, relevanceScore: 1 - i * 0.1 }));
      },
    };
    await applyRerank(hits, 'plain query', { reranker, instruction: '' });
    expect(received).toBe('plain query');
  });

  it('prepends the trimmed instruction to the query when present', async () => {
    let received = '';
    const reranker: VoyageReranker = {
      async rerank(query, documents) {
        received = query;
        return documents.map((_, i) => ({ index: i, relevanceScore: 1 - i * 0.1 }));
      },
    };
    await applyRerank(hits, 'plain query', {
      reranker,
      instruction: '  Prefer how-to.  ',
    });
    expect(received).toBe('Prefer how-to.\n\nplain query');
  });

  it('returns [] for empty hits without calling the reranker', async () => {
    const reranker: VoyageReranker = {
      rerank: vi.fn(async () => []),
    };
    const out = await applyRerank([], 'q', { reranker, instruction: '' });
    expect(out).toEqual([]);
    expect(reranker.rerank).not.toHaveBeenCalled();
  });

  it('propagates reranker errors to the caller', async () => {
    const reranker: VoyageReranker = {
      async rerank() { throw new Error('boom'); },
    };
    await expect(
      applyRerank(hits, 'q', { reranker, instruction: '' })
    ).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npx vitest run tests/search.test.ts`
Expected: FAIL — `applyRerank` not exported.

- [ ] **Step 3: Implement**

Append to `src/search.ts` (above `SearchFn`):

```typescript
import type { VoyageReranker } from './voyage';

export interface RerankConfig {
  reranker: VoyageReranker;
  instruction: string;
}

export async function applyRerank(
  hits: SearchHit[],
  query: string,
  cfg: RerankConfig
): Promise<SearchHit[]> {
  if (hits.length === 0) return [];
  const trimmed = cfg.instruction.trim();
  const effectiveQuery = trimmed ? `${trimmed}\n\n${query}` : query;
  const documents = hits.map(h => h.content);
  const results = await cfg.reranker.rerank(effectiveQuery, documents, hits.length);
  return results.map(r => ({
    ...hits[r.index],
    score: r.relevanceScore,
  }));
}
```

Note: the existing `import type { VoyageClient } from './voyage';` line at the top can stay as-is; this adds a sibling `VoyageReranker` import. Combine into a single import line for tidiness:

```typescript
import type { VoyageClient, VoyageReranker } from './voyage';
```

- [ ] **Step 4: Run tests, confirm green**

Run: `npx vitest run tests/search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/search.ts tests/search.test.ts
git commit -m "Add applyRerank helper with instruction prepend"
```

---

## Task 6: Wire optional rerank into `executeSearch` and `executeLocalSearch`

The two execute functions gain an optional `rerank?: RerankConfig` parameter. When set, they fetch `candidateCount(limit)` results from the backend, call `applyRerank`, then slice to `limit`. Errors from `applyRerank` are NOT caught here — `main.ts` catches them so it can show a Notice.

**Files:**
- Modify: `src/search.ts`
- Test: `tests/search.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/search.test.ts`:

```typescript
describe('executeSearch with rerank', () => {
  it('over-fetches candidateCount(limit) from the collection and reranks to limit', async () => {
    const fake = new FakeCollection();
    fake.aggregateResults = Array.from({ length: 25 }, (_, i) => ({
      path: `n${i}.md`,
      content: `body ${i}`,
      score: 1 - i * 0.01,
    }));

    const reranker: VoyageReranker = {
      async rerank(_q, documents) {
        return documents
          .map((_, i) => ({ index: i, relevanceScore: i / 100 }))
          .reverse(); // last doc becomes top
      },
    };

    const hits = await executeSearch(
      fake,
      { index: 'idx', query: 'hello', limit: 5 },
      { reranker, instruction: '' }
    );

    expect(hits).toHaveLength(5);
    expect(hits[0].path).toBe('n24.md');
    // Verify the pipeline used limit=25 (5 × 5)
    const pipelineUsed = fake.lastPipeline![0] as { $vectorSearch: { limit: number } };
    expect(pipelineUsed.$vectorSearch.limit).toBe(25);
  });
});

describe('executeLocalSearch with rerank', () => {
  it('over-fetches candidateCount(limit) from the store and reranks to limit', async () => {
    const embed = vi.fn(async () => [[1, 0]]);
    const voyage: VoyageClient = { embed };

    const entries = Array.from({ length: 60 }, (_, i) => ({
      path: `n${i}.md`,
      embedding: [1, i * 0.001],
      content: `body ${i}`,
    }));

    const store = createLocalStore({
      adapter: new MemoryAdapter(),
      path: 'cache.json',
      model: 'voyage-4',
    });
    await store.load();
    for (const e of entries) {
      store.upsert(e.path, { mtime: 0, embedding: e.embedding, content: e.content });
    }

    const reranker: VoyageReranker = {
      async rerank(_q, documents) {
        // Promote whatever doc landed last in candidates
        return documents
          .map((_, i) => ({ index: i, relevanceScore: i / 100 }))
          .reverse();
      },
    };

    const hits = await executeLocalSearch(
      voyage,
      store,
      'find',
      5,
      { reranker, instruction: '' }
    );

    expect(hits).toHaveLength(5);
  });
});
```

Verify `FakeCollection` records `lastPipeline`. If it doesn't, add that field. Open `tests/fakes/collection.ts` and check.

- [ ] **Step 2: If `FakeCollection` doesn't record the pipeline, update it**

Read `tests/fakes/collection.ts`. If `lastPipeline` is not captured, add it:

```typescript
// Inside FakeCollection
lastPipeline: unknown[] | null = null;

aggregate(pipeline: unknown[]) {
  this.lastPipeline = pipeline;
  return {
    toArray: async () => this.aggregateResults,
  };
}
```

(Keep existing fields; this is additive.)

- [ ] **Step 3: Run tests, confirm failure**

Run: `npx vitest run tests/search.test.ts`
Expected: FAIL — `executeSearch`/`executeLocalSearch` don't take a third arg.

- [ ] **Step 4: Implement**

Replace `executeSearch` in `src/search.ts`:

```typescript
export async function executeSearch(
  collection: CollectionLike,
  opts: { index: string; query: string; limit: number },
  rerank?: RerankConfig
): Promise<SearchHit[]> {
  if (!opts.query.trim()) return [];
  const fetchLimit = rerank ? candidateCount(opts.limit) : opts.limit;
  const pipeline = buildVectorSearchPipeline({
    index: opts.index,
    query: opts.query,
    limit: fetchLimit,
  });
  const docs = await collection.aggregate(pipeline).toArray();
  const hits: SearchHit[] = docs.map(d => ({
    path: String(d.path),
    snippet: renderSnippet(String(d.content)),
    content: String(d.content),
    score: typeof d.score === 'number' ? d.score : 0,
  }));
  if (!rerank) return hits;
  const reranked = await applyRerank(hits, opts.query, rerank);
  return reranked.slice(0, opts.limit);
}
```

Replace `executeLocalSearch`:

```typescript
export async function executeLocalSearch(
  voyage: VoyageClient,
  store: LocalStore,
  query: string,
  limit: number,
  rerank?: RerankConfig
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const [queryEmbedding] = await voyage.embed([query], 'query');
  const fetchLimit = rerank ? candidateCount(limit) : limit;
  const hits = searchLocalStore(store, queryEmbedding, fetchLimit);
  if (!rerank) return hits;
  const reranked = await applyRerank(hits, query, rerank);
  return reranked.slice(0, limit);
}
```

- [ ] **Step 5: Run all tests, confirm green**

Run: `npx vitest run`
Expected: PASS across all suites.

- [ ] **Step 6: Commit**

```bash
git add src/search.ts tests/search.test.ts tests/fakes/collection.ts
git commit -m "Wire optional rerank into executeSearch and executeLocalSearch"
```

---

## Task 7: Settings UI for reranking

This is UI-only and exercised manually. Add a Reranking section with toggle, model dropdown, and instruction textarea, plus an inline warning when enabled without an API key.

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Add the UI section**

At the bottom of `VaultVectorSettingTab.display()` in `src/settings.ts`, append the following block (after the existing `Result limit` setting):

```typescript
    containerEl.createEl('h3', { text: 'Reranking' });

    new Setting(containerEl)
      .setName('Enable reranking')
      .setDesc('After initial retrieval, ask Voyage to reorder the top candidates. Applies to both providers. Requires a Voyage API key.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.rerankEnabled)
          .onChange(async (value: boolean) => {
            this.plugin.settings.rerankEnabled = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.rerankEnabled && !this.plugin.settings.voyageApiKey.trim()) {
      const warn = containerEl.createEl('div', {
        text: 'Reranking requires a Voyage API key (set above).',
      });
      warn.style.color = 'var(--text-error)';
      warn.style.marginBottom = '0.75em';
    }

    new Setting(containerEl)
      .setName('Rerank model')
      .setDesc('Voyage reranker model. Lite is faster; the full model is more accurate.')
      .addDropdown(drop =>
        drop
          .addOption('rerank-2.5-lite', 'rerank-2.5-lite')
          .addOption('rerank-2.5', 'rerank-2.5')
          .setValue(this.plugin.settings.rerankModel)
          .onChange(async (value: string) => {
            this.plugin.settings.rerankModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Rerank instruction (optional)')
      .setDesc('Prepended to the query when reranking. Use it to steer the reranker, e.g. "Prefer notes that explain why over notes that list how."')
      .addTextArea(text =>
        text
          .setPlaceholder('e.g. Prefer notes that explain why over notes that list how.')
          .setValue(this.plugin.settings.rerankInstruction)
          .onChange(async (value: string) => {
            this.plugin.settings.rerankInstruction = value;
            await this.plugin.saveSettings();
          })
      );
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS (no test changes here, but confirm no breakage).

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "Add Reranking section to settings UI"
```

---

## Task 8: Wire rerank into `main.ts`

Add lazy `getReranker()`, invalidate it on save/unload, validate at search time, and build the search closure with rerank + fallback.

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add imports and a private reranker field**

In `src/main.ts`, update the `voyage` import block to include the reranker type and factory:

```typescript
import { createVoyageClient, createVoyageReranker, type VoyageClient, type VoyageReranker } from './voyage';
```

Update the search import to include `applyRerank` and `RerankConfig`:

```typescript
import {
  executeLocalSearch,
  executeSearch,
  applyRerank,
  candidateCount,
  type RerankConfig,
  type SearchFn,
  type SearchHit,
  VaultVectorSearchModal,
} from './search';
```

Add a field to the class alongside the other lazy clients:

```typescript
  private reranker: VoyageReranker | null = null;
```

- [ ] **Step 2: Invalidate the reranker on save and unload**

In `onunload`, add reranker cleanup:

```typescript
  async onunload(): Promise<void> {
    if (this.atlas) {
      await this.atlas.close();
      this.atlas = null;
    }
    this.localStore = null;
    this.voyage = null;
    this.reranker = null;
  }
```

In `saveSettings`, do the same:

```typescript
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.atlas) {
      await this.atlas.close();
      this.atlas = null;
    }
    this.localStore = null;
    this.voyage = null;
    this.reranker = null;
  }
```

- [ ] **Step 3: Add `getReranker()`**

Add this method next to `getVoyage()`:

```typescript
  private getReranker(): VoyageReranker {
    if (!this.reranker) {
      this.reranker = createVoyageReranker({
        apiKey: this.settings.voyageApiKey,
        model: this.settings.rerankModel,
      });
    }
    return this.reranker;
  }
```

- [ ] **Step 4: Update `openSearchModal` to validate and wire rerank**

Replace `openSearchModal` in `src/main.ts` with:

```typescript
  private async openSearchModal(): Promise<void> {
    const onPick = (path: string) => this.app.workspace.openLinkText(path, '', false);

    if (this.settings.rerankEnabled && !this.settings.voyageApiKey.trim()) {
      new Notice('Reranking is enabled but Voyage API key is missing. Configure it in Settings.');
      return;
    }

    const rerankCfg: RerankConfig | undefined = this.settings.rerankEnabled
      ? { reranker: this.getReranker(), instruction: this.settings.rerankInstruction }
      : undefined;

    const wrapWithFallback = (
      fn: () => Promise<SearchHit[]>,
      vectorOnlyFallback: () => Promise<SearchHit[]>
    ): SearchFn => async () => {
      try {
        return await fn();
      } catch (err) {
        console.error('Vault Vector rerank failed', err);
        new Notice('Rerank failed, showing vector results.');
        return vectorOnlyFallback();
      }
    };

    if (this.settings.embeddingProvider === 'voyage-local') {
      if (!this.settings.voyageApiKey.trim()) {
        new Notice('Configure Voyage API key in Settings.');
        return;
      }
      const store = this.getLocalStore();
      const voyage = this.getVoyage();
      try {
        await store.load();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('Vault Vector load cache failed', err);
        new Notice(`Local cache load failed: ${detail}`);
        return;
      }
      const search: SearchFn = rerankCfg
        ? (query) =>
            wrapWithFallback(
              () => executeLocalSearch(voyage, store, query, this.settings.resultLimit, rerankCfg),
              () => executeLocalSearch(voyage, store, query, this.settings.resultLimit)
            )(query)
        : (query) => executeLocalSearch(voyage, store, query, this.settings.resultLimit);
      new VaultVectorSearchModal(this.app, search, onPick).open();
      return;
    }

    if (validateUri(this.settings.uri) !== 'valid') {
      new Notice('Configure Vault Vector connection in Settings.');
      return;
    }

    try {
      const collection = await this.getAtlas().getCollection();
      const search: SearchFn = rerankCfg
        ? (query) =>
            wrapWithFallback(
              () =>
                executeSearch(
                  collection,
                  { index: this.settings.indexName, query, limit: this.settings.resultLimit },
                  rerankCfg
                ),
              () =>
                executeSearch(
                  collection,
                  { index: this.settings.indexName, query, limit: this.settings.resultLimit }
                )
            )(query)
        : (query) =>
            executeSearch(collection, {
              index: this.settings.indexName,
              query,
              limit: this.settings.resultLimit,
            });
      new VaultVectorSearchModal(this.app, search, onPick).open();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Vault Vector connect failed', err);
      new Notice(`Atlas connection failed: ${detail}`);
    }
  }
```

Note: `candidateCount` is imported but not used directly in `main.ts` — that's fine, the executors call it internally. Drop the import if a linter complains:

```typescript
import {
  executeLocalSearch,
  executeSearch,
  applyRerank,
  type RerankConfig,
  type SearchFn,
  type SearchHit,
  VaultVectorSearchModal,
} from './search';
```

(Drop `applyRerank` and `candidateCount` from the import — neither is used directly here.) Final import block:

```typescript
import {
  executeLocalSearch,
  executeSearch,
  type RerankConfig,
  type SearchFn,
  type SearchHit,
  VaultVectorSearchModal,
} from './search';
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: PASS across all suites.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "Wire optional rerank into search command"
```

---

## Task 9: Manual smoke test

Not automated. Execute the steps in the design spec's "Manual Smoke" section against an Obsidian vault loaded with content (e.g. the Evergreen docs):

1. `npm run build`, copy `main.js` and `manifest.json` to `<vault>/.obsidian/plugins/vault-vector/`, reload Obsidian.
2. Rerank off, Atlas mode: run a query, note the order.
3. Enable rerank without API key: confirm red warning in settings AND missing-key Notice when running Search.
4. Add API key, rerun: order should shift.
5. Add a rerank instruction: order should shift further.
6. Switch to Voyage-local mode: confirm rerank still works.
7. Break the API key (append junk): confirm Notice "Rerank failed, showing vector results." and modal still opens with vector ordering.
8. Disable rerank: behavior reverts to pre-rerank.

- [ ] **Run all 8 smoke steps. Note any deviation.**

If everything passes, no further code changes. If something fails, file follow-up tasks for the specific bug, do not retro-edit this plan.

---

## Final verification

- [ ] Run the whole suite: `npx vitest run`. All green.
- [ ] Run the build: `npm run build`. No errors.
- [ ] Confirm spec-coverage: every section of `docs/superpowers/specs/2026-05-11-reranking-design.md` is implemented.
