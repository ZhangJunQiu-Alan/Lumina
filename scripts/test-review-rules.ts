import assert from 'node:assert/strict';
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
} from '../server/review-domain.js';

const BASE_TIME = new Date('2026-04-15T00:00:00.000Z');

function expectIsoDay(actualIso: string | null, expectedIso: string | null) {
  assert.equal(actualIso, expectedIso);
}

function addDays(days: number) {
  const next = new Date(BASE_TIME);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function run() {
  assert.equal(toResultType(false, 0), 'wrong');
  assert.equal(toResultType(true, FAST_RECALL_MS), 'fast_correct');
  assert.equal(toResultType(true, FAST_RECALL_MS + 1), 'slow_correct');

  assert.equal(resolveRound2State('new', 'wrong'), 'fuzzy');
  assert.equal(FIRST_MEMORY_STATE, 'fuzzy');
  expectIsoDay(toNextReviewAt('fuzzy', BASE_TIME), addDays(1));

  assert.equal(resolveRound2State('new', 'slow_correct'), 'slow_recall');
  expectIsoDay(toNextReviewAt('slow_recall', BASE_TIME), addDays(3));

  assert.equal(resolveRound2State('new', 'fast_correct'), 'stable_recall');
  expectIsoDay(toNextReviewAt('stable_recall', BASE_TIME), addDays(7));

  assert.equal(resolveRound2State('fuzzy', 'fast_correct'), 'fuzzy');

  // Progression advances on every attempt, regardless of wrong/correct.
  // stable_recall graduates to mastered only when total successes reach 3.
  assert.equal(resolveReviewState('fuzzy', 'wrong', 0), 'slow_recall');
  assert.equal(resolveReviewState('stable_recall', 'wrong', 0), 'stable_recall');
  assert.equal(resolveReviewState('fuzzy', 'slow_correct', 1), 'slow_recall');
  assert.equal(resolveReviewState('stable_recall', 'slow_correct', 2), 'stable_recall');
  assert.equal(resolveReviewState('fuzzy', 'fast_correct', 1), 'slow_recall');
  assert.equal(resolveReviewState('slow_recall', 'fast_correct', 2), 'stable_recall');
  assert.equal(resolveReviewState('stable_recall', 'fast_correct', 3), 'mastered');
  assert.equal(toNextReviewAt('mastered', BASE_TIME), null);

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

  assert.deepEqual(
    sorted.map((item) => item.id),
    ['oldest-due', 'fuzzy', 'slow', 'stable-early', 'stable-late'],
  );

  const overdueRows = Array.from({ length: 250 }, (_, index) => ({
    vocabulary_item_id: `word-${index}`,
    memory_state: index % 3 === 0 ? 'fuzzy' : index % 3 === 1 ? 'slow_recall' : 'stable_recall',
    next_review_at: '2026-04-10T08:00:00.000Z',
    last_assessed_at: `2026-04-09T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
  } as const));

  const backlogPlan = planReviewBacklogRedistribution(overdueRows, [], {
    now: BASE_TIME,
    timeZone: 'UTC',
  });

  assert.equal(backlogPlan.activeRows.length, MAX_DAILY_REVIEW_WORDS);
  assert.equal(backlogPlan.rescheduledRows.length, 150);
  assert.equal(backlogPlan.updates.length, 150);

  const rescheduledCounts = backlogPlan.updates.reduce((counts, update) => {
    const dateKey = toReviewDateKey(new Date(update.nextReviewAt), 'UTC');
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  assert.equal(rescheduledCounts.get('2026-04-16'), MAX_DAILY_REVIEW_WORDS);
  assert.equal(rescheduledCounts.get('2026-04-17'), 50);

  const crowdedPlan = planReviewBacklogRedistribution(
    overdueRows.slice(0, 130),
    Array.from({ length: 80 }, () => ({ next_review_at: '2026-04-16T12:00:00.000Z' })),
    {
      now: BASE_TIME,
      timeZone: 'UTC',
    },
  );

  const crowdedCounts = crowdedPlan.updates.reduce((counts, update) => {
    const dateKey = toReviewDateKey(new Date(update.nextReviewAt), 'UTC');
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  assert.equal(crowdedPlan.activeRows.length, MAX_DAILY_REVIEW_WORDS);
  assert.equal(crowdedCounts.get('2026-04-16'), 20);
  assert.equal(crowdedCounts.get('2026-04-17'), 10);

  console.log('Review domain checks passed.');
}

run();
