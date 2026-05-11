import { describe, expect, it } from 'vitest';
import { computeSyncDiff, type NoteInput } from '../src/sync';

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
