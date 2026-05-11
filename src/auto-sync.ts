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

export function createAutoSync(deps: AutoSyncDeps): AutoSync {
  let unsubscribe: (() => void) | null = null;
  let status: AutoSyncStatus = { kind: 'idle', lastSyncAt: null };

  function emitStatus(next: AutoSyncStatus): void {
    status = next;
    deps.updateStatus(next);
  }

  const pending = new Map<string, AutoSyncOp>();
  let oldestPendingAt: number | null = null;

  function recordEvent(e: AutoSyncEvent): void {
    if (e.kind === 'rename') {
      pending.set(e.newPath, { kind: 'rename', oldPath: e.oldPath, newPath: e.newPath });
    } else if (e.kind === 'delete') {
      pending.set(e.path, { kind: 'delete', path: e.path });
    } else {
      pending.set(e.path, { kind: 'upsert', path: e.path });
    }
    if (oldestPendingAt === null) oldestPendingAt = deps.now();
    emitStatus({ kind: 'pending', pendingCount: pending.size });
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
      // implementation in later task
    },
    getStatus() {
      return status;
    },
  };
}
