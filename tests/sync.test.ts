import { describe, expect, it } from 'vitest';
import { computeSyncDiff, type NoteInput, runSync } from '../src/sync';
import { FakeCollection } from './fakes/collection';

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
