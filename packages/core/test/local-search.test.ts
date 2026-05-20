import { describe, expect, it } from 'vitest';
import { cosineSimilarity, searchLocalStore } from '../src/local-search';
import { createLocalStore, type FileAdapter } from '../src/local-store';

class MemoryAdapter implements FileAdapter {
  files = new Map<string, string>();
  async exists(p: string) { return this.files.has(p); }
  async read(p: string) { return this.files.get(p)!; }
  async write(p: string, d: string) { this.files.set(p, d); }
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it('returns 0 when either vector is the zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

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

describe('searchLocalStore', () => {
  it('returns top-K hits ordered by cosine similarity', async () => {
    const store = await storeWith([
      { path: 'far.md', embedding: [-1, 0], content: 'far away content' },
      { path: 'close.md', embedding: [1, 0.05], content: 'very close content' },
      { path: 'mid.md', embedding: [0, 1], content: 'middle content' },
    ]);

    const hits = searchLocalStore(store, [1, 0], 2);
    expect(hits.map(h => h.path)).toEqual(['close.md', 'mid.md']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('returns an empty list for an empty store', async () => {
    const store = await storeWith([]);
    expect(searchLocalStore(store, [1, 0], 5)).toEqual([]);
  });

  it('renders snippets from stored content', async () => {
    const store = await storeWith([
      { path: 'a.md', embedding: [1, 0], content: 'hello   world\n\nstuff' },
    ]);
    const hits = searchLocalStore(store, [1, 0], 5);
    expect(hits[0].snippet).toBe('hello world stuff');
  });

  it('caps results at the requested limit', async () => {
    const store = await storeWith([
      { path: 'a.md', embedding: [1, 0], content: 'a' },
      { path: 'b.md', embedding: [0.9, 0.1], content: 'b' },
      { path: 'c.md', embedding: [0.8, 0.2], content: 'c' },
    ]);
    expect(searchLocalStore(store, [1, 0], 2)).toHaveLength(2);
  });
});
