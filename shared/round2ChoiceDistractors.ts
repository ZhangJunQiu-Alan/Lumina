import type { Round2ChoiceDistractor } from './types.ts';
import { normalizeWordKey } from './wordBatch.ts';

export interface Round2ChoiceDistractorValidationResult {
  valid: boolean;
  errors: string[];
  distractors: Round2ChoiceDistractor[];
}

function toDisplayText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toDistractor(value: unknown): Round2ChoiceDistractor | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const word = toDisplayText(record.word);
  const pos = toDisplayText(record.pos);
  const meaningZh = toDisplayText(record.meaning_zh);
  const relation = toDisplayText(record.relation);

  if (!word || !pos || !meaningZh) return null;

  return {
    word,
    pos,
    meaning_zh: meaningZh,
    ...(relation ? { relation } : {}),
  };
}

export function normalizeRound2ChoiceDistractors(value: unknown): Round2ChoiceDistractor[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toDistractor)
    .filter((item): item is Round2ChoiceDistractor => Boolean(item))
    .slice(0, 3);
}

export function validateRound2ChoiceDistractors(
  targetWord: string,
  value: unknown,
): Round2ChoiceDistractorValidationResult {
  const errors: string[] = [];
  const distractors = normalizeRound2ChoiceDistractors(value);
  const normalizedTarget = normalizeWordKey(targetWord);

  if (distractors.length !== 3) {
    errors.push(`expected exactly 3 distractors, got ${distractors.length}`);
  }

  const seenWords = new Set<string>();
  const seenMeanings = new Set<string>();

  distractors.forEach((item, index) => {
    const normalizedWord = normalizeWordKey(item.word);
    const normalizedMeaning = item.meaning_zh.replace(/\s+/g, '').toLowerCase();

    if (!normalizedWord) {
      errors.push(`distractor ${index + 1} word is empty`);
    }
    if (!item.pos.trim()) {
      errors.push(`distractor ${index + 1} pos is empty`);
    }
    if (!item.meaning_zh.trim()) {
      errors.push(`distractor ${index + 1} meaning_zh is empty`);
    }
    if (normalizedWord && normalizedWord === normalizedTarget) {
      errors.push(`distractor ${index + 1} matches target word`);
    }
    if (normalizedWord && seenWords.has(normalizedWord)) {
      errors.push(`duplicate distractor word: ${item.word}`);
    }
    if (normalizedMeaning && seenMeanings.has(normalizedMeaning)) {
      errors.push(`duplicate distractor meaning: ${item.meaning_zh}`);
    }

    seenWords.add(normalizedWord);
    seenMeanings.add(normalizedMeaning);
  });

  return {
    valid: errors.length === 0,
    errors,
    distractors,
  };
}

export function hasCompleteRound2ChoiceDistractors(value: unknown) {
  return normalizeRound2ChoiceDistractors(value).length === 3;
}
