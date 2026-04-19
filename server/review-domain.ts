export type MemoryState = 'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered';
export type ReviewAttemptSource = 'round2' | 'review';
export type ReviewResultType = 'wrong' | 'slow_correct' | 'fast_correct';

export interface SortableDueReviewRow {
  memory_state: MemoryState;
  next_review_at: string | null;
  last_assessed_at: string | null;
}

export const FAST_RECALL_MS = 6000;

export const STATE_INTERVAL_DAYS: Record<MemoryState, number | null> = {
  new: null,
  fuzzy: 1,
  slow_recall: 3,
  stable_recall: 7,
  mastered: null,
};

export const STATE_PRIORITY: Record<Exclude<MemoryState, 'new' | 'mastered'>, number> = {
  fuzzy: 0,
  slow_recall: 1,
  stable_recall: 2,
};

export function toResultType(wasCorrect: boolean, elapsedMs: number): ReviewResultType {
  if (!wasCorrect) return 'wrong';
  return elapsedMs > FAST_RECALL_MS ? 'slow_correct' : 'fast_correct';
}

export function resolveRound2State(previousState: MemoryState, result: ReviewResultType): MemoryState {
  if (previousState !== 'new') return previousState;
  if (result === 'wrong') return 'fuzzy';
  return result === 'slow_correct' ? 'slow_recall' : 'stable_recall';
}

export function resolveReviewState(
  previousState: MemoryState,
  result: ReviewResultType,
  totalSuccesses: number,
): MemoryState {
  if (previousState === 'mastered') return 'mastered';

  // Progression: new -> fuzzy -> slow_recall -> stable_recall -> mastered
  switch (previousState) {
    case 'new':
      return 'fuzzy';
    case 'fuzzy':
      return 'slow_recall';
    case 'slow_recall':
      return 'stable_recall';
    case 'stable_recall':
      // Only graduate if total successes (including this attempt if correct) is >= 3
      if (totalSuccesses >= 3) {
        return 'mastered';
      }
      return 'stable_recall';
    default:
      return 'fuzzy';
  }
}

export function toNextReviewAt(state: MemoryState, now: Date): string | null {
  const intervalDays = STATE_INTERVAL_DAYS[state];
  if (intervalDays === null) return null;

  const next = new Date(now);
  next.setDate(next.getDate() + intervalDays);
  return next.toISOString();
}

export function intervalForState(state: MemoryState): number | null {
  return STATE_INTERVAL_DAYS[state];
}

export function normalizeElapsedMs(elapsedMs: number): number {
  return Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.round(elapsedMs) : 0;
}

export function sortDueReviewRows<T extends SortableDueReviewRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const dueDelta = (left.next_review_at ? Date.parse(left.next_review_at) : 0)
      - (right.next_review_at ? Date.parse(right.next_review_at) : 0);
    if (dueDelta !== 0) return dueDelta;

    const leftPriority = STATE_PRIORITY[left.memory_state as keyof typeof STATE_PRIORITY] ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = STATE_PRIORITY[right.memory_state as keyof typeof STATE_PRIORITY] ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    return (left.last_assessed_at ? Date.parse(left.last_assessed_at) : 0)
      - (right.last_assessed_at ? Date.parse(right.last_assessed_at) : 0);
  });
}
