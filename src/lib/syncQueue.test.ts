import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userId: 'alice' }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: state.userId } } } }) } },
}));
import { enqueueSync, flushSyncQueue, pendingJobs, registerSyncHandler } from './syncQueue';
import { writeLocal } from './durableStorage';

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  state.userId = 'alice';
});

describe('durable account-scoped synchronization', () => {
  it('persists before networking and retains the exact payload on failure', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('offline'));
    registerSyncHandler('test', handler);
    enqueueSync('alice', 'answer', 'test', { answer: 'word', timestamp: 123 });
    await flushSyncQueue('alice');
    expect(pendingJobs('alice')[0].payload).toEqual({ answer: 'word', timestamp: 123 });
    handler.mockResolvedValue(undefined);
    await flushSyncQueue('alice');
    expect(handler).toHaveBeenLastCalledWith({ answer: 'word', timestamp: 123 }, 'alice');
    expect(pendingJobs('alice')).toEqual([]);
  });

  it('does not submit one account’s jobs under another account', async () => {
    const handler = vi.fn();
    registerSyncHandler('owner', handler);
    enqueueSync('alice', 'answer', 'owner', {});
    state.userId = 'bob';
    await flushSyncQueue('alice');
    expect(handler).not.toHaveBeenCalled();
    expect(pendingJobs('alice')).toHaveLength(1);
    expect(pendingJobs('bob')).toEqual([]);
  });

  it('drains newer progress written while an older request is in flight', async () => {
    let release!: () => void;
    const request = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(() => request);
    registerSyncHandler('race', handler);
    enqueueSync('alice', 'session', 'race', { index: 1 });
    const first = flushSyncQueue('alice');
    const duplicate = flushSyncQueue('alice');
    await Promise.resolve();
    enqueueSync('alice', 'session', 'race', { index: 2 });
    release();
    await Promise.all([first, duplicate]);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith({ index: 2 }, 'alice');
    expect(pendingJobs('alice')).toEqual([]);
  });

  it('does not discard jobs while offline or before their handler loads', async () => {
    enqueueSync('alice', 'unknown', 'lazy-module', { index: 1 });
    await flushSyncQueue('alice');
    expect(pendingJobs('alice')).toHaveLength(1);
    Object.defineProperty(navigator, 'onLine', { value: false });
    const handler = vi.fn();
    registerSyncHandler('lazy-module', handler);
    await flushSyncQueue('alice');
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports quota failures instead of falsely claiming the answer was saved', () => {
    const listener = vi.fn();
    window.addEventListener('lumina:storage-error', listener);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeLocal('answer', {})).toThrow('无法保存到本机');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('lumina:storage-error', listener);
  });
});
