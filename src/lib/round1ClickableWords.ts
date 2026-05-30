import type { Word } from '../types';
import { tokenizeClickableText } from './clickableTextTokenizer';

const ROUND1_RELATION_VISIBLE_LIMIT = 2;
const ROUND1_EXAMPLE_VISIBLE_LIMIT = 2;

const trimDisplayText = (value: string | null | undefined) => value?.trim() ?? '';

const hasDisplayText = (value: string | null | undefined) => trimDisplayText(value).length > 0;

const getRound1WordItems = <T extends { word: string }>(items: readonly T[], limit?: number) => {
  const visibleItems = items.filter((item) => hasDisplayText(item.word));
  return typeof limit === 'number' ? visibleItems.slice(0, limit) : visibleItems;
};

const getRelationDetailText = (item: { meaningZh?: string; noteZh?: string }) =>
  [trimDisplayText(item.meaningZh), trimDisplayText(item.noteZh)].filter(Boolean).join(' · ');

function addClickableWordsFromText(words: Set<string>, text: string | null | undefined) {
  const displayText = trimDisplayText(text);
  if (!displayText) return;

  for (const token of tokenizeClickableText(displayText)) {
    if (token.kind === 'content' && token.normalized) {
      words.add(token.normalized);
    }
  }
}

export function extractRound1ClickableWords(word: Word): string[] {
  const words = new Set<string>();

  addClickableWordsFromText(words, word.word);
  addClickableWordsFromText(words, word.memory_tip);
  addClickableWordsFromText(words, word.morphology.summaryZh);

  for (const item of getRound1WordItems(word.derivedWords)) {
    addClickableWordsFromText(words, item.word);
    addClickableWordsFromText(words, getRelationDetailText(item));
  }

  for (const item of getRound1WordItems(word.synonyms, ROUND1_RELATION_VISIBLE_LIMIT)) {
    addClickableWordsFromText(words, item.word);
    addClickableWordsFromText(words, getRelationDetailText(item));
  }

  for (const item of getRound1WordItems(word.antonyms, ROUND1_RELATION_VISIBLE_LIMIT)) {
    addClickableWordsFromText(words, item.word);
    addClickableWordsFromText(words, getRelationDetailText(item));
  }

  for (const pair of getRound1WordItems(word.confusingPairs)) {
    addClickableWordsFromText(words, pair.word);
    addClickableWordsFromText(words, pair.difference);
  }

  for (const sense of word.senses
    .filter((item) => hasDisplayText(item.example_sentence))
    .slice(0, ROUND1_EXAMPLE_VISIBLE_LIMIT)) {
    addClickableWordsFromText(words, sense.example_sentence);
  }

  return [...words];
}
