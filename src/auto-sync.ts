import type { SyncResult } from './sync';

export type AutoSyncOpKind = 'upsert' | 'delete' | 'rename';

export type AutoSyncOp =
  | { kind: 'upsert'; path: string }
  | { kind: 'delete'; path: string }
  | { kind: 'rename'; oldPath: string; newPath: string };

export type AutoSyncEvent =
  | { kind: 'create' | 'modify' | 'delete'; path: string }
  | { kind: 'rename'; oldPath: string; newPath: string };

export type AutoSyncStatus =
  | { kind: 'idle'; lastSyncAt: number | null }
  | { kind: 'pending'; pendingCount: number }
  | { kind: 'syncing'; inFlightCount: number }
  | { kind: 'error'; message: string };

export interface AutoSyncDeps {
  subscribeVaultEvents(onEvent: (e: AutoSyncEvent) => void): () => void;
  runFullSync(): Promise<SyncResult>;
  renameLocal(oldPath: string, newPath: string): boolean;
  isAutoSyncEnabled(): boolean;
  isLocalProvider(): boolean;
  now(): number;
  setTimer(cb: () => void, ms: number): number;
  clearTimer(id: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
  updateStatus(status: AutoSyncStatus): void;
  notice(message: string): void;
  logError(label: string, err: unknown): void;
}

export interface AutoSync {
  start(): void;
  stop(): void;
  flushNow(): Promise<void>;
  getStatus(): AutoSyncStatus;
}

const DEBOUNCE_MS = 8000;
const SIZE_CAP = 25;
const AGE_CAP_MS = 60_000;

export function createAutoSync(deps: AutoSyncDeps): AutoSync {
  let unsubscribe: (() => void) | null = null;
  let status: AutoSyncStatus = { kind: 'idle', lastSyncAt: null };

  function emitStatus(next: AutoSyncStatus): void {
    status = next;
    deps.updateStatus(next);
  }

  const pending = new Map<string, AutoSyncOp>();
  let oldestPendingAt: number | null = null;
  let debounceTimer: number | null = null;

  function scheduleFlush(): void {
    if (debounceTimer !== null) deps.clearTimer(debounceTimer);
    debounceTimer = deps.setTimer(() => {
      debounceTimer = null;
      void runFlush();
    }, DEBOUNCE_MS);
  }

  function maybeForceFlush(): boolean {
    if (pending.size >= SIZE_CAP) return true;
    if (oldestPendingAt !== null && deps.now() - oldestPendingAt >= AGE_CAP_MS) return true;
    return false;
  }

  let flushing = false;

  async function runFlush(): Promise<void> {
    if (flushing) return;
    if (pending.size === 0) {
      emitStatus({ kind: 'idle', lastSyncAt: deps.now() });
      return;
    }
    flushing = true;
    // Snapshot the keys in flight so we only clear those on success,
    // leaving any events that arrive during the async sync intact.
    const inFlightKeys = new Set(pending.keys());
    emitStatus({ kind: 'syncing', inFlightCount: inFlightKeys.size });
    let succeeded = false;
    try {
      await deps.runFullSync();
      for (const key of inFlightKeys) pending.delete(key);
      if (pending.size === 0) oldestPendingAt = null;
      emitStatus({ kind: 'idle', lastSyncAt: deps.now() });
      succeeded = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logError('AutoSync flush failed', err);
      emitStatus({ kind: 'error', message });
    } finally {
      flushing = false;
      if (succeeded && pending.size > 0) {
        if (debounceTimer !== null) { deps.clearTimer(debounceTimer); debounceTimer = null; }
        void runFlush();
      }
    }
  }

  function recordEvent(e: AutoSyncEvent): void {
    if (e.kind === 'rename') {
      if (deps.isLocalProvider()) {
        deps.renameLocal(e.oldPath, e.newPath);
      }
      pending.set(e.newPath, { kind: 'rename', oldPath: e.oldPath, newPath: e.newPath });
    } else if (e.kind === 'delete') {
      pending.set(e.path, { kind: 'delete', path: e.path });
    } else {
      pending.set(e.path, { kind: 'upsert', path: e.path });
    }
    if (oldestPendingAt === null) oldestPendingAt = deps.now();
    emitStatus({ kind: 'pending', pendingCount: pending.size });
    if (maybeForceFlush()) {
      if (debounceTimer !== null) { deps.clearTimer(debounceTimer); debounceTimer = null; }
      void runFlush();
    } else {
      scheduleFlush();
    }
  }

  return {
    start() {
      if (!deps.isAutoSyncEnabled()) return;
      unsubscribe = deps.subscribeVaultEvents(recordEvent);
      emitStatus({ kind: 'idle', lastSyncAt: null });
    },
    stop() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
    async flushNow() {
      if (debounceTimer !== null) { deps.clearTimer(debounceTimer); debounceTimer = null; }
      await runFlush();
    },
    getStatus() {
      return status;
    },
  };
}
