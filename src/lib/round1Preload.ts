import type { PronunciationLocale, Word } from '../types';
import { extractRound1ClickableWords } from './round1ClickableWords';
import { fetchWordAudioUrl, primeWordAudioUrl } from './wordAudio';
import { lookupWord } from './wordLookup';

function getLookupAudioUrl(
  result: Awaited<ReturnType<typeof lookupWord>>,
  locale: PronunciationLocale,
) {
  if (!result) return null;
  return locale === 'uk'
    ? result.vocabulary_item.audio_uk_url
    : result.vocabulary_item.audio_us_url;
}

async function preloadRound1ClickableWord(word: string, locale: PronunciationLocale) {
  const lookupRequest = lookupWord(word);
  const directAudioRequest = fetchWordAudioUrl(word, locale);

  const lookupResult = await lookupRequest;
  const lookupAudioUrl = getLookupAudioUrl(lookupResult, locale);
  const canonicalWord = lookupResult?.vocabulary_item.word.trim();

  if (canonicalWord && lookupAudioUrl) {
    primeWordAudioUrl(canonicalWord, locale, lookupAudioUrl);
  } else if (canonicalWord && canonicalWord.toLowerCase() !== word.trim().toLowerCase()) {
    await fetchWordAudioUrl(canonicalWord, locale);
  }

  await directAudioRequest;
}

export async function preloadRound1CardResources(word: Word, locale: PronunciationLocale) {
  const clickableWords = extractRound1ClickableWords(word);
  if (clickableWords.length === 0) return;

  await Promise.allSettled(
    clickableWords.map((clickableWord) => preloadRound1ClickableWord(clickableWord, locale)),
  );
}
