import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markVocabularyMastered, markVocabularyUnknown, recordReviewAttempt } from './review';
import { cleanupSavedLibrary } from './savedLibraryCleanup';

const db = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  state: {} as Record<string, unknown>,
  events: [] as Record<string, unknown>[],
  writes: vi.fn(),
}));
vi.mock('./supabase.ts', () => ({ supabaseAdmin: db }));

const now = Date.parse('2026-09-16T08:00:00Z');
const attempt = {
  userId: 'user1',
  vocabularyItemId: 'word1',
  learningGroupId: 'group1',
  source: 'review' as const,
  wasCorrect: false,
  elapsedMs: 2000,
  timestamp: now,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.events = [];
  db.state = {
    user_id: 'user1',
    vocabulary_item_id: 'word1',
    memory_state: 'stable_recall',
    review_count: 12,
    lapse_count: 2,
    last_assessed_at: '2026-09-15T08:00:00Z',
    next_review_at: '2026-09-16T07:00:00Z',
    graduated_at: null,
  };
  // Default RPC mock returns function not found error to trigger fallback tests
  db.rpc.mockResolvedValue({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function record_review_attempt_atomic' },
  });
  db.from.mockImplementation((table: string) => {
    if (table === 'daily_routine_progress') {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          return { data: { timezone: 'Asia/Singapore' }, error: null };
        },
      };
    }
    if (table === 'daily_user_statistics') {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
        async insert() {
          return { error: null };
        },
        async update() {
          return { error: null };
        },
        async upsert() {
          return { error: null };
        },
      };
    }
    if (!['review_states', 'review_events'].includes(table)) throw new Error(`Unexpected access: ${table}`);
    const filters: Record<string, unknown> = {};
    return {
      select() {
        return this;
      },
      eq(key: string, value: unknown) {
        filters[key] = value;
        return this;
      },
      gte() {
        return this;
      },
      lte() {
        return this;
      },
      async maybeSingle() {
        return { data: { ...db.state }, error: null };
      },
      async upsert(value: Record<string, unknown>) {
        db.writes(value);
        db.state = { ...db.state, ...value };
        return { error: null };
      },
      async insert(value: Record<string, unknown>) {
        db.events.push(value);
        return { error: null };
      },
      then(resolve: (value: unknown) => void) {
        return Promise.resolve(
          resolve({
            data: db.events.filter((event) => Object.entries(filters).every(([key, value]) => event[key] === value)),
            count: db.events.length,
            error: null,
          }),
        );
      },
    };
  });
});

describe('review persistence', () => {
  it('assesses a new word from its first result without graduating it', async () => {
    db.state = { memory_state: 'new', review_count: 0, lapse_count: 0, next_review_at: null };
    const result = await recordReviewAttempt({ ...attempt, wasCorrect: true });
    expect(result).toMatchObject({
      memoryState: 'stable_recall',
      graduated: false,
      nextReviewAt: '2026-09-23T01:00:00.000Z',
    });
    expect(db.state).toMatchObject({ review_count: 1, lapse_count: 0 });
  });

  it.each(['2026-09-15T07:00:00Z', '2026-09-20T07:00:00Z', null])(
    'keeps a wrong answer due even when the old due date is %s',
    async (due) => {
      db.state.next_review_at = due;
      const result = await recordReviewAttempt(attempt);
      expect(result.memoryState).toBe('fuzzy');
      expect(result.graduated).toBe(false);
      expect(Date.parse(result.nextReviewAt!)).toBe(Math.min(due ? Date.parse(due) : now, now));
      expect(db.state).toMatchObject({ interval_days: 1, review_count: 13, lapse_count: 3, graduated_at: null });
      expect(db.events).toHaveLength(1);
      expect(db.events[0]).toMatchObject({
        was_correct: false,
        next_state: 'fuzzy',
        next_review_at: result.nextReviewAt,
      });
    },
  );

  it('downgrades slow correct recall and schedules it for three days', async () => {
    const result = await recordReviewAttempt({ ...attempt, wasCorrect: true, elapsedMs: 6001 });
    expect(result).toMatchObject({
      memoryState: 'slow_recall',
      graduated: false,
      nextReviewAt: '2026-09-19T01:00:00.000Z',
    });
    expect(db.state).toMatchObject({ review_count: 13, lapse_count: 2, interval_days: 3 });
  });

  it('graduates only a fast correct stable review with enough successes', async () => {
    expect(await recordReviewAttempt({ ...attempt, wasCorrect: true, elapsedMs: 6000 })).toMatchObject({
      memoryState: 'mastered',
      nextReviewAt: null,
      graduated: true,
    });
  });

  it('replays a synced attempt and ignores older attempts without writing again', async () => {
    const first = await recordReviewAttempt(attempt);
    expect(await recordReviewAttempt(attempt)).toEqual(first);
    expect(await recordReviewAttempt({ ...attempt, wasCorrect: true, timestamp: now - 1000 })).toMatchObject({
      ignored: true,
      memoryState: 'fuzzy',
      graduated: false,
    });
    expect(db.writes).toHaveBeenCalledOnce();
    expect(db.events).toHaveLength(1);
  });

  it.each(['round2', 'round3'] as const)(
    'does not postpone an already due word after wrong %s practice',
    async (source) => {
      const oldDue = db.state.next_review_at;
      const result = await recordReviewAttempt({ ...attempt, source });
      expect(result.memoryState).toBe('fuzzy');
      expect(Date.parse(result.nextReviewAt!)).toBe(Date.parse(oldDue as string));
      expect(result.graduated).toBe(false);
    },
  );

  it('keeps a manually marked unknown word due', async () => {
    db.state.next_review_at = '2026-09-20T08:00:00Z';
    const result = await markVocabularyUnknown(attempt);
    expect(result).toMatchObject({ memoryState: 'fuzzy', graduated: false, nextReviewAt: new Date(now).toISOString() });
  });

  it('marking mastered changes review state without accessing bookmarks or learning groups', async () => {
    await markVocabularyMastered(attempt);
    expect(db.state.memory_state).toBe('mastered');
    expect(db.from.mock.calls.map(([table]) => table)).toEqual(['review_states', 'review_states', 'review_events']);
  });

  it('calls record_review_attempt_atomic RPC and returns its response when available', async () => {
    db.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        memory_state: 'slow_recall',
        next_review_at: '2026-09-19T01:00:00.000Z',
        graduated: false,
        transition: {
          from: 'fuzzy',
          to: 'slow_recall',
          source: 'review',
          result: 'slow_correct',
          graduated: false,
          nextReviewAt: '2026-09-19T01:00:00.000Z',
        },
      },
      error: null,
    });

    const result = await recordReviewAttempt({ ...attempt, wasCorrect: true, elapsedMs: 3000 });
    expect(db.rpc).toHaveBeenCalledWith(
      'record_review_attempt_atomic',
      expect.objectContaining({
        p_user_id: 'user1',
        p_vocabulary_item_id: 'word1',
        p_source: 'review',
        p_was_correct: true,
      }),
    );
    expect(result).toMatchObject({
      memoryState: 'slow_recall',
      nextReviewAt: '2026-09-19T01:00:00.000Z',
      graduated: false,
    });
  });
});

describe('retired saved-library cleanup', () => {
  it.each([true, false])('does not read or mutate any user data (apply=%s)', async (apply) => {
    const before = { ...db.state };
    for (let visit = 0; visit < 3; visit += 1) {
      expect(await cleanupSavedLibrary({ apply, userId: 'user1' })).toMatchObject({
        retired: true,
        deletedCustomGroups: 0,
        removedSavedWords: 0,
        createdReviewStates: 0,
      });
    }
    expect(db.from).not.toHaveBeenCalled();
    expect(db.state).toEqual(before);
  });
});
