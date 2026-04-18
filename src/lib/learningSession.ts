import type { LearningRoundType, PersistedLearningSession, ResumeCandidate, Word } from '../types';

const LEARNING_ROUNDS: LearningRoundType[] = ['round1', 'round2', 'round3', 'article'];

export const LEARNING_ROUND_LABELS: Record<LearningRoundType, string> = {
  round1: '第一轮',
  round2: '第二轮',
  round3: '第三轮',
  article: '文章巩固',
};

export function isLearningRoundType(value: unknown): value is LearningRoundType {
  return typeof value === 'string' && LEARNING_ROUNDS.includes(value as LearningRoundType);
}

export function normalizeSessionQueueWordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
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

export function normalizePersistedLearningSession(
  session: PersistedLearningSession,
  words: Word[],
): PersistedLearningSession {
  const hydratedQueue = rebuildSessionQueue(words, session.queueWordIds);
  const effectiveQueue = hydratedQueue.length > 0 ? hydratedQueue : words;

  return {
    ...session,
    currentIndex: clampSessionIndex(session.currentIndex, effectiveQueue.length),
    queueWordIds: effectiveQueue.map((word) => word.id),
  };
}

export function createInitialLearningSession(
  groupId: string,
  words: Word[],
  round: LearningRoundType = 'round1',
): PersistedLearningSession {
  return {
    groupId,
    round,
    currentIndex: 0,
    queueWordIds: words.map((word) => word.id),
    lastActiveAt: new Date().toISOString(),
  };
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
