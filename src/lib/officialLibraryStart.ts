import { apiFetch } from './api';
import {
  createLearningGroupFromVocabularyEntries,
  fetchVocabularyEntriesByWords,
  persistEnrichedVocabularyEntries,
  type PersistedVocabularyEntry,
} from './importFlow';
import {
  getOfficialNextBatch,
  type OfficialStudyMode,
} from './officialLibrary';
import { fetchOfficialLearnedWords } from './libraryApi';
import { invalidateLibraryCache, refreshOfficialLearnedWords } from './libraryCache';
import type { EnrichedWord, OfficialLibraryId, Word } from '../types';
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
}

export async function startNextOfficialBatch({
  userId,
  libraryId,
  mode,
  existingGroupCount,
}: StartNextOfficialBatchInput): Promise<StartNextOfficialBatchResult | null> {
  const learnedSet = await refreshOfficialLearnedWords(userId, libraryId, () =>
    fetchOfficialLearnedWords(userId, libraryId),
  );

  const nextBatch = getOfficialNextBatch(libraryId, learnedSet, mode, existingGroupCount, 0);
  if (!nextBatch) return null;

  const { existing, missing } = await fetchVocabularyEntriesByWords(nextBatch.words);
  const existingByWord = new Map(
    existing.map((entry) => [normalizeWordKey(entry.word), entry]),
  );

  let persistedEntries: PersistedVocabularyEntry[] = existing;

  if (missing.length > 0) {
    const res = await apiFetch('/api/vocab/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: missing, source: 'official_library' }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const { data } = await res.json() as { data: EnrichedWord[] };
    const persistedMissingEntries = await persistEnrichedVocabularyEntries(data, {
      sourceType: 'system',
    });
    const missingByWord = new Map(
      persistedMissingEntries.map((entry) => [normalizeWordKey(entry.word), entry]),
    );

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

  const result = await createLearningGroupFromVocabularyEntries(userId, persistedEntries, {
    groupName: nextBatch.groupName,
    groupSourceType: 'system',
    libraryId,
  });

  invalidateLibraryCache(userId);

  return result;
}
