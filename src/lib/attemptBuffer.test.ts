import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  submit: vi.fn(),
}));
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (listener: typeof state.auth) => {
        state.auth = listener;
      },
    },
  },
}));
vi.mock('./reviewApi', () => ({ submitBatchReviewAttempts: state.submit }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  state.submit.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answer = { vocabularyItemId: 'word', source: 'review' as const, wasCorrect: true, elapsedMs: 42 };
const signIn = (id: string) => state.auth?.('SIGNED_IN', { user: { id } });

it('keeps offline answers on disk and restores them only for their owner', async () => {
  const { attemptBuffer } = await import('./attemptBuffer');
  signIn('alice');
  await attemptBuffer.pushAttempt(answer);
  await attemptBuffer.flush();
  expect(state.submit).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('lumina.attempt-queue.v2.alice')!)[0]).toMatchObject(answer);
  signIn('bob');
  expect(attemptBuffer.getPendingCount()).toBe(0);
  await attemptBuffer.pushAttempt({ ...answer, vocabularyItemId: 'bob-word' });
  signIn('alice');
  expect(attemptBuffer.getPendingCount()).toBe(1);
  await attemptBuffer.flush();
  Object.defineProperty(navigator, 'onLine', { value: true });
  state.submit.mockResolvedValue([{ ignored: false }]);
  await attemptBuffer.flush();
  expect(state.submit).toHaveBeenCalledWith([expect.objectContaining(answer)], 'alice');
  expect(attemptBuffer.getPendingCount()).toBe(0);
  expect(JSON.parse(localStorage.getItem('lumina.attempt-queue.v2.bob')!)).toHaveLength(1);
});

it('does not remove another account’s data when a late request finishes', async () => {
  const { attemptBuffer } = await import('./attemptBuffer');
  signIn('alice');
  await attemptBuffer.pushAttempt(answer);
  Object.defineProperty(navigator, 'onLine', { value: true });
  let finish!: (value: unknown) => void;
  state.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = attemptBuffer.flush();
  signIn('bob');
  await attemptBuffer.pushAttempt({ ...answer, vocabularyItemId: 'bob-word' });
  finish([{ ignored: false }]);
  await pending;
  expect(attemptBuffer.getPendingCount()).toBe(1);
  expect(JSON.parse(localStorage.getItem('lumina.attempt-queue.v2.alice')!)).toHaveLength(1);
});

it('rejects an answer when it cannot be saved rather than acknowledging it', async () => {
  const { attemptBuffer } = await import('./attemptBuffer');
  signIn('alice');
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await expect(attemptBuffer.pushAttempt(answer)).rejects.toThrow('无法保存到本机');
  expect(attemptBuffer.getPendingCount()).toBe(0);
});

it('isolates 400 Bad Request attempts to DLQ without permanently blocking subsequent answers', async () => {
  const { attemptBuffer } = await import('./attemptBuffer');
  const { deadLetterJobs } = await import('./sync/OfflineSyncManager');
  signIn('alice');
  Object.defineProperty(navigator, 'onLine', { value: true });

  // Submit throws 400 on first call, then succeeds on second call
  state.submit
    .mockRejectedValueOnce(Object.assign(new Error('HTTP 400 Bad Request'), { status: 400 }))
    .mockResolvedValueOnce([{ ignored: false }]);

  // Push poisoned answer
  await attemptBuffer.pushAttempt({ ...answer, vocabularyItemId: 'poison-word' });
  expect(attemptBuffer.getPendingCount()).toBe(1);

  // Flush poisoned answer -> should isolate to DLQ and return without throwing
  await attemptBuffer.flush();

  // Pending count should be 0 (unblocked!)
  expect(attemptBuffer.getPendingCount()).toBe(0);

  // Dead letters should have the bad item
  const dlq = deadLetterJobs('alice');
  expect(dlq.length).toBeGreaterThan(0);
  expect(dlq[0].fatalReason).toContain('HTTP 400');

  // Push subsequent normal answer -> should flush and succeed immediately
  await attemptBuffer.pushAttempt({ ...answer, vocabularyItemId: 'healthy-word' });
  await attemptBuffer.flush();
  expect(attemptBuffer.getPendingCount()).toBe(0);
  expect(state.submit).toHaveBeenCalledTimes(2);
});
