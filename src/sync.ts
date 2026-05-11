import type { CollectionLike } from './atlas';

export type NoteInput = { path: string; content: string; mtime: number };

export type SyncDiff = {
  toUpsert: NoteInput[];
  toDelete: string[];
};

export function computeSyncDiff(vaultFiles: NoteInput[], atlasIds: string[]): SyncDiff {
  const vaultPaths = new Set(vaultFiles.map(f => f.path));
  const toDelete = atlasIds.filter(id => !vaultPaths.has(id));
  return { toUpsert: vaultFiles.slice(), toDelete };
}

export type SyncResult = {
  upserted: number;
  deleted: number;
  rejected: string[];
};

export async function runSync(
  vaultFiles: NoteInput[],
  collection: CollectionLike
): Promise<SyncResult> {
  const existing = await collection.find({}).project({ _id: 1 }).toArray();
  const atlasIds = existing.map(d => String(d._id));

  const diff = computeSyncDiff(vaultFiles, atlasIds);
  const rejected: string[] = [];
  let upserted = 0;

  for (const file of diff.toUpsert) {
    try {
      await collection.replaceOne(
        { _id: file.path },
        { _id: file.path, path: file.path, content: file.content, mtime: file.mtime },
        { upsert: true }
      );
      upserted++;
    } catch (err) {
      rejected.push(file.path);
      console.error(`Vault Vector sync: rejected ${file.path}`, err);
    }
  }

  let deleted = 0;
  if (diff.toDelete.length > 0) {
    const res = await collection.deleteMany({ _id: { $in: diff.toDelete } });
    deleted = res.deletedCount ?? diff.toDelete.length;
  }

  return { upserted, deleted, rejected };
}
