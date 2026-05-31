import type { OfficialStudyMode } from './types.ts';

export type ReorderableOfficialRound = 'round1' | 'round2' | 'round3';

export interface ReorderOfficialSessionQueueInput {
  round: string | null | undefined;
  currentIndex: number | null | undefined;
  queueWordIds: unknown;
  fallbackWordIds: string[];
  round1ConfirmedWordIds?: unknown;
  passedQueueIndices?: unknown;
  targetMode: OfficialStudyMode;
  officialPositions?: Map<string, number>;
  random?: () => number;
}

export interface ReorderOfficialSessionQueueResult {
  queueWordIds: string[];
  currentIndex: number;
  passedQueueIndices: number[];
  frozenWordIds: string[];
  reorderedWordIds: string[];
  changed: boolean;
}

export function isReorderableOfficialRound(value: unknown): value is ReorderableOfficialRound {
  return value === 'round1' || value === 'round2' || value === 'round3';
}

function normalizeWordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function normalizeQueueWordIds(queueWordIds: unknown, fallbackWordIds: string[]) {
  const normalizedQueue = normalizeWordIds(queueWordIds);
  return normalizedQueue.length > 0 ? normalizedQueue : fallbackWordIds.filter(Boolean);
}

function clampBoundary(currentIndex: number | null | undefined, queueLength: number) {
  if (queueLength <= 0 || !Number.isFinite(currentIndex)) return 0;
  return Math.min(Math.max(Math.round(currentIndex ?? 0), 0), queueLength);
}

function normalizePassedQueueIndices(value: unknown, boundary: number) {
  if (!Array.isArray(value) || boundary <= 0) return [];

  const indices = new Set<number>();
  for (const entry of value) {
    if (!Number.isInteger(entry) || entry < 0 || entry >= boundary) continue;
    indices.add(entry);
  }

  return [...indices].sort((left, right) => left - right);
}

function resolveFrozenBoundary(input: {
  round: ReorderableOfficialRound;
  currentIndex: number | null | undefined;
  queueWordIds: string[];
  round1ConfirmedWordIds?: unknown;
}) {
  const currentBoundary = clampBoundary(input.currentIndex, input.queueWordIds.length);
  if (input.round !== 'round1') {
    return currentBoundary;
  }

  const confirmedIds = new Set(normalizeWordIds(input.round1ConfirmedWordIds));
  if (confirmedIds.size === 0) {
    return currentBoundary;
  }

  let lastConfirmedIndex = -1;
  input.queueWordIds.forEach((wordId, index) => {
    if (confirmedIds.has(wordId)) {
      lastConfirmedIndex = Math.max(lastConfirmedIndex, index);
    }
  });

  return Math.max(currentBoundary, lastConfirmedIndex + 1);
}

function shuffleWordIds(wordIds: string[], random: () => number) {
  const shuffled = [...wordIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function reorderWordIds(
  wordIds: string[],
  targetMode: OfficialStudyMode,
  officialPositions: Map<string, number> | undefined,
  random: () => number,
) {
  if (targetMode === 'shuffle') {
    return shuffleWordIds(wordIds, random);
  }

  return wordIds
    .map((wordId, index) => ({
      wordId,
      index,
      position: officialPositions?.get(wordId) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.wordId);
}

export function reorderOfficialSessionQueue({
  round,
  currentIndex,
  queueWordIds,
  fallbackWordIds,
  round1ConfirmedWordIds,
  passedQueueIndices,
  targetMode,
  officialPositions,
  random = Math.random,
}: ReorderOfficialSessionQueueInput): ReorderOfficialSessionQueueResult {
  if (!isReorderableOfficialRound(round)) {
    throw new Error('This official learning round cannot be reordered.');
  }

  const normalizedQueue = normalizeQueueWordIds(queueWordIds, fallbackWordIds);
  const boundary = resolveFrozenBoundary({
    round,
    currentIndex,
    queueWordIds: normalizedQueue,
    round1ConfirmedWordIds,
  });
  const frozenWordIds = normalizedQueue.slice(0, boundary);
  const remainingWordIds = normalizedQueue.slice(boundary);
  const reorderedWordIds = reorderWordIds(remainingWordIds, targetMode, officialPositions, random);
  const nextQueueWordIds = [...frozenWordIds, ...reorderedWordIds];
  const nextCurrentIndex = Math.min(frozenWordIds.length, Math.max(nextQueueWordIds.length - 1, 0));
  const normalizedPassedQueueIndices =
    round === 'round1'
      ? Array.from({ length: nextCurrentIndex }, (_, index) => index)
      : normalizePassedQueueIndices(passedQueueIndices, nextCurrentIndex);

  return {
    queueWordIds: nextQueueWordIds,
    currentIndex: nextCurrentIndex,
    passedQueueIndices: normalizedPassedQueueIndices,
    frozenWordIds,
    reorderedWordIds,
    changed: normalizedQueue.some((wordId, index) => wordId !== nextQueueWordIds[index]),
  };
}
