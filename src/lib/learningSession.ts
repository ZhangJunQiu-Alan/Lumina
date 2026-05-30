import type { LearningRoundType, PersistedLearningSession, ResumeCandidate, Word } from '../types';

const LEARNING_ROUNDS: LearningRoundType[] = ['round1', 'round2', 'round3', 'article'];
const CORE_LEARNING_ROUNDS: LearningRoundType[] = ['round1', 'round2'];
const REINFORCEMENT_ROUNDS: LearningRoundType[] = ['round3', 'article'];

export const LEARNING_ROUND_LABELS: Record<LearningRoundType, string> = {
  round1: '第一轮',
  round2: '第二轮',
  round3: '第三轮',
  article: '文章巩固',
};

export function isLearningRoundType(value: unknown): value is LearningRoundType {
  return typeof value === 'string' && LEARNING_ROUNDS.includes(value as LearningRoundType);
}

export function isCoreLearningRound(value: unknown): value is Extract<LearningRoundType, 'round1' | 'round2'> {
  return typeof value === 'string' && CORE_LEARNING_ROUNDS.includes(value as Extract<LearningRoundType, 'round1' | 'round2'>);
}

export function isReinforcementRound(value: unknown): value is Extract<LearningRoundType, 'round3' | 'article'> {
  return typeof value === 'string' && REINFORCEMENT_ROUNDS.includes(value as Extract<LearningRoundType, 'round3' | 'article'>);
}

export function isCoreLearningComplete(input: {
  status?: 'active' | 'completed' | null;
  completedAt?: string | null;
  round?: LearningRoundType | null;
  sessionRound?: LearningRoundType | null;
  groupCompleted?: boolean;
}) {
  const round = input.round ?? input.sessionRound ?? null;

  return (
    input.groupCompleted === true
    || input.status === 'completed'
    || Boolean(input.completedAt)
    || isReinforcementRound(round)
  );
}

export function normalizeSessionQueueWordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

export function normalizeSessionPassedQueueIndices(value: unknown, queueLength: number, currentIndex?: number): number[] {
  if (!Array.isArray(value) || queueLength <= 0) return [];

  const upperBound = typeof currentIndex === 'number'
    ? Math.min(Math.max(Math.round(currentIndex), 0), queueLength)
    : queueLength;
  const indices = new Set<number>();

  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) continue;
    if (entry < 0 || entry >= upperBound) continue;
    indices.add(entry);
  }

  return [...indices].sort((left, right) => left - right);
}

export function normalizeSessionRound1ConfirmedWordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

export function clampSessionIndex(currentIndex: number, queueLength: number) {
  if (queueLength <= 0) return 0;
  if (!Number.isFinite(currentIndex)) return 0;
  return Math.min(Math.max(Math.round(currentIndex), 0), queueLength - 1);
}

export function rebuildSessionQueue(words: Word[], queueWordIds: string[]) {
  const wordMap = new Map(words.map((word) => [word.id, word]));
  return queueWordIds
    .map((wordId) => wordMap.get(wordId))
    .filter((word): word is Word => Boolean(word));
}

export function filterMasteredSessionWords(words: Word[], masteredWordIds: Iterable<string>) {
  const masteredIds = new Set(masteredWordIds);
  if (masteredIds.size === 0) return words;
  return words.filter((word) => !masteredIds.has(word.id));
}

export function normalizePersistedLearningSession(
  session: PersistedLearningSession,
  words: Word[],
): PersistedLearningSession {
  const hydratedQueue = rebuildSessionQueue(words, session.queueWordIds);
  const effectiveQueue = hydratedQueue.length > 0 ? hydratedQueue : words;
  const currentIndex = clampSessionIndex(session.currentIndex, effectiveQueue.length);

  return {
    ...session,
    currentIndex,
    queueWordIds: effectiveQueue.map((word) => word.id),
    passedQueueIndices: normalizeSessionPassedQueueIndices(
      session.passedQueueIndices,
      effectiveQueue.length,
      currentIndex,
    ),
    round1ConfirmedWordIds: normalizeSessionRound1ConfirmedWordIds(session.round1ConfirmedWordIds)
      .filter((wordId) => words.some((word) => word.id === wordId)),
  };
}

export function createInitialLearningSession(
  groupId: string,
  words: Word[],
  round: LearningRoundType = 'round1',
  options: {
    groupCompleted?: boolean;
    completedAt?: string | null;
  } = {},
): PersistedLearningSession {
  return {
    groupId,
    round,
    currentIndex: 0,
    queueWordIds: words.map((word) => word.id),
    passedQueueIndices: [],
    round1ConfirmedWordIds: [],
    lastActiveAt: new Date().toISOString(),
    groupCompleted: options.groupCompleted ?? false,
    completedAt: options.completedAt ?? null,
  };
}

function latestIso(left: string | null | undefined, right: string | null | undefined) {
  if (!left) return right ?? null;
  if (!right) return left;

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}

export function reconcileSessionWithRound2History(
  session: PersistedLearningSession,
  words: Word[],
  input: {
    correctWordIds: string[];
    lastAttemptAt?: string | null;
  },
): PersistedLearningSession {
  if (
    session.groupCompleted
    || isReinforcementRound(session.round)
    || input.correctWordIds.length === 0
    || words.length === 0
  ) {
    return normalizePersistedLearningSession(session, words);
  }

  const correctWordIds = new Set(input.correctWordIds);
  const wordIds = words.map((word) => word.id);
  const hasRelevantAttempt = wordIds.some((wordId) => correctWordIds.has(wordId));
  if (!hasRelevantAttempt) {
    return normalizePersistedLearningSession(session, words);
  }

  const firstPendingIndex = wordIds.findIndex((wordId) => !correctWordIds.has(wordId));
  const lastActiveAt = latestIso(session.lastActiveAt, input.lastAttemptAt) ?? session.lastActiveAt;

  if (firstPendingIndex === -1) {
    return normalizePersistedLearningSession({
      ...session,
      round: 'round3',
      currentIndex: 0,
      queueWordIds: wordIds,
      passedQueueIndices: [],
      lastActiveAt,
      groupCompleted: true,
      completedAt: session.completedAt ?? input.lastAttemptAt ?? lastActiveAt,
    }, words);
  }

  return normalizePersistedLearningSession({
    ...session,
    round: 'round2',
    currentIndex: firstPendingIndex,
    queueWordIds: wordIds,
    passedQueueIndices: wordIds
      .slice(0, firstPendingIndex)
      .map((_, index) => index),
    lastActiveAt,
  }, words);
}

export function createResumeCandidate(
  input: Omit<ResumeCandidate, 'queueLength'>,
): ResumeCandidate {
  const queueLength = input.queueWordIds.length;

  return {
    ...input,
    currentIndex: clampSessionIndex(input.currentIndex, queueLength),
    queueLength,
  };
}
