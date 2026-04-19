import assert from 'node:assert/strict';
import {
  FAST_RECALL_MS,
  resolveReviewState,
  resolveRound2State,
  sortDueReviewRows,
  toNextReviewAt,
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

  console.log('Review domain checks passed.');
}

run();
