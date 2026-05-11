import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('AutoSync pending set', () => {
  it('records distinct upsert ops by path', () => {
    let onEvent: ((e: any) => void) | null = null;
    const deps = fakeDeps({
      subscribeVaultEvents: (cb) => { onEvent = cb; return () => {}; },
    });
    const ctl = createAutoSync(deps);
    ctl.start();
    onEvent!({ kind: 'modify', path: 'a.md' });
    onEvent!({ kind: 'modify', path: 'b.md' });
    expect(ctl.getStatus()).toMatchObject({ kind: 'pending', pendingCount: 2 });
  });

  it('coalesces repeated modifies on the same path', () => {
    let onEvent: ((e: any) => void) | null = null;
    const deps = fakeDeps({
      subscribeVaultEvents: (cb) => { onEvent = cb; return () => {}; },
    });
    const ctl = createAutoSync(deps);
    ctl.start();
    for (let i = 0; i < 10; i++) onEvent!({ kind: 'modify', path: 'a.md' });
    expect(ctl.getStatus()).toMatchObject({ kind: 'pending', pendingCount: 1 });
  });

  it('a delete after a modify replaces the upsert with a delete', () => {
    let onEvent: ((e: any) => void) | null = null;
    const deps = fakeDeps({
      subscribeVaultEvents: (cb) => { onEvent = cb; return () => {}; },
    });
    const ctl = createAutoSync(deps);
    ctl.start();
    onEvent!({ kind: 'modify', path: 'a.md' });
    onEvent!({ kind: 'delete', path: 'a.md' });
    expect(ctl.getStatus()).toMatchObject({ kind: 'pending', pendingCount: 1 });
  });
});

describe('AutoSync flush triggers', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('flushes after 8s of idle', async () => {
    let onEvent: any = null;
    const runFullSync = vi.fn(async () => ({ upserted: 1, deleted: 0, rejected: [] }));
    const deps = fakeDeps({
      subscribeVaultEvents: (cb) => { onEvent = cb; return () => {}; },
      runFullSync,
      setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
      clearTimer: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      now: () => Date.now(),
    });
    const ctl = createAutoSync(deps);
    ctl.start();
    onEvent({ kind: 'modify', path: 'a.md' });
    await vi.advanceTimersByTimeAsync(7999);
    expect(runFullSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(runFullSync).toHaveBeenCalledOnce();
  });

  it('resets debounce on each event', async () => {
    let onEvent: any = null;
    const runFullSync = vi.fn(async () => ({ upserted: 1, deleted: 0, rejected: [] }));
    const deps = fakeDeps({
      subscribeVaultEvents: (cb) => { onEvent = cb; return () => {}; },
      runFullSync,
      setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
      clearTimer: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      now: () => Date.now(),
    });
    const ctl = createAutoSync(deps);
    ctl.start();
    onEvent({ kind: 'modify', path: 'a.md' });
    await vi.advanceTimersByTimeAsync(5000);
    onEvent({ kind: 'modify', path: 'b.md' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(runFullSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3001);
    expect(runFullSync).toHaveBeenCalledOnce();
  });

  it('flushes immediately when size cap is hit', async () => {
    let onEvent: any = null;
    const runFullSync = vi.fn(async () => ({ upserted: 25, deleted: 0, rejected: [] }));
    const deps = fakeDeps({
      subscribeVaultEvents: (cb) => { onEvent = cb; return () => {}; },
      runFullSync,
      setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
      clearTimer: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      now: () => Date.now(),
    });
    const ctl = createAutoSync(deps);
    ctl.start();
    for (let i = 0; i < 25; i++) onEvent({ kind: 'modify', path: `f${i}.md` });
    await vi.advanceTimersByTimeAsync(0);
    expect(runFullSync).toHaveBeenCalledOnce();
  });

  it('flushes when oldest pending op exceeds age cap', async () => {
    let onEvent: any = null;
    const runFullSync = vi.fn(async () => ({ upserted: 1, deleted: 0, rejected: [] }));
    const deps = fakeDeps({
      subscribeVaultEvents: (cb) => { onEvent = cb; return () => {}; },
      runFullSync,
      setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
      clearTimer: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
      now: () => Date.now(),
    });
    const ctl = createAutoSync(deps);
    ctl.start();
    for (let i = 0; i < 13; i++) {
      onEvent({ kind: 'modify', path: `f${i}.md` });
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(runFullSync).toHaveBeenCalled();
  });
});
