import type { PronunciationLocale } from '../types';
import { extractIeltsReadingLookupWords } from './ieltsReadingLookupWords';
import { fetchWordAudioUrl, primeWordAudioUrl } from './wordAudio';
import { lookupWord } from './wordLookup';

export { extractIeltsReadingLookupWords } from './ieltsReadingLookupWords';

const IELTS_READING_LOOKUP_PRELOAD_CONCURRENCY = 4;

function getLookupAudioUrl(result: Awaited<ReturnType<typeof lookupWord>>, locale: PronunciationLocale) {
  if (!result) return null;
  return locale === 'uk' ? result.vocabulary_item.audio_uk_url : result.vocabulary_item.audio_us_url;
}

async function preloadIeltsReadingLookupWord(word: string, locale: PronunciationLocale) {
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

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        if (item === undefined) break;
        await worker(item);
      }
    }),
  );
}

export async function preloadIeltsReadingPassageLookupResources(passageBody: string, locale: PronunciationLocale) {
  const words = extractIeltsReadingLookupWords(passageBody);
  if (words.length === 0) return;

  await runWithConcurrency(words, IELTS_READING_LOOKUP_PRELOAD_CONCURRENCY, (word) =>
    preloadIeltsReadingLookupWord(word, locale),
  );
}
