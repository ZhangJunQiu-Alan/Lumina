import { supabase } from './supabase';
import { apiFetch } from './api';
import { OFFICIAL_LIBRARY_DEFINITIONS, resolveLibraryGroupSourceType } from './officialLibrary';
import type { MemoryState, OfficialLibraryId, OfficialLibraryCompletionCounts, ReviewResultType } from '../types';

interface GroupWordRow {
  vocabulary_item_id: string;
}

interface ActiveLearningGroupWordOptions {
  sourceType?: 'custom' | 'system';
  libraryId?: OfficialLibraryId | null;
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
        vocabulary_senses?: { example_sentence: string | null }[] | null;
      }
    | Array<{
        id: string;
        word: string | null;
        ipa_uk: string | null;
        primary_meaning_zh: string | null;
        enrichment_level: 'lite' | 'full' | null;
        vocabulary_senses?: { example_sentence: string | null }[] | null;
      }>
    | null;
}

interface SavedWordReviewStateRow {
  vocabulary_item_id: string;
  memory_state: MemoryState;
  next_review_at: string | null;
  last_result: ReviewResultType | null;
}

export interface SavedWordEntry {
  id: string;
  vocabularyItemId: string;
  word: string;
  phonetic: string;
  meaning: string;
  exampleSentence: string;
  enrichmentLevel: 'lite' | 'full';
  source: SavedWordSource;
  savedAt: string;
  memoryState: MemoryState;
  nextReviewAt: string | null;
  lastResult: ReviewResultType | null;
  isInActiveLearningGroup: boolean;
}

export interface DeleteLibraryGroupResponse {
  deletedGroupId: string;
  deletedWordCount: number;
  removedReviewStateCount: number;
}

export interface DeleteOfficialLearningLibraryResponse {
  deletedLibraryId: OfficialLibraryId;
  deletedGroupCount: number;
  deletedWordCount: number;
  removedReviewStateCount: number;
  preservedRoutineGroupIds?: string[];
}

export async function deleteOfficialLearningLibrary(
  libraryId: OfficialLibraryId,
  timeZone?: string | null,
): Promise<DeleteOfficialLearningLibraryResponse> {
  const params = new URLSearchParams();
  if (timeZone) {
    params.set('timezone', timeZone);
  }

  const response = await apiFetch(
    `/api/library/official/${encodeURIComponent(libraryId)}${params.size > 0 ? `?${params.toString()}` : ''}`,
    {
      method: 'DELETE',
    },
  );

  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? `HTTP ${response.status}`);
  }

  return (payload as { data: DeleteOfficialLearningLibraryResponse }).data;
}

export async function deleteLibraryGroup(userId: string, groupId: string): Promise<DeleteLibraryGroupResponse> {
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

  const { count: groupWordCount, error: groupWordsError } = await supabase
    .from('learning_group_words')
    .select('id', { count: 'exact', head: true })
    .eq('learning_group_id', groupId);

  if (groupWordsError) {
    throw new Error(groupWordsError.message);
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
    deletedWordCount: groupWordCount ?? 0,
    removedReviewStateCount: 0,
  };
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export async function fetchActiveLearningGroupWordIds(
  userId: string,
  options: ActiveLearningGroupWordOptions = {},
): Promise<Set<string>> {
  let query = supabase
    .from('learning_groups')
    .select('id')
    .eq('user_id', userId)
    .is('completed_at', null)
    .or('status.is.null,status.neq.completed');

  if (options.sourceType) {
    query = query.eq('source_type', options.sourceType);
  }

  if (options.sourceType === 'system' && options.libraryId) {
    query = query.eq('library_id', options.libraryId);
  }

  const { data: activeGroups, error: groupError } = await query;

  if (groupError) {
    throw new Error(groupError.message);
  }

  const groupIds = ((activeGroups ?? []) as Array<{ id: string }>).map((group) => group.id).filter(Boolean);
  if (groupIds.length === 0) return new Set();

  const groupWords = await fetchAllRows<GroupWordRow>((from, to) =>
    supabase
      .from('learning_group_words')
      .select('vocabulary_item_id')
      .in('learning_group_id', groupIds)
      .range(from, to),
  );

  return new Set(groupWords.map((row) => row.vocabulary_item_id).filter(Boolean));
}

export async function fetchSavedWords(userId: string): Promise<SavedWordEntry[]> {
  const [savedRows, activeWordIds] = await Promise.all([
    fetchAllRows<SavedWordRow>((from, to) =>
      supabase
        .from('user_saved_words')
        .select(
          `
          id,
          vocabulary_item_id,
          source,
          saved_at,
          vocabulary_items!inner (
            id,
            word,
            ipa_uk,
            primary_meaning_zh,
            enrichment_level,
            vocabulary_senses (
              example_sentence
            )
          )
        `,
        )
        .eq('user_id', userId)
        .order('saved_at', { ascending: true })
        .range(from, to),
    ),
    fetchActiveLearningGroupWordIds(userId, { sourceType: 'custom' }),
  ]);

  const vocabularyItemIds = Array.from(new Set(savedRows.map((row) => row.vocabulary_item_id).filter(Boolean)));

  const reviewStates: SavedWordReviewStateRow[] = [];
  for (let i = 0; i < vocabularyItemIds.length; i += IN_FILTER_CHUNK_SIZE) {
    const chunk = vocabularyItemIds.slice(i, i + IN_FILTER_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('review_states')
      .select('vocabulary_item_id, memory_state, next_review_at, last_result')
      .eq('user_id', userId)
      .in('vocabulary_item_id', chunk);

    if (error) {
      throw new Error(error.message);
    }

    reviewStates.push(...((data ?? []) as SavedWordReviewStateRow[]));
  }

  const reviewStateByWordId = new Map(reviewStates.map((row) => [row.vocabulary_item_id, row]));

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
        exampleSentence:
          (vocabularyItem.vocabulary_senses ?? []).map((sense) => sense.example_sentence?.trim() ?? '').find(Boolean) ??
          '',
        enrichmentLevel: vocabularyItem.enrichment_level ?? 'full',
        source: row.source ?? 'manual',
        savedAt: row.saved_at ?? new Date(0).toISOString(),
        memoryState: reviewState?.memory_state ?? 'new',
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

interface CompletionReviewStateRow {
  vocabulary_items: { word: string | null } | { word: string | null }[] | null;
}

const OFFICIAL_COMPLETION_PAGE_SIZE = 1000;
const SUPABASE_PAGE_SIZE = 1000;
const IN_FILTER_CHUNK_SIZE = 500;

// PostgREST silently caps every response at 1000 rows, so any user-scoped collection
// fetch must page through with .range() instead of assuming a single call is complete.
async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await buildPage(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }
  return rows;
}

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
    OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [definition.id, completedWordsByLibrary[definition.id].size]),
  ) as OfficialLibraryCompletionCounts;
}

export async function fetchDifficultWords(userId: string) {
  const { data, error } = await supabase
    .from('review_states')
    .select(
      `
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
    `,
    )
    .eq('user_id', userId)
    .in('memory_state', ['fuzzy', 'slow_recall'])
    .order('next_review_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
