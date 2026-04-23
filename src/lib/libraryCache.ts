import type {
  LibraryGroupSummary,
  LibraryGroupWord,
  OfficialLibraryId,
  OfficialResumeTargets,
  OfficialLibrarySummary,
} from '../types';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

export interface LibraryGroupDetailCacheData {
  group: LibraryGroupSummary | null;
  words: LibraryGroupWord[];
}

export interface OfficialLibraryDetailCacheData {
  libraryId: OfficialLibraryId;
  summary: OfficialLibrarySummary;
  existingGroupCount: number;
  words: LibraryGroupWord[];
}

export type OfficialResumeMap = Record<OfficialLibraryId, OfficialResumeTargets>;

const LIBRARY_CACHE_TTL_MS = 5 * 60 * 1000;

const groupListCache = new Map<string, CacheEntry<LibraryGroupSummary[]>>();
const groupListRequests = new Map<string, Promise<LibraryGroupSummary[]>>();

const groupDetailCache = new Map<string, CacheEntry<LibraryGroupDetailCacheData>>();
const groupDetailRequests = new Map<string, Promise<LibraryGroupDetailCacheData>>();

const officialResumeCache = new Map<string, CacheEntry<OfficialResumeMap>>();
const officialResumeRequests = new Map<string, Promise<OfficialResumeMap>>();

const officialDetailCache = new Map<string, CacheEntry<OfficialLibraryDetailCacheData>>();
const officialDetailRequests = new Map<string, Promise<OfficialLibraryDetailCacheData>>();

const officialLearnedCache = new Map<string, CacheEntry<Set<string>>>();
const officialLearnedRequests = new Map<string, Promise<Set<string>>>();

function buildGroupDetailKey(userId: string, groupId: string) {
  return `${userId}:${groupId}`;
}

function buildOfficialDetailKey(userId: string, libraryId: OfficialLibraryId) {
  return `${userId}:${libraryId}`;
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

export function getCachedOfficialResumeCandidates(userId: string) {
  return officialResumeCache.get(userId) ?? null;
}

export async function refreshOfficialResumeCandidates(
  userId: string,
  loader: () => Promise<OfficialResumeMap>,
) {
  const existingRequest = officialResumeRequests.get(userId);
  if (existingRequest) return existingRequest;

  const request = loader()
    .then((data) => {
      officialResumeCache.set(userId, {
        data,
        cachedAt: Date.now(),
      });
      return data;
    })
    .finally(() => {
      officialResumeRequests.delete(userId);
    });

  officialResumeRequests.set(userId, request);
  return request;
}

export function getCachedOfficialLibraryDetail(userId: string, libraryId: OfficialLibraryId) {
  return officialDetailCache.get(buildOfficialDetailKey(userId, libraryId)) ?? null;
}

export function getCachedOfficialLearnedWords(userId: string, libraryId: OfficialLibraryId) {
  return officialLearnedCache.get(buildOfficialDetailKey(userId, libraryId)) ?? null;
}

export async function refreshOfficialLearnedWords(
  userId: string,
  libraryId: OfficialLibraryId,
  loader: () => Promise<Set<string>>,
) {
  const key = buildOfficialDetailKey(userId, libraryId);
  const existingRequest = officialLearnedRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = loader()
    .then((data) => {
      officialLearnedCache.set(key, {
        data,
        cachedAt: Date.now(),
      });
      return data;
    })
    .finally(() => {
      officialLearnedRequests.delete(key);
    });

  officialLearnedRequests.set(key, request);
  return request;
}

export async function refreshOfficialLibraryDetail(
  userId: string,
  libraryId: OfficialLibraryId,
  loader: () => Promise<OfficialLibraryDetailCacheData>,
) {
  const key = buildOfficialDetailKey(userId, libraryId);
  const existingRequest = officialDetailRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = loader()
    .then((data) => {
      officialDetailCache.set(key, {
        data,
        cachedAt: Date.now(),
      });
      return data;
    })
    .finally(() => {
      officialDetailRequests.delete(key);
    });

  officialDetailRequests.set(key, request);
  return request;
}

export function invalidateLibraryCache(userId?: string) {
  if (!userId) {
    groupListCache.clear();
    groupListRequests.clear();
    groupDetailCache.clear();
    groupDetailRequests.clear();
    officialResumeCache.clear();
    officialResumeRequests.clear();
    officialDetailCache.clear();
    officialDetailRequests.clear();
    officialLearnedCache.clear();
    officialLearnedRequests.clear();
    return;
  }

  groupListCache.delete(userId);
  groupListRequests.delete(userId);
  officialResumeCache.delete(userId);
  officialResumeRequests.delete(userId);

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

  for (const key of officialDetailCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      officialDetailCache.delete(key);
    }
  }

  for (const key of officialDetailRequests.keys()) {
    if (key.startsWith(`${userId}:`)) {
      officialDetailRequests.delete(key);
    }
  }

  for (const key of officialLearnedCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      officialLearnedCache.delete(key);
    }
  }

  for (const key of officialLearnedRequests.keys()) {
    if (key.startsWith(`${userId}:`)) {
      officialLearnedRequests.delete(key);
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
