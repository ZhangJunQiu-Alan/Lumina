import { apiFetch } from './api';
import {
  createLearningGroupFromVocabularyEntries,
  fetchVocabularyEntriesByWords,
  persistEnrichedVocabularyEntries,
  type PersistedVocabularyEntry,
} from './importFlow';
import { buildOfficialBatchFromRows, getOfficialLibraryDefinition, type OfficialStudyMode } from './officialLibrary';
import { invalidateLibraryCache } from './libraryCache';
import { AI_CONTENT_FEATURES_ENABLED } from './aiFeatures';
import { supabase } from './supabase';
import { toWord, type EnrichedWord, type OfficialLibraryId, type Word } from '../types';
import { normalizeWordKey } from '../../shared/wordBatch';

export interface StartNextOfficialBatchInput {
  userId: string;
  libraryId: OfficialLibraryId;
  mode: OfficialStudyMode;
  existingGroupCount: number;
}

export interface StartNextOfficialBatchResult {
  groupId: string;
  words: Word[];
  libraryId: OfficialLibraryId;
  mode: OfficialStudyMode;
}

export interface AppendNextOfficialBatchInput {
  userId: string;
  groupId: string;
  libraryId: OfficialLibraryId;
  mode: OfficialStudyMode;
  existingGroupCount: number;
}

export interface AppendNextOfficialBatchResult {
  appendedWords: Word[];
}

async function prepareNextOfficialBatchEntries({
  userId,
  libraryId,
  mode,
  existingGroupCount,
}: Pick<StartNextOfficialBatchInput, 'userId' | 'libraryId' | 'mode' | 'existingGroupCount'>) {
  const { data, error } = await supabase.rpc('official_next_batch', {
    p_user_id: userId,
    p_library_id: libraryId,
    p_mode: mode,
    p_limit: getOfficialLibraryDefinition(libraryId).batchSize,
  });

  if (error) {
    throw new Error(`official_next_batch failed: ${error.message}`);
  }

  const rows = ((data ?? []) as Array<{ word: string; word_position: number }>).map((row) => ({
    word: row.word,
    position: row.word_position,
  }));

  const nextBatch = buildOfficialBatchFromRows(libraryId, rows, mode, existingGroupCount);
  if (!nextBatch) return null;

  const { existing, missing } = await fetchVocabularyEntriesByWords(nextBatch.words);
  const existingByWord = new Map(existing.map((entry) => [normalizeWordKey(entry.word), entry]));

  let persistedEntries: PersistedVocabularyEntry[] = existing;

  if (missing.length > 0) {
    if (!AI_CONTENT_FEATURES_ENABLED) {
      throw new Error('这批官方词还没预置完成，暂时不能自动补齐。');
    }

    const res = await apiFetch('/api/vocab/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: missing, source: 'official_library' }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const { data } = (await res.json()) as { data: EnrichedWord[] };
    const persistedMissingEntries = await persistEnrichedVocabularyEntries(data, {
      sourceType: 'system',
    });
    const missingByWord = new Map(persistedMissingEntries.map((entry) => [normalizeWordKey(entry.word), entry]));

    persistedEntries = nextBatch.words
      .map((word) => {
        const normalizedWord = normalizeWordKey(word);
        return existingByWord.get(normalizedWord) ?? missingByWord.get(normalizedWord);
      })
      .filter((entry): entry is PersistedVocabularyEntry => Boolean(entry));

    if (persistedEntries.length !== nextBatch.words.length) {
      throw new Error('这批官方词暂时没整理完整，再试一次。');
    }
  }

  return {
    groupName: nextBatch.groupName,
    entries: persistedEntries,
  };
}

export async function startNextOfficialBatch({
  userId,
  libraryId,
  mode,
  existingGroupCount,
}: StartNextOfficialBatchInput): Promise<StartNextOfficialBatchResult | null> {
  const nextBatch = await prepareNextOfficialBatchEntries({
    userId,
    libraryId,
    mode,
    existingGroupCount,
  });
  if (!nextBatch) return null;

  const result = await createLearningGroupFromVocabularyEntries(userId, nextBatch.entries, {
    groupName: nextBatch.groupName,
    groupSourceType: 'system',
    libraryId,
  });

  invalidateLibraryCache(userId);

  return {
    ...result,
    libraryId,
    mode,
  };
}

export async function appendNextOfficialBatchToLearningGroup({
  userId,
  groupId,
  libraryId,
  mode,
  existingGroupCount,
}: AppendNextOfficialBatchInput): Promise<AppendNextOfficialBatchResult | null> {
  const nextBatch = await prepareNextOfficialBatchEntries({
    userId,
    libraryId,
    mode,
    existingGroupCount,
  });
  if (!nextBatch) return null;

  const { data: existingRows, error: existingRowsError } = await supabase
    .from('learning_group_words')
    .select('vocabulary_item_id, sequence_no')
    .eq('learning_group_id', groupId);

  if (existingRowsError) {
    throw new Error(`learning_group_words lookup failed: ${existingRowsError.message}`);
  }

  const existingIds = new Set(
    ((existingRows ?? []) as Array<{ vocabulary_item_id: string }>)
      .map((row) => row.vocabulary_item_id)
      .filter(Boolean),
  );
  const entriesToAppend = nextBatch.entries.filter((entry) => !existingIds.has(entry.id));
  if (entriesToAppend.length === 0) {
    return { appendedWords: [] };
  }

  const maxSequenceNo = ((existingRows ?? []) as Array<{ sequence_no: number | null }>).reduce(
    (max, row) => Math.max(max, row.sequence_no ?? -1),
    -1,
  );

  const { error: insertWordsError } = await supabase.from('learning_group_words').insert(
    entriesToAppend.map((entry, index) => ({
      learning_group_id: groupId,
      vocabulary_item_id: entry.id,
      sequence_no: maxSequenceNo + index + 1,
    })),
  );

  if (insertWordsError) {
    throw new Error(`learning_group_words append failed: ${insertWordsError.message}`);
  }

  const { error: reviewStateError } = await supabase.from('review_states').upsert(
    entriesToAppend.map((entry) => ({
      user_id: userId,
      vocabulary_item_id: entry.id,
      memory_state: 'new',
      interval_days: null,
      next_review_at: null,
      graduated_at: null,
    })),
    { onConflict: 'user_id,vocabulary_item_id', ignoreDuplicates: true },
  );

  if (reviewStateError) {
    throw new Error(`review_states append failed: ${reviewStateError.message}`);
  }

  invalidateLibraryCache(userId);

  return {
    appendedWords: entriesToAppend.map(toWord),
  };
}
