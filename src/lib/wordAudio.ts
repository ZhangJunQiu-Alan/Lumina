import { apiFetch } from './api';
import type { PronunciationLocale } from '../types';

type CacheKey = string;

const urlCache = new Map<CacheKey, string>();
const failureCache = new Map<CacheKey, number>();
const inflight = new Map<CacheKey, Promise<string | null>>();

const FAILURE_TTL_MS = 5 * 60 * 1000;

function buildKey(word: string, locale: PronunciationLocale): CacheKey {
  return `${locale}::${word.trim().toLowerCase()}`;
}

export function getCachedWordAudioUrl(word: string, locale: PronunciationLocale): string | null {
  return urlCache.get(buildKey(word, locale)) ?? null;
}

export function primeWordAudioUrl(word: string, locale: PronunciationLocale, url: string | null) {
  if (!url) return;
  urlCache.set(buildKey(word, locale), url);
}

export function fetchWordAudioUrl(word: string, locale: PronunciationLocale): Promise<string | null> {
  const trimmed = word.trim();
  if (!trimmed) return Promise.resolve(null);

  const key = buildKey(trimmed, locale);
  const cached = urlCache.get(key);
  if (cached) return Promise.resolve(cached);

  const failedAt = failureCache.get(key);
  if (failedAt && Date.now() - failedAt < FAILURE_TTL_MS) {
    return Promise.resolve(null);
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const request = apiFetch(`/api/audio/${encodeURIComponent(trimmed)}?locale=${locale}`)
    .then(async (response) => {
      if (!response.ok) {
        failureCache.set(key, Date.now());
        return null;
      }
      const payload = (await response.json().catch(() => null)) as { data?: string } | null;
      const url = payload?.data ?? null;
      if (url) {
        urlCache.set(key, url);
        failureCache.delete(key);
      } else {
        failureCache.set(key, Date.now());
      }
      return url;
    })
    .catch((error) => {
      console.error('word audio fetch failed:', error);
      failureCache.set(key, Date.now());
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}
