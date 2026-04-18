import type { LibraryGroupSummary, LibraryGroupWord } from '../types';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

export interface LibraryGroupDetailCacheData {
  group: LibraryGroupSummary | null;
  words: LibraryGroupWord[];
}

const LIBRARY_CACHE_TTL_MS = 5 * 60 * 1000;

const groupListCache = new Map<string, CacheEntry<LibraryGroupSummary[]>>();
const groupListRequests = new Map<string, Promise<LibraryGroupSummary[]>>();

const groupDetailCache = new Map<string, CacheEntry<LibraryGroupDetailCacheData>>();
const groupDetailRequests = new Map<string, Promise<LibraryGroupDetailCacheData>>();

function buildGroupDetailKey(userId: string, groupId: string) {
  return `${userId}:${groupId}`;
}

export function isLibraryCacheFresh(entry: CacheEntry<unknown> | null | undefined) {
  if (!entry) return false;
  return Date.now() - entry.cachedAt < LIBRARY_CACHE_TTL_MS;
}

export function getCachedLibraryGroups(userId: string) {
  return groupListCache.get(userId) ?? null;
}

export function getCachedLibraryGroupDetail(userId: string, groupId: string) {
  return groupDetailCache.get(buildGroupDetailKey(userId, groupId)) ?? null;
}

export async function refreshLibraryGroups(
  userId: string,
  loader: () => Promise<LibraryGroupSummary[]>,
) {
  const existingRequest = groupListRequests.get(userId);
  if (existingRequest) return existingRequest;

  const request = loader()
    .then((data) => {
      groupListCache.set(userId, {
        data,
        cachedAt: Date.now(),
      });
      return data;
    })
    .finally(() => {
      groupListRequests.delete(userId);
    });

  groupListRequests.set(userId, request);
  return request;
}

export async function refreshLibraryGroupDetail(
  userId: string,
  groupId: string,
  loader: () => Promise<LibraryGroupDetailCacheData>,
) {
  const key = buildGroupDetailKey(userId, groupId);
  const existingRequest = groupDetailRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = loader()
    .then((data) => {
      groupDetailCache.set(key, {
        data,
        cachedAt: Date.now(),
      });
      return data;
    })
    .finally(() => {
      groupDetailRequests.delete(key);
    });

  groupDetailRequests.set(key, request);
  return request;
}

export function invalidateLibraryCache(userId?: string) {
  if (!userId) {
    groupListCache.clear();
    groupListRequests.clear();
    groupDetailCache.clear();
    groupDetailRequests.clear();
    return;
  }

  groupListCache.delete(userId);
  groupListRequests.delete(userId);

  for (const key of groupDetailCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      groupDetailCache.delete(key);
    }
  }

  for (const key of groupDetailRequests.keys()) {
    if (key.startsWith(`${userId}:`)) {
      groupDetailRequests.delete(key);
    }
  }
}

export function removeLibraryGroupFromCache(userId: string, groupId: string) {
  const listEntry = groupListCache.get(userId);
  if (listEntry) {
    groupListCache.set(userId, {
      data: listEntry.data.filter((group) => group.id !== groupId),
      cachedAt: Date.now(),
    });
  }

  const detailKey = buildGroupDetailKey(userId, groupId);
  groupDetailCache.delete(detailKey);
  groupDetailRequests.delete(detailKey);
}
