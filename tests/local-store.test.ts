import { describe, expect, it } from 'vitest';
import { createLocalStore, type FileAdapter } from '../src/local-store';
import type { NoteInput } from '../src/sync';

class MemoryAdapter implements FileAdapter {
  files = new Map<string, string>();
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`not found: ${path}`);
    return v;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
}

const note = (path: string, content = 'x', mtime = 0): NoteInput => ({ path, content, mtime });

describe('createLocalStore.load', () => {
  it('starts empty when the file does not exist', async () => {
    const adapter = new MemoryAdapter();
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    expect(store.size()).toBe(0);
  });

  it('reads existing entries when model matches', async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set(
      'cache.json',
      JSON.stringify({
        version: 1,
        model: 'voyage-4',
        entries: {
          'a.md': { mtime: 100, embedding: [0.1, 0.2], content: 'hello' },
        },
      })
    );
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    expect(store.size()).toBe(1);
    expect(store.all()[0]).toEqual({
      path: 'a.md',
      entry: { mtime: 100, embedding: [0.1, 0.2], content: 'hello' },
    });
  });

  it('discards the cache when the persisted model does not match', async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set(
      'cache.json',
      JSON.stringify({
        version: 1,
        model: 'voyage-3.5',
        entries: { 'a.md': { mtime: 100, embedding: [0.1], content: 'hi' } },
      })
    );
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    expect(store.size()).toBe(0);
  });

  it('discards the cache when the file is malformed', async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set('cache.json', 'not json');
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    expect(store.size()).toBe(0);
  });
});

describe('createLocalStore.save', () => {
  it('writes JSON with model and entries', async () => {
    const adapter = new MemoryAdapter();
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    store.upsert('a.md', { mtime: 1, embedding: [0.1, 0.2], content: 'A' });
    await store.save();

    const written = adapter.files.get('cache.json');
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!);
    expect(parsed.model).toBe('voyage-4');
    expect(parsed.entries['a.md']).toEqual({ mtime: 1, embedding: [0.1, 0.2], content: 'A' });
  });

  it('round-trips through load -> save -> load', async () => {
    const adapter = new MemoryAdapter();
    const s1 = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await s1.load();
    s1.upsert('a.md', { mtime: 1, embedding: [0.1], content: 'A' });
    s1.upsert('b.md', { mtime: 2, embedding: [0.2], content: 'B' });
    await s1.save();

    const s2 = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await s2.load();
    expect(s2.size()).toBe(2);
  });
});

describe('createLocalStore.diff', () => {
  async function setup(initialEntries: Record<string, { mtime: number }>) {
    const adapter = new MemoryAdapter();
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    for (const [path, { mtime }] of Object.entries(initialEntries)) {
      store.upsert(path, { mtime, embedding: [0], content: '' });
    }
    return store;
  }

  it('flags new paths for embedding', async () => {
    const store = await setup({});
    const diff = store.diff([note('a.md', 'A', 1), note('b.md', 'B', 2)]);
    expect(diff.toEmbed.map(n => n.path).sort()).toEqual(['a.md', 'b.md']);
    expect(diff.toDelete).toEqual([]);
  });

  it('flags changed mtime for re-embedding', async () => {
    const store = await setup({ 'a.md': { mtime: 1 } });
    const diff = store.diff([note('a.md', 'A', 2)]);
    expect(diff.toEmbed.map(n => n.path)).toEqual(['a.md']);
  });

  it('leaves unchanged mtime alone', async () => {
    const store = await setup({ 'a.md': { mtime: 1 } });
    const diff = store.diff([note('a.md', 'A', 1)]);
    expect(diff.toEmbed).toEqual([]);
    expect(diff.toDelete).toEqual([]);
  });

  it('marks cache entries missing from vault for deletion', async () => {
    const store = await setup({ 'a.md': { mtime: 1 }, 'orphan.md': { mtime: 1 } });
    const diff = store.diff([note('a.md', 'A', 1)]);
    expect(diff.toDelete).toEqual(['orphan.md']);
  });
});

describe('createLocalStore.remove', () => {
  it('drops entries by path', async () => {
    const adapter = new MemoryAdapter();
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    store.upsert('a.md', { mtime: 1, embedding: [0], content: '' });
    store.upsert('b.md', { mtime: 1, embedding: [0], content: '' });
    store.remove(['a.md']);
    expect(store.size()).toBe(1);
    expect(store.all()[0].path).toBe('b.md');
  });
});

describe('createLocalStore.renameEntry', () => {
  it('moves an entry from oldPath to newPath, returns true, preserves mtime/embedding/content', async () => {
    const adapter = new MemoryAdapter();
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    store.upsert('old.md', { mtime: 42, embedding: [0.1, 0.2], content: 'hello' });

    const result = store.renameEntry('old.md', 'new.md');

    expect(result).toBe(true);
    expect(store.size()).toBe(1);
    const all = store.all();
    expect(all[0].path).toBe('new.md');
    expect(all[0].entry).toEqual({ mtime: 42, embedding: [0.1, 0.2], content: 'hello' });
  });

  it('returns false when oldPath is absent, store size stays 0', async () => {
    const adapter = new MemoryAdapter();
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();

    const result = store.renameEntry('missing.md', 'new.md');

    expect(result).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('overwrites newPath if it already exists, single entry remains with source content', async () => {
    const adapter = new MemoryAdapter();
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    store.upsert('old.md', { mtime: 10, embedding: [1.0], content: 'source' });
    store.upsert('new.md', { mtime: 99, embedding: [9.9], content: 'target' });

    const result = store.renameEntry('old.md', 'new.md');

    expect(result).toBe(true);
    expect(store.size()).toBe(1);
    const all = store.all();
    expect(all[0].path).toBe('new.md');
    expect(all[0].entry).toEqual({ mtime: 10, embedding: [1.0], content: 'source' });
  });
});
