import type { NoteInput } from './sync';

export interface FileAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
}

export type LocalStoreEntry = { mtime: number; embedding: number[]; content: string };

export type LocalDiff = { toEmbed: NoteInput[]; toDelete: string[] };

export interface LocalStore {
  load(): Promise<void>;
  save(): Promise<void>;
  diff(inputs: NoteInput[]): LocalDiff;
  upsert(path: string, entry: LocalStoreEntry): void;
  remove(paths: string[]): void;
  size(): number;
  all(): Array<{ path: string; entry: LocalStoreEntry }>;
}

interface PersistedShape {
  version: number;
  model: string;
  entries: Record<string, LocalStoreEntry>;
}

export function createLocalStore(opts: {
  adapter: FileAdapter;
  path: string;
  model: string;
}): LocalStore {
  const entries = new Map<string, LocalStoreEntry>();

  return {
    async load() {
      entries.clear();
      if (!(await opts.adapter.exists(opts.path))) return;
      let parsed: PersistedShape;
      try {
        const raw = await opts.adapter.read(opts.path);
        parsed = JSON.parse(raw) as PersistedShape;
      } catch {
        return;
      }
      if (!parsed || parsed.model !== opts.model || !parsed.entries) return;
      for (const [path, entry] of Object.entries(parsed.entries)) {
        entries.set(path, entry);
      }
    },

    async save() {
      const shape: PersistedShape = {
        version: 1,
        model: opts.model,
        entries: Object.fromEntries(entries),
      };
      await opts.adapter.write(opts.path, JSON.stringify(shape));
    },

    diff(inputs) {
      const toEmbed: NoteInput[] = [];
      const inputPaths = new Set<string>();
      for (const note of inputs) {
        inputPaths.add(note.path);
        const existing = entries.get(note.path);
        if (!existing || existing.mtime !== note.mtime) toEmbed.push(note);
      }
      const toDelete: string[] = [];
      for (const path of entries.keys()) {
        if (!inputPaths.has(path)) toDelete.push(path);
      }
      return { toEmbed, toDelete };
    },

    upsert(path, entry) {
      entries.set(path, entry);
    },

    remove(paths) {
      for (const p of paths) entries.delete(p);
    },

    size() {
      return entries.size;
    },

    all() {
      return Array.from(entries.entries()).map(([path, entry]) => ({ path, entry }));
    },
  };
}
