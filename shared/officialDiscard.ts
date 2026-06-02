import { limitRound1ReinforcementWordIds } from './learningProgress.ts';

export type OfficialDiscardableRound = 'round1' | 'round2' | 'round3';

export interface ResolveActuallyLearnedWordIdsInput {
  round: string | null | undefined;
  currentIndex: number | null | undefined;
  queueWordIds: unknown;
  fallbackWordIds: string[];
  round1ConfirmedWordIds?: unknown;
  round2AttemptWordIds?: string[];
}

export function isOfficialDiscardableRound(value: unknown): value is OfficialDiscardableRound {
  return value === 'round1' || value === 'round2' || value === 'round3';
}

function normalizeWordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function clampCompletedPrefixLength(currentIndex: number | null | undefined, queueLength: number) {
  if (queueLength <= 0 || !Number.isFinite(currentIndex)) return 0;
  return Math.min(Math.max(Math.round(currentIndex ?? 0), 0), queueLength);
}

export function resolveActuallyLearnedWordIds(input: ResolveActuallyLearnedWordIdsInput): string[] {
  if (!isOfficialDiscardableRound(input.round)) {
    return [];
  }

  const normalizedQueue = normalizeWordIds(input.queueWordIds);
  const fallbackWordIds = input.fallbackWordIds.filter(Boolean);
  const queueWordIds = normalizedQueue.length > 0 ? normalizedQueue : fallbackWordIds;
  const completedPrefixLength = clampCompletedPrefixLength(input.currentIndex, queueWordIds.length);
  const round1ConfirmedWordIds = limitRound1ReinforcementWordIds(normalizeWordIds(input.round1ConfirmedWordIds));
  const learnedIds = new Set<string>();

  if (input.round === 'round1' && round1ConfirmedWordIds.length > 0) {
    for (const wordId of round1ConfirmedWordIds) {
      learnedIds.add(wordId);
    }
  } else {
    for (const wordId of queueWordIds.slice(0, completedPrefixLength)) {
      learnedIds.add(wordId);
    }
  }

  if (input.round === 'round2' || input.round === 'round3') {
    for (const wordId of fallbackWordIds) {
      learnedIds.add(wordId);
    }
  }

  for (const wordId of input.round2AttemptWordIds ?? []) {
    if (wordId) learnedIds.add(wordId);
  }

  const stableOrder = [
    ...fallbackWordIds,
    ...queueWordIds,
    ...round1ConfirmedWordIds,
    ...(input.round2AttemptWordIds ?? []),
  ];
  const emitted = new Set<string>();
  const result: string[] = [];

  for (const wordId of stableOrder) {
    if (!learnedIds.has(wordId) || emitted.has(wordId)) continue;
    emitted.add(wordId);
    result.push(wordId);
  }

  return result;
}
