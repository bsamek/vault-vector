import { describe, expect, it, vi } from 'vitest';
import { computeSyncDiff, type NoteInput, runLocalSync, runSync } from '../src/sync';
import { FakeCollection } from './fakes/collection';
import { createLocalStore, type FileAdapter } from '../src/local-store';
import type { VoyageClient, VoyageInputType } from '../src/voyage';

class MemoryAdapter implements FileAdapter {
  files = new Map<string, string>();
  async exists(p: string) { return this.files.has(p); }
  async read(p: string) { return this.files.get(p)!; }
  async write(p: string, d: string) { this.files.set(p, d); }
}

function fakeVoyage(opts: { rejectContents?: Set<string> } = {}): VoyageClient {
  const reject = opts.rejectContents ?? new Set<string>();
  return {
    async embed(texts: string[], _inputType: VoyageInputType) {
      for (const t of texts) {
        if (reject.has(t)) throw new Error('Voyage 400: too long');
      }
      return texts.map(t => [t.length, t.charCodeAt(0) || 0]);
    },
  };
}

const note = (path: string, content = 'x', mtime = 0): NoteInput => ({ path, content, mtime });

describe('computeSyncDiff', () => {
  it('flags every vault file for upsert', () => {
    const files = [note('a.md'), note('b.md')];
    const diff = computeSyncDiff(files, []);
    expect(diff.toUpsert.map(f => f.path)).toEqual(['a.md', 'b.md']);
  });

  it('flags atlas ids that are not in the vault for deletion', () => {
    const files = [note('a.md')];
    const atlasIds = ['a.md', 'orphan.md'];
    const diff = computeSyncDiff(files, atlasIds);
    expect(diff.toDelete).toEqual(['orphan.md']);
  });

  it('returns no deletions when atlas and vault are identical', () => {
    const files = [note('a.md'), note('b.md')];
    const diff = computeSyncDiff(files, ['a.md', 'b.md']);
    expect(diff.toDelete).toEqual([]);
  });

  it('handles an empty vault by deleting everything in atlas', () => {
    const diff = computeSyncDiff([], ['a.md', 'b.md']);
    expect(diff.toUpsert).toEqual([]);
    expect(diff.toDelete.sort()).toEqual(['a.md', 'b.md']);
  });
});

describe('runSync', () => {
  it('upserts every vault file and reports counts', async () => {
    const fake = new FakeCollection();
    const files = [note('a.md', 'A'), note('b.md', 'B')];

    const result = await runSync(files, fake);

    expect(result.upserted).toBe(2);
    expect(result.deleted).toBe(0);
    expect(result.rejected).toEqual([]);
    expect(fake.docs.size).toBe(2);
    expect(fake.docs.get('a.md')).toMatchObject({ _id: 'a.md', path: 'a.md', content: 'A' });
  });

  it('deletes Atlas docs that are no longer in the vault', async () => {
    const fake = new FakeCollection();
    fake.docs.set('orphan.md', { _id: 'orphan.md', path: 'orphan.md', content: 'gone' });
    fake.docs.set('keep.md', { _id: 'keep.md', path: 'keep.md', content: 'stay' });

    const result = await runSync([note('keep.md', 'stay')], fake);

    expect(result.deleted).toBe(1);
    expect(fake.docs.has('orphan.md')).toBe(false);
    expect(fake.docs.has('keep.md')).toBe(true);
  });

  it('records rejected paths and continues with the rest', async () => {
    const fake = new FakeCollection();
    fake.rejectPaths.add('big.md');

    const result = await runSync(
      [note('big.md', 'huge'), note('ok.md', 'fine')],
      fake
    );

    expect(result.upserted).toBe(1);
    expect(result.rejected).toEqual(['big.md']);
    expect(fake.docs.has('ok.md')).toBe(true);
    expect(fake.docs.has('big.md')).toBe(false);
  });
});

describe('runLocalSync', () => {
  function makeStore() {
    return createLocalStore({
      adapter: new MemoryAdapter(),
      path: 'cache.json',
      model: 'voyage-4',
    });
  }

  it('embeds new files, persists them, and reports counts', async () => {
    const store = makeStore();
    await store.load();
    const voyage = fakeVoyage();

    const result = await runLocalSync([note('a.md', 'A', 1), note('b.md', 'B', 2)], store, voyage);

    expect(result.upserted).toBe(2);
    expect(result.deleted).toBe(0);
    expect(result.rejected).toEqual([]);
    expect(store.size()).toBe(2);
    const all = store.all().sort((x, y) => x.path.localeCompare(y.path));
    expect(all[0].entry.embedding).toEqual([1, 65]);
    expect(all[0].entry.content).toBe('A');
    expect(all[0].entry.mtime).toBe(1);
  });

  it('calls Voyage with input_type "document"', async () => {
    const store = makeStore();
    await store.load();
    const embed = vi.fn(async (texts: string[], _t: VoyageInputType) =>
      texts.map(() => [0])
    );
    const voyage: VoyageClient = { embed };

    await runLocalSync([note('a.md', 'A', 1)], store, voyage);

    expect(embed).toHaveBeenCalled();
    expect(embed.mock.calls[0][1]).toBe('document');
  });

  it('skips unchanged files (matching mtime)', async () => {
    const store = makeStore();
    await store.load();
    store.upsert('a.md', { mtime: 1, embedding: [9, 9], content: 'cached' });
    const embed = vi.fn(async (texts: string[], _t: VoyageInputType) =>
      texts.map(() => [1])
    );
    const voyage: VoyageClient = { embed };

    const result = await runLocalSync([note('a.md', 'A', 1)], store, voyage);

    expect(embed).not.toHaveBeenCalled();
    expect(result.upserted).toBe(0);
    expect(store.all()[0].entry.embedding).toEqual([9, 9]);
  });

  it('re-embeds when mtime changes', async () => {
    const store = makeStore();
    await store.load();
    store.upsert('a.md', { mtime: 1, embedding: [9, 9], content: 'old' });
    const voyage = fakeVoyage();

    const result = await runLocalSync([note('a.md', 'NEW', 2)], store, voyage);

    expect(result.upserted).toBe(1);
    expect(store.all()[0].entry.content).toBe('NEW');
    expect(store.all()[0].entry.mtime).toBe(2);
  });

  it('deletes cache entries no longer in the vault', async () => {
    const store = makeStore();
    await store.load();
    store.upsert('keep.md', { mtime: 1, embedding: [1], content: 'k' });
    store.upsert('orphan.md', { mtime: 1, embedding: [2], content: 'o' });
    const voyage = fakeVoyage();

    const result = await runLocalSync([note('keep.md', 'k', 1)], store, voyage);

    expect(result.deleted).toBe(1);
    expect(store.size()).toBe(1);
    expect(store.all()[0].path).toBe('keep.md');
  });

  it('records rejections per-chunk and continues with later chunks', async () => {
    const store = makeStore();
    await store.load();
    const voyage = fakeVoyage({ rejectContents: new Set(['BAD']) });

    const result = await runLocalSync(
      [note('ok1.md', 'A', 1), note('big.md', 'BAD', 1), note('ok2.md', 'B', 1)],
      store,
      voyage,
      { chunkSize: 1 }
    );

    expect(result.rejected).toEqual(['big.md']);
    expect(result.upserted).toBe(2);
    expect(store.size()).toBe(2);
  });

  it('persists the store to disk after sync', async () => {
    const adapter = new MemoryAdapter();
    const store = createLocalStore({ adapter, path: 'cache.json', model: 'voyage-4' });
    await store.load();
    const voyage = fakeVoyage();

    await runLocalSync([note('a.md', 'A', 1)], store, voyage);

    expect(adapter.files.has('cache.json')).toBe(true);
    const parsed = JSON.parse(adapter.files.get('cache.json')!);
    expect(parsed.entries['a.md']).toBeDefined();
  });
});
