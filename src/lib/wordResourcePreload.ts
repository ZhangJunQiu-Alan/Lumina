import type { PronunciationLocale, Word } from '../types';
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

export function preloadWordPronunciation(word: Word, locale: PronunciationLocale) {
  const cachedUrl = locale === 'uk' ? word.audio_uk_url : word.audio_us_url;
  if (cachedUrl) {
    primeWordAudioUrl(word.word, locale, cachedUrl);
    return Promise.resolve(cachedUrl);
  }

  return fetchWordAudioUrl(word.word, locale);
}

async function preloadClickableWordResource(word: string, locale: PronunciationLocale) {
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

export async function preloadClickableWordResources(words: string[], locale: PronunciationLocale) {
  if (words.length === 0) return;

  await Promise.allSettled(
    words.map((word) => preloadClickableWordResource(word, locale)),
  );
}
