import type { UserStats } from '../types';
import { toRoutineDateKey } from './routineDate';

const HOME_OVERVIEW_CACHE_VERSION = 1;
const HOME_OVERVIEW_CACHE_TTL_MS = 5 * 60 * 1000;

type HomeOverviewStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

interface HomeOverviewCacheEntry {
  version: number;
  userId: string;
  routineDate: string;
  timeZone: string;
  fetchedAt: number;
  stats: UserStats;
}

export interface CachedHomeOverview {
  cacheKey: string;
  fetchedAt: number;
  isFresh: boolean;
  routineDate: string;
  stats: UserStats;
}

interface HomeOverviewCacheOptions {
  now?: Date;
  storage?: HomeOverviewStorage | null;
}

function resolveStorage(storage?: HomeOverviewStorage | null) {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function resolveHomeOverviewCacheKey(userId: string, timeZone: string, now = new Date()) {
  const routineDate = toRoutineDateKey(now, timeZone);
  return {
    cacheKey: `lumina:home-overview:v${HOME_OVERVIEW_CACHE_VERSION}:${userId}:${routineDate}:${timeZone}`,
    routineDate,
  };
}

function isValidCacheEntry(value: unknown): value is HomeOverviewCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<HomeOverviewCacheEntry>;
  return (
    entry.version === HOME_OVERVIEW_CACHE_VERSION &&
    typeof entry.userId === 'string' &&
    typeof entry.routineDate === 'string' &&
    typeof entry.timeZone === 'string' &&
    typeof entry.fetchedAt === 'number' &&
    Boolean(entry.stats && typeof entry.stats === 'object')
  );
}

export function readCachedHomeOverview(
  userId: string,
  timeZone: string,
  options: HomeOverviewCacheOptions = {},
): CachedHomeOverview | null {
  const now = options.now ?? new Date();
  const storage = resolveStorage(options.storage);
  if (!storage) return null;

  const { cacheKey, routineDate } = resolveHomeOverviewCacheKey(userId, timeZone, now);
  const raw = storage.getItem(cacheKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidCacheEntry(parsed)) {
      storage.removeItem(cacheKey);
      return null;
    }

    if (parsed.userId !== userId || parsed.timeZone !== timeZone || parsed.routineDate !== routineDate) {
      storage.removeItem(cacheKey);
      return null;
    }

    const ageMs = now.getTime() - parsed.fetchedAt;
    return {
      cacheKey,
      fetchedAt: parsed.fetchedAt,
      isFresh: ageMs >= 0 && ageMs <= HOME_OVERVIEW_CACHE_TTL_MS,
      routineDate,
      stats: parsed.stats,
    };
  } catch {
    storage.removeItem(cacheKey);
    return null;
  }
}

export function writeCachedHomeOverview(
  userId: string,
  timeZone: string,
  stats: UserStats,
  options: HomeOverviewCacheOptions = {},
) {
  const now = options.now ?? new Date();
  const storage = resolveStorage(options.storage);
  if (!storage) return;

  const { cacheKey, routineDate } = resolveHomeOverviewCacheKey(userId, timeZone, now);
  const entry: HomeOverviewCacheEntry = {
    version: HOME_OVERVIEW_CACHE_VERSION,
    userId,
    routineDate,
    timeZone,
    fetchedAt: now.getTime(),
    stats,
  };

  try {
    storage.setItem(cacheKey, JSON.stringify(entry));
  } catch {
    // Cache writes are opportunistic; the live API remains the source of truth.
  }
}

export function invalidateCachedHomeOverview(userId: string, timeZone: string, options: HomeOverviewCacheOptions = {}) {
  const now = options.now ?? new Date();
  const storage = resolveStorage(options.storage);
  if (!storage) return;

  const { cacheKey } = resolveHomeOverviewCacheKey(userId, timeZone, now);
  try {
    storage.removeItem(cacheKey);
  } catch {
    // Cache invalidation is best-effort; the next live request still refreshes stats.
  }
}

export function isCachedHomeOverviewCompatibleWithActiveLearningGroup(
  stats: UserStats,
  activeLearningGroupId: string | null | undefined,
) {
  if (!activeLearningGroupId) return true;

  const routineCard = stats.routineCard;
  if (routineCard.ctaMode === 'continue_learning' && routineCard.boundLearningGroupId === activeLearningGroupId) {
    return true;
  }

  return routineCard.officialLibraryOptions.some((option) => option.activeGroupId === activeLearningGroupId);
}
