import type { PronunciationLocale, Word } from '../types';
import { buildClozePrompt } from './cloze';
import { fetchExampleAudioUrl } from './exampleAudio';
import { normalizeExampleAudioText } from './exampleAudioText';
import { extractRound2ClickableWords } from './round2ClickableWords';
import { preloadClickableWordResources, preloadWordPronunciation } from './wordResourcePreload';

export async function preloadRound2CardResources(word: Word, locale: PronunciationLocale) {
  const prompt = buildClozePrompt({ word: word.word, senses: word.senses });
  const clickableWords = prompt ? extractRound2ClickableWords(prompt) : [];
  const fullSentence = prompt
    ? normalizeExampleAudioText(word.senses[prompt.senseIndex]?.example_sentence ?? '')
    : '';

  await Promise.allSettled([
    preloadWordPronunciation(word, locale),
    preloadClickableWordResources(clickableWords, locale),
    fetchExampleAudioUrl(fullSentence, locale),
  ]);
}
