import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAutoSync, type AutoSyncDeps } from '../src/auto-sync';

function fakeDeps(over: Partial<AutoSyncDeps> = {}): AutoSyncDeps {
  const subscribe = vi.fn(() => () => {});
  return {
    subscribeVaultEvents: subscribe,
    runFullSync: vi.fn(async () => ({ upserted: 0, deleted: 0, rejected: [] })),
    renameLocal: vi.fn(() => false),
    isAutoSyncEnabled: () => true,
    isLocalProvider: () => true,
    now: () => 0,
    setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
    clearTimer: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
    setInterval: (cb, ms) => setInterval(cb, ms) as unknown as number,
    clearInterval: (id) => clearInterval(id as unknown as NodeJS.Timeout),
    updateStatus: vi.fn(),
    notice: vi.fn(),
    logError: vi.fn(),
    ...over,
  };
}

describe('AutoSync lifecycle', () => {
  it('subscribes to vault events on start', () => {
    const deps = fakeDeps();
    const ctl = createAutoSync(deps);
    ctl.start();
    expect(deps.subscribeVaultEvents).toHaveBeenCalledOnce();
  });

  it('calls the unsubscribe returned by subscribe on stop', () => {
    const unsub = vi.fn();
    const deps = fakeDeps({ subscribeVaultEvents: vi.fn(() => unsub) });
    const ctl = createAutoSync(deps);
    ctl.start();
    ctl.stop();
    expect(unsub).toHaveBeenCalledOnce();
  });

  it('does not subscribe when autoSyncEnabled is false', () => {
    const deps = fakeDeps({ isAutoSyncEnabled: () => false });
    const ctl = createAutoSync(deps);
    ctl.start();
    expect(deps.subscribeVaultEvents).not.toHaveBeenCalled();
  });
});
