import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ from: vi.fn(), filters: [] as Array<[string, unknown]>, updates: [] as unknown[] }));
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' } } } }) },
    from: state.from,
  },
}));
import { markRoutineStepCompleted } from './dailyRoutineApi';
import { flushSyncQueue, pendingJobs } from './syncQueue';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('replays an offline completion on its original learning day', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-28T04:00:00Z'));
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  await markRoutineStepCompleted('alice', { step: 'review', timeZone: 'Asia/Singapore', startingDueCount: 60 });
  expect(state.from).not.toHaveBeenCalled();
  expect(pendingJobs('alice')[0].payload).toMatchObject({ localDate: '2026-08-28' });
  vi.setSystemTime(new Date('2026-08-29T04:00:00Z'));
  const chain = {
    select: () => chain,
    eq: (key: string, value: unknown) => {
      state.filters.push([key, value]);
      return chain;
    },
    update: (value: unknown) => {
      state.updates.push(value);
      return chain;
    },
    maybeSingle: async () => ({
      data: {
        id: 'routine',
        step_order_json: ['review'],
        completed_steps_json: [],
        status: 'in_progress',
        main_learning_group_id: null,
      },
      error: null,
    }),
  };
  state.from.mockReturnValue(chain);
  Object.defineProperty(navigator, 'onLine', { value: true });
  await flushSyncQueue('alice');
  expect(state.filters).toContainEqual(['local_date', '2026-08-28']);
  expect(state.updates).toContainEqual(expect.objectContaining({ completed_steps_json: ['review'] }));
  expect(pendingJobs('alice')).toHaveLength(0);
});
