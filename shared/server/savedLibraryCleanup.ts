export interface CleanupSavedLibraryOptions {
  apply?: boolean;
  userId?: string;
  sampleLimit?: number;
}

// Older clients still call this endpoint on page load. Keep it mutation-free.
export async function cleanupSavedLibrary(options: CleanupSavedLibraryOptions = {}) {
  return {
    mode: options.apply ? ('apply' as const) : ('dry-run' as const),
    retired: true,
    usersInspected: 0,
    affectedUsers: 0,
    savedWordsInspected: 0,
    createdReviewStates: 0,
    removedSavedWords: 0,
    deletedCustomGroups: 0,
    missingReviewStateSavedWords: 0,
    nonNewSavedWords: 0,
    samples: { createdReviewStates: [], removedSavedWords: [], deletedCustomGroups: [] },
  };
}
