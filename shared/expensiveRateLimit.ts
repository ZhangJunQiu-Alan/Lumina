/**
 * Runtime-neutral rate limiter for expensive API groups (AI vocab, AI article,
 * TTS). Shared verbatim by the Express server and the Supabase Edge Function so
 * the limit policy, window math and weight accounting can no longer drift.
 *
 * Limitation: state is in-memory and therefore per-instance. On multi-isolate
 * hosts (Supabase Edge / Deno Deploy) the effective global limit is
 * `limit x isolate count` and resets on cold start. This is best-effort cost
 * protection, not a distributed hard guarantee — back it with a shared store
 * (Postgres / Redis) if a hard cap is required.
 */
import { parsePositiveIntEnv } from './runtime.ts';

export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

export type ExpensiveApiGroup = 'ai_vocab' | 'ai_article' | 'tts';
export type RateWindowName = 'minute' | 'hour' | 'day';

export const RATE_WINDOWS: Record<RateWindowName, number> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

export const DEFAULT_RATE_LIMITS: Record<ExpensiveApiGroup, Record<RateWindowName, number>> = {
  ai_vocab: { minute: 20, hour: 200, day: 1000 },
  ai_article: { minute: 3, hour: 20, day: 80 },
  tts: { minute: 60, hour: 500, day: 2000 },
};

export const IP_RATE_LIMIT_MULTIPLIER = 3;

export interface RateLimitAllowed {
  allowed: true;
  weight: number;
}

export interface RateLimitExceeded {
  allowed: false;
  retryAfterSeconds: number;
  scope: string;
  window: RateWindowName;
  limit: number;
  weight: number;
}

export type RateLimitResult = RateLimitAllowed | RateLimitExceeded;

/** Type guard so callers can narrow without relying on boolean-discriminant inference. */
export function isRateLimitExceeded(result: RateLimitResult): result is RateLimitExceeded {
  return !result.allowed;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();
let rateLimitRequestCount = 0;

function rateLimitFor(group: ExpensiveApiGroup, windowName: RateWindowName) {
  const envName = `LUMINA_RATE_LIMIT_${group.toUpperCase()}_${windowName.toUpperCase()}`;
  return parsePositiveIntEnv(envName, DEFAULT_RATE_LIMITS[group][windowName]);
}

function normalizeRateLimitWeight(value: number) {
  return Math.max(1, Math.ceil(Number.isFinite(value) ? value : 1));
}

function compactRateLimitBuckets(now: number) {
  rateLimitRequestCount += 1;
  if (rateLimitRequestCount % 100 !== 0) return;

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (now >= bucket.resetAt) {
      rateLimitBuckets.delete(key);
    }
  }
}

function readRateLimitBucket(key: string, now: number, windowMs: number): RateLimitBucket {
  const existing = rateLimitBuckets.get(key);
  if (!existing || now >= existing.resetAt) {
    return { count: 0, resetAt: now + windowMs };
  }

  return existing;
}

/** Count non-empty string entries in an array; falls back to 1 for non-arrays. */
export function countStringArray(value: unknown): number {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).length : 1;
}

/**
 * Atomically check and consume quota for a user+IP across all windows.
 * Returns `{ allowed: true }` and records usage, or `{ allowed: false }` with
 * retry metadata and records nothing.
 */
export function consumeExpensiveRateLimit({
  group,
  userId,
  ip,
  weight,
}: {
  group: ExpensiveApiGroup;
  userId: string;
  ip: string;
  weight: number;
}): RateLimitResult {
  const now = Date.now();
  const normalizedWeight = normalizeRateLimitWeight(weight);
  compactRateLimitBuckets(now);

  const checks = [
    { scope: 'user', key: userId, multiplier: 1 },
    { scope: 'ip', key: ip, multiplier: IP_RATE_LIMIT_MULTIPLIER },
  ].flatMap((subject) =>
    (Object.keys(RATE_WINDOWS) as RateWindowName[]).map((windowName) => {
      const windowMs = RATE_WINDOWS[windowName];
      const limit = rateLimitFor(group, windowName) * subject.multiplier;
      const bucketKey = `${subject.scope}:${group}:${windowName}:${subject.key}`;
      const bucket = readRateLimitBucket(bucketKey, now, windowMs);
      return {
        ...subject,
        windowName,
        windowMs,
        limit,
        bucketKey,
        bucket,
      };
    }),
  );

  const exceeded = checks.find((check) => check.bucket.count + normalizedWeight > check.limit);
  if (exceeded) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((exceeded.bucket.resetAt - now) / 1000)),
      scope: exceeded.scope,
      window: exceeded.windowName,
      limit: exceeded.limit,
      weight: normalizedWeight,
    };
  }

  for (const check of checks) {
    rateLimitBuckets.set(check.bucketKey, {
      count: check.bucket.count + normalizedWeight,
      resetAt: check.bucket.resetAt,
    });
  }

  return { allowed: true, weight: normalizedWeight };
}

/** Test-only: reset all in-memory buckets so suites don't bleed into each other. */
export function __resetExpensiveRateLimitForTests() {
  rateLimitBuckets.clear();
  rateLimitRequestCount = 0;
}
