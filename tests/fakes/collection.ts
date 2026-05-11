import type { CollectionLike } from '../../src/atlas';

export class FakeCollection implements CollectionLike {
  docs = new Map<string, Record<string, unknown>>();
  aggregateResults: Array<Record<string, unknown>> = [];
  rejectPaths = new Set<string>();

  async replaceOne(
    filter: { _id: string },
    doc: Record<string, unknown>,
    _opts?: { upsert?: boolean }
  ): Promise<unknown> {
    if (this.rejectPaths.has(filter._id)) {
      throw new Error(`FakeCollection rejected ${filter._id}`);
    }
    this.docs.set(filter._id, doc);
    return { acknowledged: true };
  }

  find(_filter: Record<string, unknown>) {
    const docs = Array.from(this.docs.values());
    return {
      project: (p: Record<string, 0 | 1>) => ({
        toArray: async () =>
          docs.map(d => {
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(p)) {
              if (p[key]) out[key] = d[key];
            }
            return out;
          }),
      }),
    };
  }

  async deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    const ids = ((filter._id as { $in?: string[] } | undefined)?.$in) ?? [];
    let deletedCount = 0;
    for (const id of ids) {
      if (this.docs.delete(id)) deletedCount++;
    }
    return { deletedCount };
  }

  aggregate(_pipeline: unknown[]) {
    const results = this.aggregateResults;
    return { toArray: async () => results };
  }
}
