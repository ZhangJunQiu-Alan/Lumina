export type MemoryState = 'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered';
export type ReviewAttemptSource = 'round2' | 'round3' | 'review';
export type ReviewEventSource = ReviewAttemptSource | 'manual_mastered';
export type ReviewResultType = 'wrong' | 'slow_correct' | 'fast_correct';
export const FIRST_MEMORY_STATE: MemoryState = 'fuzzy';

export interface SortableDueReviewRow {
  memory_state: MemoryState;
  next_review_at: string | null;
  last_assessed_at: string | null;
}

export interface ReviewScheduleRow extends SortableDueReviewRow {
  vocabulary_item_id: string;
}

export interface FutureReviewScheduleRow {
  next_review_at: string | null;
}

export interface ReviewBacklogRescheduleUpdate {
  vocabularyItemId: string;
  nextReviewAt: string;
}

export interface ReviewBacklogRedistributionPlan<T extends ReviewScheduleRow> {
  activeRows: T[];
  rescheduledRows: T[];
  updates: ReviewBacklogRescheduleUpdate[];
}

export const FAST_RECALL_MS = 6000;
export const MAX_DAILY_REVIEW_WORDS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

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
  if (result === 'wrong') return 'fuzzy';
  if (result === 'slow_correct' && previousState !== 'fuzzy') return 'slow_recall';
  if (previousState !== 'new') return previousState;
  return result === 'slow_correct' ? 'slow_recall' : 'stable_recall';
}

export function resolveReviewState(
  previousState: MemoryState,
  result: ReviewResultType,
  totalSuccesses: number,
): MemoryState {
  if (result === 'wrong') return 'fuzzy';
  if (result === 'slow_correct') return 'slow_recall';
  if (previousState === 'mastered') return 'mastered';

  switch (previousState) {
    case 'new':
      return 'stable_recall';
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

export function resolveReviewTimeZone(timeZone: string | null | undefined, fallback = 'UTC') {
  if (!timeZone) return fallback;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return fallback;
  }
}

export function toReviewDateKey(date: Date, timeZone: string) {
  const key = `en-CA:${timeZone}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(key, formatter);
  }

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function normalizeElapsedMs(elapsedMs: number): number {
  return Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.round(elapsedMs) : 0;
}

export function sortDueReviewRows<T extends SortableDueReviewRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const dueDelta =
      (left.next_review_at ? Date.parse(left.next_review_at) : 0) -
      (right.next_review_at ? Date.parse(right.next_review_at) : 0);
    if (dueDelta !== 0) return dueDelta;

    const leftPriority = STATE_PRIORITY[left.memory_state as keyof typeof STATE_PRIORITY] ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = STATE_PRIORITY[right.memory_state as keyof typeof STATE_PRIORITY] ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    return (
      (left.last_assessed_at ? Date.parse(left.last_assessed_at) : 0) -
      (right.last_assessed_at ? Date.parse(right.last_assessed_at) : 0)
    );
  });
}

function normalizeDailyReviewLimit(limit: number | null | undefined) {
  if (!Number.isFinite(limit) || !limit || limit <= 0) {
    return MAX_DAILY_REVIEW_WORDS;
  }

  return Math.max(1, Math.floor(limit));
}

function incrementDateCount(counts: Map<string, number>, dateKey: string) {
  counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
}

export function planReviewBacklogRedistribution<T extends ReviewScheduleRow>(
  dueRows: T[],
  futureRows: FutureReviewScheduleRow[] = [],
  options: {
    now?: Date;
    timeZone?: string | null;
    dailyLimit?: number;
  } = {},
): ReviewBacklogRedistributionPlan<T> {
  const dailyLimit = normalizeDailyReviewLimit(options.dailyLimit);
  const sortedDueRows = sortDueReviewRows(dueRows);

  if (sortedDueRows.length <= dailyLimit) {
    return {
      activeRows: sortedDueRows,
      rescheduledRows: [],
      updates: [],
    };
  }

  const now = options.now ?? new Date();
  const nowTime = now.getTime();
  const timeZone = resolveReviewTimeZone(options.timeZone);
  const futureCounts = new Map<string, number>();

  for (const row of futureRows) {
    if (!row.next_review_at) continue;

    const scheduledAt = new Date(row.next_review_at);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= nowTime) {
      continue;
    }

    incrementDateCount(futureCounts, toReviewDateKey(scheduledAt, timeZone));
  }

  const activeRows = sortedDueRows.slice(0, dailyLimit);
  const rescheduledRows = sortedDueRows.slice(dailyLimit);
  const updates: ReviewBacklogRescheduleUpdate[] = [];
  let dayOffset = 1;

  for (const row of rescheduledRows) {
    while (true) {
      const scheduledAt = new Date(nowTime + dayOffset * DAY_MS);
      const dateKey = toReviewDateKey(scheduledAt, timeZone);
      const scheduledCount = futureCounts.get(dateKey) ?? 0;

      if (scheduledCount < dailyLimit) {
        futureCounts.set(dateKey, scheduledCount + 1);
        updates.push({
          vocabularyItemId: row.vocabulary_item_id,
          nextReviewAt: scheduledAt.toISOString(),
        });
        break;
      }

      dayOffset += 1;
    }
  }

  return {
    activeRows,
    rescheduledRows,
    updates,
  };
}
