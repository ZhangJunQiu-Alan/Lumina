import type { LearningRoundType } from './types.ts';

const REINFORCEMENT_ROUNDS: LearningRoundType[] = ['article'];

export function isCoreLearningComplete(input: {
  status?: 'active' | 'completed' | null;
  completedAt?: string | null;
  round?: LearningRoundType | null;
  sessionRound?: LearningRoundType | null;
  groupCompleted?: boolean;
}) {
  const round = input.round ?? input.sessionRound ?? null;

  return (
    input.groupCompleted === true ||
    input.status === 'completed' ||
    Boolean(input.completedAt) ||
    (typeof round === 'string' && REINFORCEMENT_ROUNDS.includes(round as LearningRoundType))
  );
}
