import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes fresh window
      gcTime: 10 * 60 * 1000, // 10 minutes cache retention
      refetchOnWindowFocus: true,
      retry: (failureCount, error: any) => {
        // Do not retry on client auth/not found errors
        const status = error?.status ?? error?.statusCode;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
    },
  },
});

export function invalidateHomeQueries(userId?: string) {
  return queryClient.invalidateQueries({
    queryKey: queryKeys.home.all(userId),
  });
}

export function invalidateLibraryQueries(userId?: string) {
  return queryClient.invalidateQueries({
    queryKey: queryKeys.library.all(userId),
  });
}

export function invalidateSavedWordsQueries(userId?: string) {
  if (userId) {
    return queryClient.invalidateQueries({
      queryKey: queryKeys.library.savedWords(userId),
    });
  }
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'library' && query.queryKey[2] === 'savedWords',
  });
}

export function invalidateReviewQueries(userId?: string) {
  return queryClient.invalidateQueries({
    queryKey: queryKeys.review.all(userId),
  });
}
