import { supabase } from './supabase';
import type { MemoryState } from '../types';

interface ReviewStateRow {
  vocabulary_item_id: string;
  memory_state: MemoryState;
}

export interface SavedWordPreparationResult {
  eligibleVocabularyItemIds: string[];
  skippedNonNewVocabularyItemIds: string[];
  createdReviewStates: number;
  skippedNonNew: number;
}

export async function prepareVocabularyItemsForSavedWords(
  userId: string,
  vocabularyItemIds: string[],
): Promise<SavedWordPreparationResult> {
  const uniqueIds = Array.from(new Set(vocabularyItemIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return {
      eligibleVocabularyItemIds: [],
      skippedNonNewVocabularyItemIds: [],
      createdReviewStates: 0,
      skippedNonNew: 0,
    };
  }

  const { data, error } = await supabase
    .from('review_states')
    .select('vocabulary_item_id, memory_state')
    .eq('user_id', userId)
    .in('vocabulary_item_id', uniqueIds);

  if (error) {
    throw new Error(`review_states lookup failed: ${error.message}`);
  }

  const stateByWordId = new Map(
    ((data ?? []) as ReviewStateRow[]).map((row) => [row.vocabulary_item_id, row.memory_state]),
  );
  const missingIds = uniqueIds.filter((id) => !stateByWordId.has(id));
  const eligibleVocabularyItemIds = uniqueIds.filter((id) => {
    const state = stateByWordId.get(id);
    return !state || state === 'new';
  });
  const skippedNonNewVocabularyItemIds = uniqueIds.filter((id) => {
    const state = stateByWordId.get(id);
    return Boolean(state && state !== 'new');
  });

  let createdReviewStates = 0;
  if (missingIds.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from('review_states')
      .upsert(
        missingIds.map((vocabularyItemId) => ({
          user_id: userId,
          vocabulary_item_id: vocabularyItemId,
          memory_state: 'new',
          interval_days: null,
          next_review_at: null,
          graduated_at: null,
        })),
        {
          onConflict: 'user_id,vocabulary_item_id',
          ignoreDuplicates: true,
        },
      )
      .select('id');

    if (insertError) {
      throw new Error(`review_states saved-word upsert failed: ${insertError.message}`);
    }

    createdReviewStates = insertedRows?.length ?? 0;
  }

  return {
    eligibleVocabularyItemIds,
    skippedNonNewVocabularyItemIds,
    createdReviewStates,
    skippedNonNew: skippedNonNewVocabularyItemIds.length,
  };
}
