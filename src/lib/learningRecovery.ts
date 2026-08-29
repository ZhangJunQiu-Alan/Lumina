import type { PersistedLearningSession, Word } from '../types';
import { readLocal, writeLocal } from './durableStorage';

export interface LearningRecovery {
  groupTitle: string;
  words: Word[];
  session: PersistedLearningSession | null;
}
export interface ReviewRecovery {
  runId?: string;
  words: Word[];
  currentIndex: number;
  passedQueueIndices: number[];
}
const key = (userId: string, groupId: string) => `lumina.learning-cache.v1.${userId}.${groupId}`;

export function readLearningRecovery(userId: string, groupId: string) {
  const value = readLocal<LearningRecovery>(key(userId, groupId));
  return Array.isArray(value?.words) ? value : null;
}

export function cacheLearningRecovery(userId: string, groupId: string, value: LearningRecovery) {
  writeLocal(key(userId, groupId), value);
}

export function cacheLearningProgress(userId: string, session: PersistedLearningSession) {
  const cached = readLearningRecovery(userId, session.groupId);
  if (cached) cacheLearningRecovery(userId, session.groupId, { ...cached, session });
  writeLocal(`lumina.last-learning.v1.${userId}`, session.groupCompleted ? null : session.groupId);
  writeLocal(`lumina.last-session-mode.v1.${userId}`, 'learning');
}
