import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userId: 'alice' }));
vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: state.userId } } } }) } },
}));

import {
  clearDeadLetters,
  deadLetterJobs,
  enqueueSync,
  flushSyncQueue,
  pendingJobs,
  registerSyncHandler,
  retryDeadLetters,
} from './OfflineSyncManager';

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  state.userId = 'alice';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OfflineSyncManager: Poison Pill Isolation & Resilience', () => {
  it('isolates 400 Bad Request poison pill to Dead Letter Queue without blocking subsequent jobs', async () => {
    const executed: string[] = [];

    registerSyncHandler('item', async (payload: unknown) => {
      const p = payload as { name: string; fail?: boolean };
      if (p.fail) {
        const error = new Error('Invalid parameter: malformed ID');
        (error as { status?: number }).status = 400;
        throw error;
      }
      executed.push(p.name);
    });

    // Enqueue 3 jobs: Job 1 (normal), Job 2 (poison pill 400), Job 3 (normal)
    enqueueSync('alice', 'job-1', 'item', { name: 'first' });
    enqueueSync('alice', 'job-2', 'item', { name: 'poison-pill', fail: true });
    enqueueSync('alice', 'job-3', 'item', { name: 'third' });

    expect(pendingJobs('alice')).toHaveLength(3);

    await flushSyncQueue('alice');

    // Job 1 and Job 3 must succeed!
    expect(executed).toEqual(['first', 'third']);

    // Pending jobs must now be 0! The queue was completely unblocked!
    expect(pendingJobs('alice')).toHaveLength(0);

    // Job 2 must be safely preserved in Dead Letter Queue
    const deadLetters = deadLetterJobs('alice');
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].id).toBe('job-2');
    expect(deadLetters[0].fatalReason).toContain('HTTP 400');
  });

  it('performs exponential backoff on transient 500 errors and only dead-letters after exhausting retries', async () => {
    let attempts = 0;
    registerSyncHandler('flaky', async () => {
      attempts += 1;
      const error = new Error('Internal Server Error');
      (error as { status?: number }).status = 500;
      throw error;
    });

    enqueueSync('alice', 'flaky-job', 'flaky', { attempt: 1 }, { maxRetries: 3 });

    // Initial attempt: retry 1 fails, enters 1s backoff
    await flushSyncQueue('alice');
    expect(attempts).toBe(1);
    expect(pendingJobs('alice')).toHaveLength(1);
    expect(pendingJobs('alice')[0].retryCount).toBe(1);
    expect(deadLetterJobs('alice')).toHaveLength(0);

    // Advance 1s: retry 2 fails, enters 2s backoff
    await vi.advanceTimersByTimeAsync(1100);
    expect(attempts).toBe(2);
    expect(pendingJobs('alice')[0].retryCount).toBe(2);
    expect(deadLetterJobs('alice')).toHaveLength(0);

    // Advance 2s: retry 3 fails -> maxRetries reached -> moved to dead letter queue
    await vi.advanceTimersByTimeAsync(2100);
    expect(attempts).toBe(3);
    expect(pendingJobs('alice')).toHaveLength(0);

    const deadLetters = deadLetterJobs('alice');
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].fatalReason).toContain('Exceeded max retry');
  });

  it('does not burn retry count when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });

    const handler = vi.fn();
    registerSyncHandler('offline-kind', handler);
    enqueueSync('alice', 'offline-job', 'offline-kind', { data: 123 });

    await flushSyncQueue('alice');
    expect(handler).not.toHaveBeenCalled();

    const jobs = pendingJobs('alice');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].retryCount).toBe(0);
    expect(deadLetterJobs('alice')).toHaveLength(0);
  });

  it('migrates legacy lumina.sync.v1 and lumina.attempt-queue.v2 data smoothly', async () => {
    // Setup legacy keys in localStorage
    localStorage.setItem(
      'lumina.sync.v1.alice',
      JSON.stringify([{ id: 'legacy-sync-1', kind: 'legacy-kind', revision: 'rev-1', payload: { ok: true } }]),
    );
    localStorage.setItem(
      'lumina.attempt-queue.v2.alice',
      JSON.stringify([{ vocabularyItemId: 'vocab-old', source: 'review', wasCorrect: true, elapsedMs: 100 }]),
    );

    const jobs = pendingJobs('alice');
    expect(jobs).toHaveLength(2);
    expect(jobs.some((j) => j.id === 'legacy-sync-1')).toBe(true);
    expect(jobs.some((j) => j.kind === 'batch_review_attempts')).toBe(true);

    // Legacy keys should be cleared after migration
    expect(localStorage.getItem('lumina.sync.v1.alice')).toBeNull();
    expect(localStorage.getItem('lumina.attempt-queue.v2.alice')).toBeNull();
  });

  it('supports dead letter retry and clear operations', async () => {
    const executed: string[] = [];
    registerSyncHandler('retryable', async (payload: unknown) => {
      executed.push((payload as { name: string }).name);
    });

    registerSyncHandler('failing', async () => {
      const err = new Error('HTTP 400 Bad Request');
      (err as { status?: number }).status = 400;
      throw err;
    });

    enqueueSync('alice', 'bad-job', 'failing', { name: 'repaired-later' });
    await flushSyncQueue('alice');

    expect(deadLetterJobs('alice')).toHaveLength(1);

    // Now repair handler
    registerSyncHandler('failing', async (payload: unknown) => {
      executed.push((payload as { name: string }).name);
    });

    retryDeadLetters('alice');
    expect(deadLetterJobs('alice')).toHaveLength(0);

    await flushSyncQueue('alice');
    expect(executed).toEqual(['repaired-later']);
    expect(pendingJobs('alice')).toHaveLength(0);

    // Clear operation test
    enqueueSync('alice', 'another-bad', 'never', {});
    clearDeadLetters('alice');
    expect(deadLetterJobs('alice')).toHaveLength(0);
  });
});
