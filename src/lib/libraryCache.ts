import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';
import type {
  LibraryGroupSummary,
  LibraryGroupWord,
  OfficialLibraryId,
  OfficialLibraryCompletionCounts,
  OfficialResumeTargets,
  OfficialLibrarySummary,
} from '../types';
import type { SavedWordEntry } from './libraryApi';

export interface CacheEntry<T> {
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

export const LIBRARY_CACHE_TTL_MS = 5 * 60 * 1000;

export function isLibraryCacheFresh(entry: CacheEntry<unknown> | null | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.cachedAt < LIBRARY_CACHE_TTL_MS;
}

function getEntryFromQuery<T>(queryKey: readonly unknown[]): CacheEntry<T> | null {
  const data = queryClient.getQueryData<T>(queryKey);
  if (data === undefined) return null;
  const state = queryClient.getQueryState<T>(queryKey);
  return {
    data,
    cachedAt: state?.dataUpdatedAt || Date.now(),
  };
}

export function getCachedLibraryGroups(userId: string): CacheEntry<LibraryGroupSummary[]> | null {
  return getEntryFromQuery(queryKeys.library.groups(userId));
}

export async function refreshLibraryGroups(
  userId: string,
  loader: () => Promise<LibraryGroupSummary[]>,
): Promise<LibraryGroupSummary[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.library.groups(userId),
    queryFn: loader,
    staleTime: 0,
  });
}

export function getCachedSavedWords(userId: string): CacheEntry<SavedWordEntry[]> | null {
  return getEntryFromQuery(queryKeys.library.savedWords(userId));
}

export async function refreshSavedWords(
  userId: string,
  loader: () => Promise<SavedWordEntry[]>,
): Promise<SavedWordEntry[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.library.savedWords(userId),
    queryFn: loader,
    staleTime: 0,
  });
}

export function removeSavedWordFromCache(userId: string, vocabularyItemId: string) {
  queryClient.setQueryData<SavedWordEntry[]>(
    queryKeys.library.savedWords(userId),
    (old) => (old ? old.filter((entry) => entry.vocabularyItemId !== vocabularyItemId) : old),
  );
}

export function getCachedLibraryGroupDetail(
  userId: string,
  groupId: string,
): CacheEntry<LibraryGroupDetailCacheData> | null {
  return getEntryFromQuery(queryKeys.library.groupDetail(userId, groupId));
}

export async function refreshLibraryGroupDetail(
  userId: string,
  groupId: string,
  loader: () => Promise<LibraryGroupDetailCacheData>,
): Promise<LibraryGroupDetailCacheData> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.library.groupDetail(userId, groupId),
    queryFn: loader,
    staleTime: 0,
  });
}

export function removeLibraryGroupFromCache(userId: string, groupId: string) {
  queryClient.setQueryData<LibraryGroupSummary[]>(
    queryKeys.library.groups(userId),
    (old) => (old ? old.filter((group) => group.id !== groupId) : old),
  );
  queryClient.removeQueries({
    queryKey: queryKeys.library.groupDetail(userId, groupId),
  });
}

export function getCachedOfficialResumeCandidates(userId: string): CacheEntry<OfficialResumeMap> | null {
  return getEntryFromQuery(queryKeys.library.officialResume(userId));
}

export async function refreshOfficialResumeCandidates(
  userId: string,
  loader: () => Promise<OfficialResumeMap>,
): Promise<OfficialResumeMap> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.library.officialResume(userId),
    queryFn: loader,
    staleTime: 0,
  });
}

export function getCachedOfficialLibraryDetail(
  userId: string,
  libraryId: OfficialLibraryId,
): CacheEntry<OfficialLibraryDetailCacheData> | null {
  return getEntryFromQuery(queryKeys.library.officialDetail(userId, libraryId));
}

export async function refreshOfficialLibraryDetail(
  userId: string,
  libraryId: OfficialLibraryId,
  loader: () => Promise<OfficialLibraryDetailCacheData>,
): Promise<OfficialLibraryDetailCacheData> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.library.officialDetail(userId, libraryId),
    queryFn: loader,
    staleTime: 0,
  });
}

export function getCachedOfficialCompletionCounts(
  userId: string,
): CacheEntry<OfficialLibraryCompletionCounts> | null {
  return getEntryFromQuery(queryKeys.library.officialCompletion(userId));
}

export async function refreshOfficialCompletionCounts(
  userId: string,
  loader: () => Promise<OfficialLibraryCompletionCounts>,
): Promise<OfficialLibraryCompletionCounts> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.library.officialCompletion(userId),
    queryFn: loader,
    staleTime: 0,
  });
}

export function invalidateLibraryCache(userId?: string) {
  if (!userId) {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'library',
    });
    return;
  }
  queryClient.removeQueries({
    queryKey: queryKeys.library.all(userId),
  });
  queryClient.invalidateQueries({
    queryKey: queryKeys.library.all(userId),
  });
}
