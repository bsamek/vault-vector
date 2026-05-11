import { describe, expect, it, vi } from 'vitest';
import {
  renderSnippet,
  buildVectorSearchPipeline,
  executeSearch,
  executeLocalSearch,
  candidateCount,
  applyRerank,
  type RerankConfig,
} from '../src/search';
import { FakeCollection } from './fakes/collection';
import { createLocalStore, type FileAdapter } from '../src/local-store';
import type { VoyageClient, VoyageInputType, VoyageReranker } from '../src/voyage';

class MemoryAdapter implements FileAdapter {
  files = new Map<string, string>();
  async exists(p: string) { return this.files.has(p); }
  async read(p: string) { return this.files.get(p)!; }
  async write(p: string, d: string) { this.files.set(p, d); }
}

describe('renderSnippet', () => {
  it('returns content unchanged when shorter than the limit', () => {
    expect(renderSnippet('hello world', 200)).toBe('hello world');
  });

  it('truncates with an ellipsis when over the limit', () => {
    const long = 'a'.repeat(300);
    const out = renderSnippet(long, 200);
    expect(out.length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses whitespace and newlines into single spaces', () => {
    expect(renderSnippet('  hello\n\n  world\n', 200)).toBe('hello world');
  });

  it('uses a default max of 200 chars when not specified', () => {
    const long = 'x'.repeat(500);
    expect(renderSnippet(long).length).toBe(200);
  });
});

describe('buildVectorSearchPipeline', () => {
  it('produces a $vectorSearch + $project pipeline', () => {
    const pipeline = buildVectorSearchPipeline({ index: 'idx', query: 'hello', limit: 5 });

    expect(pipeline).toHaveLength(2);
    expect(pipeline[0]).toEqual({
      $vectorSearch: {
        index: 'idx',
        path: 'content',
        query: 'hello',
        limit: 5,
        numCandidates: 50,
      },
    });
    expect(pipeline[1]).toMatchObject({
      $project: {
        path: 1,
        content: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    });
  });
});

describe('executeSearch', () => {
  it('returns an empty list for a blank query without calling the collection', async () => {
    const fake = new FakeCollection();
    fake.aggregateResults = [{ path: 'should-not-return.md', content: 'x', score: 1 }];

    const hits = await executeSearch(fake, { index: 'idx', query: '   ', limit: 5 });
    expect(hits).toEqual([]);
  });

  it('maps Atlas docs to search hits with rendered snippets', async () => {
    const fake = new FakeCollection();
    fake.aggregateResults = [
      { path: 'a.md', content: 'line one\n\nline two', score: 0.93 },
      { path: 'b.md', content: 'b content', score: 0.81 },
    ];

    const hits = await executeSearch(fake, { index: 'idx', query: 'hi', limit: 5 });

    expect(hits).toEqual([
      { path: 'a.md', snippet: 'line one line two', content: 'line one\n\nline two', score: 0.93 },
      { path: 'b.md', snippet: 'b content', content: 'b content', score: 0.81 },
    ]);
  });
});

describe('executeLocalSearch', () => {
  async function storeWith(entries: Array<{ path: string; embedding: number[]; content: string }>) {
    const store = createLocalStore({
      adapter: new MemoryAdapter(),
      path: 'cache.json',
      model: 'voyage-4',
    });
    await store.load();
    for (const e of entries) {
      store.upsert(e.path, { mtime: 0, embedding: e.embedding, content: e.content });
    }
    return store;
  }

  it('returns an empty list for blank queries without calling Voyage', async () => {
    const embed = vi.fn(async () => [[1, 0]]);
    const voyage: VoyageClient = { embed };
    const store = await storeWith([{ path: 'a.md', embedding: [1, 0], content: 'a' }]);

    const hits = await executeLocalSearch(voyage, store, '   ', 5);

    expect(hits).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it('embeds the query with input_type "query" and ranks store entries', async () => {
    const embed = vi.fn(async (_texts: string[], _t: VoyageInputType) => [[1, 0]]);
    const voyage: VoyageClient = { embed };
    const store = await storeWith([
      { path: 'far.md', embedding: [-1, 0], content: 'far' },
      { path: 'close.md', embedding: [1, 0.05], content: 'close' },
    ]);

    const hits = await executeLocalSearch(voyage, store, 'find', 5);

    expect(embed.mock.calls[0][1]).toBe('query');
    expect(hits[0].path).toBe('close.md');
  });
});

describe('candidateCount', () => {
  it('multiplies limit by 5 and caps at 50', () => {
    expect(candidateCount(1)).toBe(5);
    expect(candidateCount(5)).toBe(25);
    expect(candidateCount(10)).toBe(50);
    expect(candidateCount(11)).toBe(50);
    expect(candidateCount(20)).toBe(50);
    expect(candidateCount(100)).toBe(50);
  });
});

describe('applyRerank', () => {
  const hits = [
    { path: 'a.md', snippet: 'aa', content: 'aaa', score: 0.9 },
    { path: 'b.md', snippet: 'bb', content: 'bbb', score: 0.8 },
    { path: 'c.md', snippet: 'cc', content: 'ccc', score: 0.7 },
  ];

  it('reorders hits by reranker response and replaces score with relevanceScore', async () => {
    const reranker: VoyageReranker = {
      async rerank() {
        return [
          { index: 2, relevanceScore: 0.99 },
          { index: 0, relevanceScore: 0.55 },
          { index: 1, relevanceScore: 0.10 },
        ];
      },
    };
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
    const pipelineUsed = fake.lastPipeline![0] as { $vectorSearch: { limit: number } };
    expect(pipelineUsed.$vectorSearch.limit).toBe(25);
  });
});

describe('executeSearch debug timing', () => {
  it('invokes debug callback with "search" timing when provided', async () => {
    const fake = new FakeCollection();
    fake.aggregateResults = [{ path: 'a.md', content: 'a', score: 1 }];
    const log = vi.fn();
    await executeSearch(fake, { index: 'idx', query: 'hi', limit: 5 }, undefined, log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('search');
    expect(typeof log.mock.calls[0][1]).toBe('number');
    expect(log.mock.calls[0][1]).toBeGreaterThanOrEqual(0);
  });

  it('also invokes debug callback with "rerank" timing when reranking', async () => {
    const fake = new FakeCollection();
    fake.aggregateResults = [{ path: 'a.md', content: 'a', score: 1 }];
    const reranker: VoyageReranker = {
      async rerank(_q, documents) {
        return documents.map((_, i) => ({ index: i, relevanceScore: 1 - i * 0.1 }));
      },
    };
    const log = vi.fn();
    await executeSearch(
      fake,
      { index: 'idx', query: 'hi', limit: 5 },
      { reranker, instruction: '' },
      log,
    );
    const labels = log.mock.calls.map(c => c[0]);
    expect(labels).toEqual(['search', 'rerank']);
  });

  it('does not require a debug callback', async () => {
    const fake = new FakeCollection();
    fake.aggregateResults = [];
    await expect(
      executeSearch(fake, { index: 'idx', query: 'hi', limit: 5 })
    ).resolves.toEqual([]);
  });
});

describe('executeLocalSearch debug timing', () => {
  it('invokes debug callback with "search" timing when provided', async () => {
    const embed = vi.fn(async () => [[1, 0]]);
    const voyage: VoyageClient = { embed };
    const store = createLocalStore({
      adapter: new MemoryAdapter(),
      path: 'cache.json',
      model: 'voyage-4',
    });
    await store.load();
    store.upsert('a.md', { mtime: 0, embedding: [1, 0], content: 'a' });
    const log = vi.fn();
    await executeLocalSearch(voyage, store, 'q', 5, undefined, log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('search');
    expect(typeof log.mock.calls[0][1]).toBe('number');
  });

  it('also invokes debug callback with "rerank" timing when reranking', async () => {
    const embed = vi.fn(async () => [[1, 0]]);
    const voyage: VoyageClient = { embed };
    const store = createLocalStore({
      adapter: new MemoryAdapter(),
      path: 'cache.json',
      model: 'voyage-4',
    });
    await store.load();
    store.upsert('a.md', { mtime: 0, embedding: [1, 0], content: 'a' });
    const reranker: VoyageReranker = {
      async rerank(_q, docs) {
        return docs.map((_, i) => ({ index: i, relevanceScore: 1 - i * 0.1 }));
      },
    };
    const log = vi.fn();
    await executeLocalSearch(voyage, store, 'q', 5, { reranker, instruction: '' }, log);
    const labels = log.mock.calls.map(c => c[0]);
    expect(labels).toEqual(['search', 'rerank']);
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
    expect(hits[0].path).toBe('n24.md');
  });
});
