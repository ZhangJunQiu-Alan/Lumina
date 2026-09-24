import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { fetchOfficialCompletionCounts, fetchSavedWords, type SavedWordEntry } from '../../lib/libraryApi';
import { fetchOfficialResumeCandidates } from '../../lib/learningSessionApi';
import type { OfficialLibraryCompletionCounts, OfficialResumeTargets, OfficialLibraryId } from '../../types';

export function useSavedWordsQuery(userId?: string | null, options?: { enabled?: boolean }) {
  return useQuery<SavedWordEntry[]>({
    queryKey: queryKeys.library.savedWords(userId || ''),
    queryFn: () => fetchSavedWords(userId!),
    enabled: Boolean(userId) && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
  });
}

export function useOfficialResumeCandidatesQuery(userId?: string | null, options?: { enabled?: boolean }) {
  return useQuery<Record<OfficialLibraryId, OfficialResumeTargets>>({
    queryKey: queryKeys.library.officialResume(userId || ''),
    queryFn: () => fetchOfficialResumeCandidates(userId!),
    enabled: Boolean(userId) && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
  });
}

export function useOfficialCompletionCountsQuery(userId?: string | null, options?: { enabled?: boolean }) {
  return useQuery<OfficialLibraryCompletionCounts>({
    queryKey: queryKeys.library.officialCompletion(userId || ''),
    queryFn: () => fetchOfficialCompletionCounts(userId!),
    enabled: Boolean(userId) && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
  });
}
