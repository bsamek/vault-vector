import { describe, expect, it } from 'vitest';
import { FakeCollection } from './collection';

describe('FakeCollection', () => {
  it('stores docs by _id and returns them via find().project()', async () => {
    const c = new FakeCollection();
    await c.replaceOne({ _id: 'a.md' }, { _id: 'a.md', path: 'a.md', content: 'hi' }, { upsert: true });
    await c.replaceOne({ _id: 'b.md' }, { _id: 'b.md', path: 'b.md', content: 'bye' }, { upsert: true });

    const ids = await c.find({}).project({ _id: 1 }).toArray();
    const idList = ids.map(d => d._id).sort();
    expect(idList).toEqual(['a.md', 'b.md']);
  });

  it('deleteMany removes matching ids and reports count', async () => {
    const c = new FakeCollection();
    await c.replaceOne({ _id: 'a.md' }, { _id: 'a.md' }, { upsert: true });
    await c.replaceOne({ _id: 'b.md' }, { _id: 'b.md' }, { upsert: true });

    const res = await c.deleteMany({ _id: { $in: ['a.md', 'missing.md'] } });
    expect(res.deletedCount).toBe(1);

    const remaining = await c.find({}).project({ _id: 1 }).toArray();
    expect(remaining.map(d => d._id)).toEqual(['b.md']);
  });

  it('rejects upserts for paths in rejectPaths', async () => {
    const c = new FakeCollection();
    c.rejectPaths.add('big.md');
    await expect(
      c.replaceOne({ _id: 'big.md' }, { _id: 'big.md' }, { upsert: true })
    ).rejects.toThrow(/big\.md/);
  });

  it('aggregate returns whatever was preloaded into aggregateResults', async () => {
    const c = new FakeCollection();
    c.aggregateResults = [{ path: 'x.md', content: 'x', score: 0.9 }];
    const out = await c.aggregate([]).toArray();
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('x.md');
  });
});
