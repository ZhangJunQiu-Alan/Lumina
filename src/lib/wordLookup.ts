import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { AI_CONTENT_FEATURES_ENABLED } from './aiFeatures';

export type MemoryState = 'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered';
export type EnrichmentLevel = 'lite' | 'full';

export interface WordLookupVocabularyItem {
  id: string;
  word: string;
  ipa_uk: string | null;
  ipa_us: string | null;
  primary_meaning_zh: string | null;
  ner_label: string | null;
  morphology_summary_zh: string | null;
  memory_tip: string | null;
  source_type: string | null;
  enrichment_level: EnrichmentLevel;
  created_at: string | null;
  audio_uk_url: string | null;
  audio_us_url: string | null;
}

export interface WordLookupSense {
  pos: string;
  meaning_zh: string;
}

export interface WordLookupResult {
  vocabulary_item: WordLookupVocabularyItem;
  senses: WordLookupSense[];
  in_user_library: boolean;
  srs_state: MemoryState | null;
}

interface CachedLookup {
  data: WordLookupResult | null;
  fetchedAt: number;
  failedUntil?: number;
}

type WordLookupListener = () => void;

const FAILURE_CACHE_MS = 30 * 60 * 1000;
const memoryCache = new Map<string, CachedLookup>();
const canonicalWordByLookupKey = new Map<string, string>();
const lookupKeysByCanonicalWord = new Map<string, Set<string>>();
const inflightRequests = new Map<string, Promise<WordLookupResult | null>>();
const listeners = new Set<WordLookupListener>();

function normalizeLookupKey(word: string) {
  return word.trim().toLowerCase();
}

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function rememberCanonicalLookup(lookupKey: string, canonicalWord: string) {
  const normalizedCanonicalWord = normalizeLookupKey(canonicalWord);
  if (!lookupKey || !normalizedCanonicalWord) return;

  const previousCanonicalWord = canonicalWordByLookupKey.get(lookupKey);
  if (previousCanonicalWord && previousCanonicalWord !== normalizedCanonicalWord) {
    lookupKeysByCanonicalWord.get(previousCanonicalWord)?.delete(lookupKey);
  }

  canonicalWordByLookupKey.set(lookupKey, normalizedCanonicalWord);
  const lookupKeys = lookupKeysByCanonicalWord.get(normalizedCanonicalWord) ?? new Set<string>();
  lookupKeys.add(lookupKey);
  lookupKeysByCanonicalWord.set(normalizedCanonicalWord, lookupKeys);
}

function forgetLookupKey(lookupKey: string) {
  memoryCache.delete(lookupKey);
  const canonicalWord = canonicalWordByLookupKey.get(lookupKey);
  if (!canonicalWord) return;

  canonicalWordByLookupKey.delete(lookupKey);
  const lookupKeys = lookupKeysByCanonicalWord.get(canonicalWord);
  lookupKeys?.delete(lookupKey);
  if (lookupKeys?.size === 0) {
    lookupKeysByCanonicalWord.delete(canonicalWord);
  }
}

export function subscribeWordLookup(listener: WordLookupListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function lookupWord(word: string): Promise<WordLookupResult | null> {
  if (!AI_CONTENT_FEATURES_ENABLED) return null;

  const key = normalizeLookupKey(word);
  if (!key) return null;

  const cached = memoryCache.get(key);
  if (cached?.failedUntil && Date.now() < cached.failedUntil) {
    return null;
  }

  if (cached?.data) {
    return cached.data;
  }

  const inflight = inflightRequests.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = apiFetch('/api/vocab/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word: key }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }

      const { data } = await response.json() as { data: WordLookupResult };
      memoryCache.set(key, { data, fetchedAt: Date.now() });
      rememberCanonicalLookup(key, data.vocabulary_item.word);
      return data;
    })
    .catch((error) => {
      console.error('word lookup failed:', error);
      memoryCache.set(key, {
        data: null,
        fetchedAt: Date.now(),
        failedUntil: Date.now() + FAILURE_CACHE_MS,
      });
      return null;
    })
    .finally(() => {
      inflightRequests.delete(key);
    });

  inflightRequests.set(key, promise);
  return promise;
}

export function invalidateWord(word: string) {
  const key = normalizeLookupKey(word);
  if (!key) return;

  const lookupKeys = lookupKeysByCanonicalWord.get(key);
  if (lookupKeys) {
    for (const lookupKey of [...lookupKeys]) {
      forgetLookupKey(lookupKey);
    }
  }

  forgetLookupKey(key);
  notifyListeners();
}

export function updateCachedLookup(
  vocabularyItemId: string,
  updater: (current: WordLookupResult) => WordLookupResult,
) {
  let changed = false;

  for (const [key, cached] of memoryCache.entries()) {
    if (cached.data?.vocabulary_item.id !== vocabularyItemId) continue;
    memoryCache.set(key, {
      ...cached,
      data: updater(cached.data),
      fetchedAt: Date.now(),
    });
    changed = true;
  }

  if (changed) {
    notifyListeners();
  }
}

export function clearWordLookupCache() {
  memoryCache.clear();
  canonicalWordByLookupKey.clear();
  lookupKeysByCanonicalWord.clear();
  inflightRequests.clear();
  notifyListeners();
}

export function useWordLookup(word: string | null) {
  const [data, setData] = useState<WordLookupResult | null | undefined>(undefined);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => subscribeWordLookup(() => {
    setRefreshTick((current) => current + 1);
  }), []);

  useEffect(() => {
    let cancelled = false;

    if (!word) {
      setData(undefined);
      return () => {
        cancelled = true;
      };
    }

    if (!AI_CONTENT_FEATURES_ENABLED) {
      setData(null);
      return () => {
        cancelled = true;
      };
    }

    const key = normalizeLookupKey(word);
    const cached = memoryCache.get(key);
    if (cached?.data) {
      setData(cached.data);
      return () => {
        cancelled = true;
      };
    }

    if (cached?.failedUntil && Date.now() < cached.failedUntil) {
      setData(null);
      return () => {
        cancelled = true;
      };
    }

    setData(undefined);
    lookupWord(word).then((result) => {
      if (!cancelled) {
        setData(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [word, refreshTick]);

  return {
    data,
    loading: data === undefined,
  };
}
