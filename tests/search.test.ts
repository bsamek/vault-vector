import { describe, expect, it, vi } from 'vitest';
import {
  renderSnippet,
  buildVectorSearchPipeline,
  executeSearch,
  executeLocalSearch,
  candidateCount,
} from '../src/search';
import { FakeCollection } from './fakes/collection';
import { createLocalStore, type FileAdapter } from '../src/local-store';
import type { VoyageClient, VoyageInputType } from '../src/voyage';

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
    expect(candidateCount(100)).toBe(50);
  });
});
