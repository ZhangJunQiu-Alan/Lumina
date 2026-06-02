export const ROUND1_REINFORCEMENT_WORD_LIMIT = 30;

export function limitRound1ReinforcementWordIds(wordIds: string[]) {
  return wordIds.slice(0, ROUND1_REINFORCEMENT_WORD_LIMIT);
}
