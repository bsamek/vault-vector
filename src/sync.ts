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
