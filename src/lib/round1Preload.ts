import type { PronunciationLocale, Word } from '../types';
import { extractRound1PreloadTargets } from './round1ClickableWords';
import { preloadClickableWordLookups, preloadClickableWordResources } from './wordResourcePreload';

export async function preloadRound1CardResources(word: Word, locale: PronunciationLocale) {
  const { highValueWords, lowValueWords } = extractRound1PreloadTargets(word);

  await Promise.allSettled([
    preloadClickableWordResources(highValueWords, locale),
    preloadClickableWordLookups(lowValueWords, locale),
  ]);
}
