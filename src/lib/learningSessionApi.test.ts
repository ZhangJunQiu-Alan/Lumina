import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedLearningSession } from '../types';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown, userId: string) => Promise<void>>(),
  current: { status: 'completed', completed_at: '2026-09-23T09:03:06Z', session_round: null } as Record<
    string,
    unknown
  >,
  update: vi.fn(),
  flush: vi.fn(async () => {}),
  enqueue: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        update: state.update,
        maybeSingle: async () => ({ data: state.current, error: null }),
      };
      return query;
    },
    rpc: (...args: unknown[]) => state.rpc(...args),
  },
}));
vi.mock('./syncQueue', () => ({
  registerSyncHandler: (kind: string, handler: (payload: unknown, userId: string) => Promise<void>) =>
    state.handlers.set(kind, handler),
  enqueueSync: state.enqueue,
  flushSyncQueue: state.flush,
  pendingJobs: () => [],
}));

import {
  clearLearningGroupSession,
  completeLearningGroupAtomic,
  fetchLearningGroupSession,
  persistLearningGroupSession,
} from './learningSessionApi';
import { cacheLearningRecovery, readLearningRecovery } from './learningRecovery';

const session: PersistedLearningSession = {
  groupId: 'g1',
  round: 'round3',
  currentIndex: 11,
  queueWordIds: ['w1'],
  passedQueueIndices: [],
  round1ConfirmedWordIds: ['w1'],
  lastActiveAt: '2026-09-23T09:03:05Z',
  groupCompleted: false,
  completedAt: null,
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  state.update.mockClear();
  state.enqueue.mockClear();
  state.flush.mockReset().mockResolvedValue();
});

describe('completed learning sessions', () => {
  it('does not reopen a remote completed group whose session round has been cleared', async () => {
    await state.handlers.get('learning-session')!(session, 'alice');
    expect(state.update).not.toHaveBeenCalled();
  });

  it('waits for the completion sync and reports local completion instead of a missing group', async () => {
    cacheLearningRecovery('alice', 'g1', { groupTitle: '12 words', words: [], session });
    let release!: () => void;
    state.flush.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    let finished = false;
    const clearing = clearLearningGroupSession('alice', 'g1', { markCompleted: true }).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(await fetchLearningGroupSession('alice', 'g1')).toMatchObject({ completed: true, session: null });
    release();
    await clearing;
    expect(finished).toBe(true);
  });

  it('does not replace a local completion with the last unfinished snapshot', async () => {
    await clearLearningGroupSession('alice', 'g1', { markCompleted: true });
    state.enqueue.mockClear();
    await persistLearningGroupSession('alice', session);
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(readLearningRecovery('alice', 'g1')?.completed).toBe(true);
  });

  it('enqueues atomic group completion and updates local recovery', async () => {
    cacheLearningRecovery('alice', 'g1', { groupTitle: '12 words', words: [], session });
    await completeLearningGroupAtomic('alice', 'g1', ['w1', 'w2'], { timeZone: 'Asia/Shanghai' });

    expect(readLearningRecovery('alice', 'g1')?.completed).toBe(true);
    expect(readLearningRecovery('alice', 'g1')?.session).toBeNull();
    expect(state.enqueue).toHaveBeenCalledWith(
      'alice',
      'session:g1',
      'group-complete-atomic',
      expect.objectContaining({
        groupId: 'g1',
        wordIds: ['w1', 'w2'],
        timeZone: 'Asia/Shanghai',
      }),
    );
  });

  it('invokes complete_learning_group_atomic RPC handler when synced', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { success: true, group_id: 'g1', updated_count: 2, newly_learned_count: 2 },
      error: null,
    });

    const handler = state.handlers.get('group-complete-atomic');
    expect(handler).toBeDefined();

    await handler!(
      {
        groupId: 'g1',
        wordIds: ['w1', 'w2'],
        timeZone: 'Asia/Shanghai',
        localDate: '2026-09-24',
        completedAt: '2026-09-24T01:00:00Z',
      },
      'alice',
    );

    expect(state.rpc).toHaveBeenCalledWith('complete_learning_group_atomic', {
      p_user_id: 'alice',
      p_learning_group_id: 'g1',
      p_completed_word_ids: ['w1', 'w2'],
      p_time_zone: 'Asia/Shanghai',
      p_local_date: '2026-09-24',
    });
  });
});
