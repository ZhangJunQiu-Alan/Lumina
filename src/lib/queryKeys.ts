/**
 * Centralized TanStack Query key factory for Lumina.
 * Ensures consistent cache keys across all server state queries and mutations.
 */
export const queryKeys = {
  home: {
    all: (userId?: string) => (userId ? (['home', userId] as const) : (['home'] as const)),
    overview: (userId: string, timeZone: string) => ['home', userId, 'overview', timeZone] as const,
    activityHeatmap: (userId: string, timeZone: string) => ['home', userId, 'activityHeatmap', timeZone] as const,
  },
  review: {
    all: (userId?: string) => (userId ? (['review', userId] as const) : (['review'] as const)),
    due: (userId: string, timeZone?: string | null) => ['review', userId, 'due', timeZone ?? ''] as const,
  },
  library: {
    all: (userId?: string) => (userId ? (['library', userId] as const) : (['library'] as const)),
    overview: (userId: string) => ['library', userId, 'overview'] as const,
    groups: (userId: string) => ['library', userId, 'groups'] as const,
    groupDetail: (userId: string, groupId: string) => ['library', userId, 'groupDetail', groupId] as const,
    savedWords: (userId: string) => ['library', userId, 'savedWords'] as const,
    officialDetail: (userId: string, libraryId: string) => ['library', userId, 'officialDetail', libraryId] as const,
    officialResume: (userId: string) => ['library', userId, 'officialResume'] as const,
    officialCompletion: (userId: string) => ['library', userId, 'officialCompletion'] as const,
  },
  ielts: {
    all: (userId?: string) => (userId ? (['ielts', userId] as const) : (['ielts'] as const)),
    dashboard: (userId: string) => ['ielts', userId, 'dashboard'] as const,
    readingTest: (testId: string) => ['ielts', 'readingTest', testId] as const,
    listeningTest: (testId: string) => ['ielts', 'listeningTest', testId] as const,
  },
  article: {
    group: (groupId: string, wordIds: string[]) => ['article', groupId, wordIds.join(',')] as const,
  },
};
