import type { PronunciationLocale, Word } from '../types';
import { extractRound1ClickableWords } from './round1ClickableWords';
import { preloadClickableWordResources } from './wordResourcePreload';

export async function preloadRound1CardResources(word: Word, locale: PronunciationLocale) {
  const clickableWords = extractRound1ClickableWords(word);
  await preloadClickableWordResources(clickableWords, locale);
}
