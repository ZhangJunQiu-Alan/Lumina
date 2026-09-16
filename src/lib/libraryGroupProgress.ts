import type { LearningRoundType } from '../types';
import { normalizeSessionQueueWordIds, normalizeSessionPassedQueueIndices } from './learningSession';

export function getLibraryGroupProgress(input: {
  round: LearningRoundType | null;
  wordCount: number;
  queue: unknown;
  passedIndices: unknown;
  confirmedIds: unknown;
}) {
  if (!input.round) return { completed: 0, total: input.wordCount };
  if (input.round === 'article') return null;

  const queue = normalizeSessionQueueWordIds(input.queue);
  const wordIds = new Set(queue);
  const total = wordIds.size || input.wordCount;
  if (queue.length === 0) return null;

  const completedIds =
    input.round === 'round1' && Array.isArray(input.confirmedIds)
      ? normalizeSessionQueueWordIds(input.confirmedIds).filter((id) => wordIds.has(id))
      : normalizeSessionPassedQueueIndices(input.passedIndices, queue.length).map((index) => queue[index]);

  return { completed: Math.min(new Set(completedIds).size, total), total };
}
