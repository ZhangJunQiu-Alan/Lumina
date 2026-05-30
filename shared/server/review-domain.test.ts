import { describe, expect, it } from 'vitest';
import {
  FAST_RECALL_MS,
  FIRST_MEMORY_STATE,
  MAX_DAILY_REVIEW_WORDS,
  planReviewBacklogRedistribution,
  resolveReviewState,
  resolveRound2State,
  sortDueReviewRows,
  toNextReviewAt,
  toReviewDateKey,
  toResultType,
} from './review-domain';

const BASE_TIME = new Date('2026-04-15T00:00:00.000Z');

function addDays(days: number) {
  const next = new Date(BASE_TIME);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

describe('review scheduling domain', () => {
  it('classifies recall speed and schedules the next review from round 2 outcomes', () => {
    expect(toResultType(false, 0)).toBe('wrong');
    expect(toResultType(true, FAST_RECALL_MS)).toBe('fast_correct');
    expect(toResultType(true, FAST_RECALL_MS + 1)).toBe('slow_correct');

    expect(resolveRound2State('new', 'wrong')).toBe(FIRST_MEMORY_STATE);
    expect(toNextReviewAt('fuzzy', BASE_TIME)).toBe(addDays(1));

    expect(resolveRound2State('new', 'slow_correct')).toBe('slow_recall');
    expect(toNextReviewAt('slow_recall', BASE_TIME)).toBe(addDays(3));

    expect(resolveRound2State('new', 'fast_correct')).toBe('stable_recall');
    expect(toNextReviewAt('stable_recall', BASE_TIME)).toBe(addDays(7));

    expect(resolveRound2State('fuzzy', 'fast_correct')).toBe('fuzzy');
  });

  it('graduates stable recall only after enough successful reviews', () => {
    expect(resolveReviewState('fuzzy', 'wrong', 0)).toBe('slow_recall');
    expect(resolveReviewState('stable_recall', 'wrong', 0)).toBe('stable_recall');
    expect(resolveReviewState('fuzzy', 'slow_correct', 1)).toBe('slow_recall');
    expect(resolveReviewState('stable_recall', 'slow_correct', 2)).toBe('stable_recall');
    expect(resolveReviewState('fuzzy', 'fast_correct', 1)).toBe('slow_recall');
    expect(resolveReviewState('slow_recall', 'fast_correct', 2)).toBe('stable_recall');
    expect(resolveReviewState('stable_recall', 'fast_correct', 3)).toBe('mastered');
    expect(toNextReviewAt('mastered', BASE_TIME)).toBeNull();
  });

  it('orders due reviews by due time, memory urgency, and oldest assessment', () => {
    const sorted = sortDueReviewRows([
      {
        memory_state: 'stable_recall',
        next_review_at: '2026-04-15T08:00:00.000Z',
        last_assessed_at: '2026-04-14T12:00:00.000Z',
        id: 'stable-late',
      },
      {
        memory_state: 'slow_recall',
        next_review_at: '2026-04-15T08:00:00.000Z',
        last_assessed_at: '2026-04-14T08:00:00.000Z',
        id: 'slow',
      },
      {
        memory_state: 'fuzzy',
        next_review_at: '2026-04-15T08:00:00.000Z',
        last_assessed_at: '2026-04-14T09:00:00.000Z',
        id: 'fuzzy',
      },
      {
        memory_state: 'stable_recall',
        next_review_at: '2026-04-14T08:00:00.000Z',
        last_assessed_at: '2026-04-14T07:00:00.000Z',
        id: 'oldest-due',
      },
      {
        memory_state: 'stable_recall',
        next_review_at: '2026-04-15T08:00:00.000Z',
        last_assessed_at: '2026-04-14T06:00:00.000Z',
        id: 'stable-early',
      },
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['oldest-due', 'fuzzy', 'slow', 'stable-early', 'stable-late']);
  });

  it('keeps today within the daily review cap and spreads excess backlog forward', () => {
    const overdueRows = Array.from(
      { length: 250 },
      (_, index) =>
        ({
          vocabulary_item_id: `word-${index}`,
          memory_state: index % 3 === 0 ? 'fuzzy' : index % 3 === 1 ? 'slow_recall' : 'stable_recall',
          next_review_at: '2026-04-10T08:00:00.000Z',
          last_assessed_at: `2026-04-09T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
        }) as const,
    );

    const backlogPlan = planReviewBacklogRedistribution(overdueRows, [], {
      now: BASE_TIME,
      timeZone: 'UTC',
    });

    expect(backlogPlan.activeRows).toHaveLength(MAX_DAILY_REVIEW_WORDS);
    expect(backlogPlan.rescheduledRows).toHaveLength(150);
    expect(backlogPlan.updates).toHaveLength(150);

    const rescheduledCounts = backlogPlan.updates.reduce((counts, update) => {
      const dateKey = toReviewDateKey(new Date(update.nextReviewAt), 'UTC');
      counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());

    expect(rescheduledCounts.get('2026-04-16')).toBe(MAX_DAILY_REVIEW_WORDS);
    expect(rescheduledCounts.get('2026-04-17')).toBe(50);
  });
});
