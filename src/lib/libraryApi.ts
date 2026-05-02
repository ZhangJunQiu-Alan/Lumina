import { supabase } from './supabase';
import { apiFetch } from './api';
import {
  OFFICIAL_LIBRARY_DEFINITIONS,
  getOfficialLibraryDefinition,
  resolveLibraryGroupSourceType,
} from './officialLibrary';
import type { MemoryState, OfficialLibraryId, OfficialLibraryCompletionCounts, ReviewResultType } from '../types';

interface GroupWordRow {
  vocabulary_item_id: string;
}

interface SharedWordRow {
  vocabulary_item_id: string;
}

type SavedWordSource = 'import' | 'reading_popup' | 'manual' | 'migration';

interface SavedWordRow {
  id: string;
  vocabulary_item_id: string;
  source: SavedWordSource | null;
  saved_at: string | null;
  vocabulary_items:
    | {
        id: string;
        word: string | null;
        ipa_uk: string | null;
        primary_meaning_zh: string | null;
        enrichment_level: 'lite' | 'full' | null;
      }
    | Array<{
        id: string;
        word: string | null;
        ipa_uk: string | null;
        primary_meaning_zh: string | null;
        enrichment_level: 'lite' | 'full' | null;
      }>
    | null;
}

interface SavedWordReviewStateRow {
  vocabulary_item_id: string;
  memory_state: MemoryState | null;
  next_review_at: string | null;
  last_result: ReviewResultType | null;
}

export interface SavedWordEntry {
  id: string;
  vocabularyItemId: string;
  word: string;
  phonetic: string;
  meaning: string;
  enrichmentLevel: 'lite' | 'full';
  source: SavedWordSource;
  savedAt: string;
  memoryState: MemoryState | null;
  nextReviewAt: string | null;
  lastResult: ReviewResultType | null;
  isInActiveLearningGroup: boolean;
}

export interface DeleteLibraryGroupResponse {
  deletedGroupId: string;
  deletedWordCount: number;
  removedReviewStateCount: number;
}

export async function deleteLibraryGroup(
  userId: string,
  groupId: string,
): Promise<DeleteLibraryGroupResponse> {
  const { data: group, error: groupError } = await supabase
    .from('learning_groups')
    .select('id, source_type, library_id, group_name')
    .eq('id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (groupError) {
    throw new Error(groupError.message);
  }

  if (!group) {
    throw new Error('这组词不存在，或它不属于你。');
  }

  if (resolveLibraryGroupSourceType(group.source_type, group.library_id, group.group_name) === 'system') {
    throw new Error('系统词库暂时不支持删除。');
  }

  const { data: groupWords, error: groupWordsError } = await supabase
    .from('learning_group_words')
    .select('vocabulary_item_id')
    .eq('learning_group_id', groupId);

  if (groupWordsError) {
    throw new Error(groupWordsError.message);
  }

  const targetWordIds = Array.from(
    new Set(((groupWords ?? []) as GroupWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean)),
  );

  let removedReviewStateCount = 0;

  if (targetWordIds.length > 0) {
    const { data: sharedWords, error: sharedWordsError } = await supabase
      .from('learning_group_words')
      .select('vocabulary_item_id, learning_groups!inner(user_id)')
      .in('vocabulary_item_id', targetWordIds)
      .neq('learning_group_id', groupId)
      .eq('learning_groups.user_id', userId);

    if (sharedWordsError) {
      throw new Error(sharedWordsError.message);
    }

    const sharedWordIds = new Set(
      ((sharedWords ?? []) as SharedWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean),
    );
    const orphanWordIds = targetWordIds.filter((wordId) => !sharedWordIds.has(wordId));

    if (orphanWordIds.length > 0) {
      const { error: reviewEventsError } = await supabase
        .from('review_events')
        .delete()
        .eq('user_id', userId)
        .in('vocabulary_item_id', orphanWordIds);

      if (reviewEventsError) {
        throw new Error(reviewEventsError.message);
      }

      const { error: reviewStatesError, count } = await supabase
        .from('review_states')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .in('vocabulary_item_id', orphanWordIds);

      if (reviewStatesError) {
        throw new Error(reviewStatesError.message);
      }

      removedReviewStateCount = count ?? 0;
    }
  }

  const { error: deleteGroupError } = await supabase
    .from('learning_groups')
    .delete()
    .eq('id', groupId)
    .eq('user_id', userId);

  if (deleteGroupError) {
    throw new Error(deleteGroupError.message);
  }

  return {
    deletedGroupId: groupId,
    deletedWordCount: targetWordIds.length,
    removedReviewStateCount,
  };
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export async function fetchActiveLearningGroupWordIds(userId: string): Promise<Set<string>> {
  const { data: activeGroups, error: groupError } = await supabase
    .from('learning_groups')
    .select('id')
    .eq('user_id', userId)
    .is('completed_at', null)
    .or('status.is.null,status.neq.completed');

  if (groupError) {
    throw new Error(groupError.message);
  }

  const groupIds = ((activeGroups ?? []) as Array<{ id: string }>).map((group) => group.id).filter(Boolean);
  if (groupIds.length === 0) return new Set();

  const { data: groupWords, error: groupWordsError } = await supabase
    .from('learning_group_words')
    .select('vocabulary_item_id')
    .in('learning_group_id', groupIds);

  if (groupWordsError) {
    throw new Error(groupWordsError.message);
  }

  return new Set(
    ((groupWords ?? []) as GroupWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean),
  );
}

export async function fetchSavedWords(userId: string): Promise<SavedWordEntry[]> {
  const [savedResult, activeWordIds] = await Promise.all([
    supabase
      .from('user_saved_words')
      .select(`
        id,
        vocabulary_item_id,
        source,
        saved_at,
        vocabulary_items!inner (
          id,
          word,
          ipa_uk,
          primary_meaning_zh,
          enrichment_level
        )
      `)
      .eq('user_id', userId)
      .order('saved_at', { ascending: true }),
    fetchActiveLearningGroupWordIds(userId),
  ]);

  if (savedResult.error) {
    throw new Error(savedResult.error.message);
  }

  const savedRows = (savedResult.data ?? []) as unknown as SavedWordRow[];
  const vocabularyItemIds = Array.from(new Set(savedRows.map((row) => row.vocabulary_item_id).filter(Boolean)));

  let reviewStates: SavedWordReviewStateRow[] = [];
  if (vocabularyItemIds.length > 0) {
    const { data, error } = await supabase
      .from('review_states')
      .select('vocabulary_item_id, memory_state, next_review_at, last_result')
      .eq('user_id', userId)
      .in('vocabulary_item_id', vocabularyItemIds);

    if (error) {
      throw new Error(error.message);
    }

    reviewStates = (data ?? []) as SavedWordReviewStateRow[];
  }

  const reviewStateByWordId = new Map(
    reviewStates.map((row) => [row.vocabulary_item_id, row]),
  );

  return savedRows
    .map((row) => {
      const vocabularyItem = asArray(row.vocabulary_items)[0];
      if (!vocabularyItem?.id || !vocabularyItem.word) return null;

      const reviewState = reviewStateByWordId.get(row.vocabulary_item_id);
      return {
        id: row.id,
        vocabularyItemId: vocabularyItem.id,
        word: vocabularyItem.word,
        phonetic: vocabularyItem.ipa_uk ?? '',
        meaning: vocabularyItem.primary_meaning_zh ?? '',
        enrichmentLevel: vocabularyItem.enrichment_level ?? 'full',
        source: row.source ?? 'manual',
        savedAt: row.saved_at ?? new Date(0).toISOString(),
        memoryState: reviewState?.memory_state ?? null,
        nextReviewAt: reviewState?.next_review_at ?? null,
        lastResult: reviewState?.last_result ?? null,
        isInActiveLearningGroup: activeWordIds.has(vocabularyItem.id),
      } satisfies SavedWordEntry;
    })
    .filter((entry): entry is SavedWordEntry => Boolean(entry));
}

export async function deleteSavedWord(vocabularyItemId: string): Promise<void> {
  const response = await apiFetch(`/api/library/saved-words/${encodeURIComponent(vocabularyItemId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error((payload as { error?: string }).error ?? `HTTP ${response.status}`);
  }
}

interface LearnedWordRow {
  vocabulary_items: { word: string | null } | { word: string | null }[] | null;
}

interface LearnedReviewStateRow {
  vocabulary_items: { word: string | null } | { word: string | null }[] | null;
}

interface CompletionReviewStateRow {
  vocabulary_items: { word: string | null } | { word: string | null }[] | null;
}

const OFFICIAL_COMPLETION_PAGE_SIZE = 1000;

const officialLibraryIdsByWord = (() => {
  const result = new Map<string, OfficialLibraryId[]>();

  for (const definition of OFFICIAL_LIBRARY_DEFINITIONS) {
    for (const word of definition.words) {
      const normalizedWord = word.trim().toLowerCase();
      if (!normalizedWord) continue;

      const libraryIds = result.get(normalizedWord) ?? [];
      if (!libraryIds.includes(definition.id)) {
        libraryIds.push(definition.id);
      }
      result.set(normalizedWord, libraryIds);
    }
  }

  return result;
})();

export function buildEmptyOfficialCompletionCounts(): OfficialLibraryCompletionCounts {
  return Object.fromEntries(
    OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [definition.id, 0]),
  ) as OfficialLibraryCompletionCounts;
}

export async function fetchOfficialLearnedWords(
  userId: string,
  libraryId: OfficialLibraryId,
): Promise<Set<string>> {
  const officialWordSet = new Set(
    getOfficialLibraryDefinition(libraryId).words.map((word) => word.trim().toLowerCase()),
  );
  const [groupResult, reviewStateResult] = await Promise.all([
    supabase
      .from('learning_group_words')
      .select('vocabulary_items!inner(word), learning_groups!inner(user_id, source_type, library_id)')
      .eq('learning_groups.user_id', userId)
      .eq('learning_groups.source_type', 'system')
      .eq('learning_groups.library_id', libraryId),
    supabase
      .from('review_states')
      .select('vocabulary_items!inner(word)')
      .eq('user_id', userId)
      .neq('memory_state', 'new'),
  ]);

  if (groupResult.error) {
    throw new Error(groupResult.error.message);
  }

  if (reviewStateResult.error) {
    throw new Error(reviewStateResult.error.message);
  }

  const result = new Set<string>();
  for (const row of (groupResult.data ?? []) as LearnedWordRow[]) {
    const vocab = Array.isArray(row.vocabulary_items) ? row.vocabulary_items[0] : row.vocabulary_items;
    const word = vocab?.word?.trim().toLowerCase();
    if (word) result.add(word);
  }

  for (const row of (reviewStateResult.data ?? []) as LearnedReviewStateRow[]) {
    const vocab = Array.isArray(row.vocabulary_items) ? row.vocabulary_items[0] : row.vocabulary_items;
    const word = vocab?.word?.trim().toLowerCase();
    if (word && officialWordSet.has(word)) result.add(word);
  }

  return result;
}

export async function fetchOfficialCompletionCounts(userId: string): Promise<OfficialLibraryCompletionCounts> {
  const completedWordsByLibrary = Object.fromEntries(
    OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [definition.id, new Set<string>()]),
  ) as Record<OfficialLibraryId, Set<string>>;

  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('review_states')
      .select('vocabulary_item_id, vocabulary_items!inner(word)')
      .eq('user_id', userId)
      .in('memory_state', ['stable_recall', 'mastered'])
      .order('vocabulary_item_id', { ascending: true })
      .range(from, from + OFFICIAL_COMPLETION_PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as CompletionReviewStateRow[];

    for (const row of rows) {
      const vocab = Array.isArray(row.vocabulary_items) ? row.vocabulary_items[0] : row.vocabulary_items;
      const word = vocab?.word?.trim().toLowerCase();
      if (!word) continue;

      for (const libraryId of officialLibraryIdsByWord.get(word) ?? []) {
        completedWordsByLibrary[libraryId].add(word);
      }
    }

    if (rows.length < OFFICIAL_COMPLETION_PAGE_SIZE) {
      break;
    }

    from += OFFICIAL_COMPLETION_PAGE_SIZE;
  }

  return Object.fromEntries(
    OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [
      definition.id,
      completedWordsByLibrary[definition.id].size,
    ]),
  ) as OfficialLibraryCompletionCounts;
}

export async function fetchDifficultWords(userId: string) {
  const { data, error } = await supabase
    .from('review_states')
    .select(`
      memory_state,
      next_review_at,
      last_result,
      vocabulary_items!inner (
        id,
        word,
        ipa_uk,
        primary_meaning_zh,
        morphology_summary_zh,
        memory_tip,
        created_at,
        audio_uk_url,
        audio_us_url,
        vocabulary_senses (
          pos,
          example_sentence,
          example_translation_zh
        ),
        vocabulary_morphology_parts (
          part_text,
          part_kind,
          meaning_zh,
          note_zh,
          sort_order
        ),
        vocabulary_relations (
          relation_type,
          related_word,
          meaning_zh,
          note_zh,
          sort_order
        ),
        confused_words (
          confused_word,
          difference_note_zh,
          sort_order
        )
      )
    `)
    .eq('user_id', userId)
    .in('memory_state', ['fuzzy', 'slow_recall'])
    .order('next_review_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
