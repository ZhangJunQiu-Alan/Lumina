import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', () => ({ apiFetch: state.request }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' } } } }) } },
}));
import { ieltsSubmissionState, submitDurableIeltsAttempt } from './ieltsSubmission';
import { flushSyncQueue, pendingJobs } from './syncQueue';

const attempt = {
  testId: 'paper',
  startedAt: '2026-08-28T10:00:00Z',
  submittedAt: '2026-08-28T10:30:00Z',
  elapsedSeconds: 1800,
  score: 1,
  totalQuestions: 40,
  responses: [{ questionNumber: 1, response: ['answer'] }],
};
beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  state.request.mockReset();
});
describe('IELTS submit recovery', () => {
  it('keeps the first submitted answer and duration across failed retries', async () => {
    state.request.mockRejectedValue(new TypeError('network'));
    await expect(submitDurableIeltsAttempt('alice', 'reading', attempt)).rejects.toThrow('已保存在本机');
    await expect(
      submitDurableIeltsAttempt('alice', 'reading', { ...attempt, score: 30, elapsedSeconds: 9999 }),
    ).rejects.toThrow();
    expect(JSON.parse(state.request.mock.calls[1][1].body)).toEqual(attempt);
    expect(pendingJobs('alice')).toHaveLength(1);
    expect(ieltsSubmissionState('bob', 'reading', attempt.testId, attempt.startedAt).pending).toBe(false);
  });
  it('records a receipt and does not POST again after acknowledgement', async () => {
    state.request.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'saved' } })));
    const first = await submitDurableIeltsAttempt('alice', 'listening', attempt);
    const replay = await submitDurableIeltsAttempt('alice', 'listening', attempt);
    expect(replay).toEqual(first);
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(first.elapsedSeconds).toBe(1800);
    expect(pendingJobs('alice')).toEqual([]);
  });
  it('recovers automatically when the queue is retried after reconnect', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });
    await expect(submitDurableIeltsAttempt('alice', 'reading', attempt)).rejects.toThrow();
    expect(state.request).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { value: true });
    state.request.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'reconnected' } })));
    await flushSyncQueue('alice');
    expect(ieltsSubmissionState('alice', 'reading', attempt.testId, attempt.startedAt).receipt?.id).toBe('reconnected');
  });
});
