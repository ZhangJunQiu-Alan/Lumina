import { apiFetch } from './api';
import type { PronunciationLocale } from '../types';
import { normalizeExampleAudioText } from './exampleAudioText';

type CacheKey = string;

const urlCache = new Map<CacheKey, string>();
const failureCache = new Map<CacheKey, number>();
const inflight = new Map<CacheKey, Promise<string | null>>();

const FAILURE_TTL_MS = 5 * 60 * 1000;

export { normalizeExampleAudioText };

function buildKey(text: string, locale: PronunciationLocale): CacheKey {
  return `${locale}::${normalizeExampleAudioText(text).toLowerCase()}`;
}

export function fetchExampleAudioUrl(text: string, locale: PronunciationLocale): Promise<string | null> {
  const normalizedText = normalizeExampleAudioText(text);
  if (!normalizedText) return Promise.resolve(null);

  const key = buildKey(normalizedText, locale);
  const cached = urlCache.get(key);
  if (cached) return Promise.resolve(cached);

  const failedAt = failureCache.get(key);
  if (failedAt && Date.now() - failedAt < FAILURE_TTL_MS) {
    return Promise.resolve(null);
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const request = apiFetch('/api/example-audio', {
    method: 'POST',
    requiresAuth: false,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: normalizedText, locale }),
  })
    .then(async (response) => {
      if (!response.ok) {
        failureCache.set(key, Date.now());
        return null;
      }

      const payload = await response.json().catch(() => null) as { data?: unknown } | null;
      const url = typeof payload?.data === 'string' ? payload.data : null;
      if (url) {
        urlCache.set(key, url);
        failureCache.delete(key);
      } else {
        failureCache.set(key, Date.now());
      }
      return url;
    })
    .catch((error) => {
      console.error('example audio fetch failed:', error);
      failureCache.set(key, Date.now());
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}
