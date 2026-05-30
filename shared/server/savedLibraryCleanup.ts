import { supabaseAdmin } from './supabase.ts';
import type { MemoryState } from './review-domain.ts';

const READ_PAGE_SIZE = 1000;
const WRITE_BATCH_SIZE = 500;
const DEFAULT_SAMPLE_LIMIT = 10;

interface SavedWordRow {
  id: string;
  user_id: string;
  vocabulary_item_id: string;
  source: string | null;
  saved_at: string | null;
}

interface ReviewStateLookupRow {
  user_id: string;
  vocabulary_item_id: string;
  memory_state: MemoryState;
}

interface LearningGroupJoinRow {
  id: string;
  user_id: string;
  source_type: string | null;
  status: string | null;
  completed_at: string | null;
  group_name: string | null;
}

interface LearningGroupWordJoinRow {
  learning_group_id: string;
  vocabulary_item_id: string;
  learning_groups: LearningGroupJoinRow | LearningGroupJoinRow[] | null;
}

interface CleanupSample {
  userId: string;
  vocabularyItemId: string;
  savedWordId?: string;
  source?: string | null;
  savedAt?: string | null;
  memoryState?: MemoryState | 'missing';
  groupId?: string;
  groupName?: string | null;
}

export interface CleanupSavedLibraryResult {
  mode: 'dry-run' | 'apply';
  usersInspected: number;
  affectedUsers: number;
  savedWordsInspected: number;
  createdReviewStates: number;
  removedSavedWords: number;
  deletedCustomGroups: number;
  missingReviewStateSavedWords: number;
  nonNewSavedWords: number;
  samples: {
    createdReviewStates: CleanupSample[];
    removedSavedWords: CleanupSample[];
    deletedCustomGroups: CleanupSample[];
  };
}

export interface CleanupSavedLibraryOptions {
  apply?: boolean;
  userId?: string;
  sampleLimit?: number;
}

function keyFor(userId: string, vocabularyItemId: string) {
  return `${userId}\u0000${vocabularyItemId}`;
}

function chunkRows<T>(rows: T[], chunkSize: number) {
  return Array.from({ length: Math.ceil(rows.length / chunkSize) }, (_, index) =>
    rows.slice(index * chunkSize, (index + 1) * chunkSize),
  );
}

function asSingleGroup(value: LearningGroupWordJoinRow['learning_groups']) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

async function fetchSavedWords(userId?: string) {
  const savedWords: SavedWordRow[] = [];
  let from = 0;

  while (true) {
    let query = supabaseAdmin
      .from('user_saved_words')
      .select('id, user_id, vocabulary_item_id, source, saved_at')
      .order('saved_at', { ascending: true })
      .range(from, from + READ_PAGE_SIZE - 1);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`user_saved_words lookup failed: ${error.message}`);
    }

    const rows = (data ?? []) as SavedWordRow[];
    savedWords.push(...rows);
    if (rows.length < READ_PAGE_SIZE) break;
    from += READ_PAGE_SIZE;
  }

  return savedWords.filter((row) => row.user_id && row.vocabulary_item_id);
}

async function fetchReviewStates(savedWords: SavedWordRow[]) {
  const statesByKey = new Map<string, ReviewStateLookupRow>();
  const vocabularyItemIdsByUser = new Map<string, Set<string>>();

  for (const row of savedWords) {
    const ids = vocabularyItemIdsByUser.get(row.user_id) ?? new Set<string>();
    ids.add(row.vocabulary_item_id);
    vocabularyItemIdsByUser.set(row.user_id, ids);
  }

  for (const [userId, vocabularyItemIds] of vocabularyItemIdsByUser) {
    for (const chunk of chunkRows([...vocabularyItemIds], 100)) {
      const { data, error } = await supabaseAdmin
        .from('review_states')
        .select('user_id, vocabulary_item_id, memory_state')
        .eq('user_id', userId)
        .in('vocabulary_item_id', chunk);

      if (error) {
        throw new Error(`review_states lookup failed: ${error.message}`);
      }

      for (const row of (data ?? []) as ReviewStateLookupRow[]) {
        statesByKey.set(keyFor(row.user_id, row.vocabulary_item_id), row);
      }
    }
  }

  return statesByKey;
}

async function fetchAffectedPendingCustomGroups(nonNewSavedWords: SavedWordRow[]) {
  const groupSamplesById = new Map<string, CleanupSample>();
  const groupIds = new Set<string>();
  const vocabularyItemIdsByUser = new Map<string, Set<string>>();

  for (const row of nonNewSavedWords) {
    const ids = vocabularyItemIdsByUser.get(row.user_id) ?? new Set<string>();
    ids.add(row.vocabulary_item_id);
    vocabularyItemIdsByUser.set(row.user_id, ids);
  }

  for (const [userId, vocabularyItemIds] of vocabularyItemIdsByUser) {
    for (const chunk of chunkRows([...vocabularyItemIds], 100)) {
      const { data, error } = await supabaseAdmin
        .from('learning_group_words')
        .select(
          `
          learning_group_id,
          vocabulary_item_id,
          learning_groups!inner (
            id,
            user_id,
            source_type,
            status,
            completed_at,
            group_name
          )
        `,
        )
        .eq('learning_groups.user_id', userId)
        .eq('learning_groups.source_type', 'custom')
        .in('vocabulary_item_id', chunk);

      if (error) {
        throw new Error(`learning_group_words cleanup lookup failed: ${error.message}`);
      }

      for (const row of (data ?? []) as unknown as LearningGroupWordJoinRow[]) {
        const group = asSingleGroup(row.learning_groups);
        if (!group || group.completed_at || group.status === 'completed') continue;

        groupIds.add(group.id);
        if (!groupSamplesById.has(group.id)) {
          groupSamplesById.set(group.id, {
            userId,
            vocabularyItemId: row.vocabulary_item_id,
            groupId: group.id,
            groupName: group.group_name,
          });
        }
      }
    }
  }

  return {
    groupIds: [...groupIds],
    samples: [...groupSamplesById.values()],
  };
}

async function upsertMissingReviewStates(rows: SavedWordRow[]) {
  let inserted = 0;

  for (const batch of chunkRows(rows, WRITE_BATCH_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from('review_states')
      .upsert(
        batch.map((row) => ({
          user_id: row.user_id,
          vocabulary_item_id: row.vocabulary_item_id,
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

    if (error) {
      throw new Error(`review_states cleanup upsert failed: ${error.message}`);
    }

    inserted += data?.length ?? 0;
  }

  return inserted;
}

async function deleteSavedWords(rows: SavedWordRow[]) {
  let deleted = 0;

  for (const batch of chunkRows(rows, WRITE_BATCH_SIZE)) {
    const ids = batch.map((row) => row.id);
    const { error, count } = await supabaseAdmin.from('user_saved_words').delete({ count: 'exact' }).in('id', ids);

    if (error) {
      throw new Error(`user_saved_words cleanup delete failed: ${error.message}`);
    }

    deleted += count ?? 0;
  }

  return deleted;
}

async function deleteLearningGroups(groupIds: string[]) {
  let deleted = 0;

  for (const batch of chunkRows(groupIds, WRITE_BATCH_SIZE)) {
    const { error, count } = await supabaseAdmin.from('learning_groups').delete({ count: 'exact' }).in('id', batch);

    if (error) {
      throw new Error(`learning_groups cleanup delete failed: ${error.message}`);
    }

    deleted += count ?? 0;
  }

  return deleted;
}

export async function cleanupSavedLibrary(
  options: CleanupSavedLibraryOptions = {},
): Promise<CleanupSavedLibraryResult> {
  const apply = options.apply === true;
  const sampleLimit = Math.max(options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT, 0);
  const savedWords = await fetchSavedWords(options.userId);
  const statesByKey = await fetchReviewStates(savedWords);
  const userIds = new Set(savedWords.map((row) => row.user_id));

  const missingReviewStateRows: SavedWordRow[] = [];
  const nonNewSavedRows: Array<SavedWordRow & { memoryState: MemoryState }> = [];
  const affectedUserIds = new Set<string>();

  for (const row of savedWords) {
    const state = statesByKey.get(keyFor(row.user_id, row.vocabulary_item_id));
    if (!state) {
      missingReviewStateRows.push(row);
      affectedUserIds.add(row.user_id);
      continue;
    }

    if (state.memory_state !== 'new') {
      nonNewSavedRows.push({ ...row, memoryState: state.memory_state });
      affectedUserIds.add(row.user_id);
    }
  }

  const affectedGroups = await fetchAffectedPendingCustomGroups(nonNewSavedRows);

  let createdReviewStates = missingReviewStateRows.length;
  let removedSavedWords = nonNewSavedRows.length;
  let deletedCustomGroups = affectedGroups.groupIds.length;

  if (apply) {
    createdReviewStates = await upsertMissingReviewStates(missingReviewStateRows);
    deletedCustomGroups = await deleteLearningGroups(affectedGroups.groupIds);
    removedSavedWords = await deleteSavedWords(nonNewSavedRows);
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    usersInspected: userIds.size,
    affectedUsers: affectedUserIds.size,
    savedWordsInspected: savedWords.length,
    createdReviewStates,
    removedSavedWords,
    deletedCustomGroups,
    missingReviewStateSavedWords: missingReviewStateRows.length,
    nonNewSavedWords: nonNewSavedRows.length,
    samples: {
      createdReviewStates: missingReviewStateRows.slice(0, sampleLimit).map((row) => ({
        userId: row.user_id,
        vocabularyItemId: row.vocabulary_item_id,
        savedWordId: row.id,
        source: row.source,
        savedAt: row.saved_at,
        memoryState: 'missing',
      })),
      removedSavedWords: nonNewSavedRows.slice(0, sampleLimit).map((row) => ({
        userId: row.user_id,
        vocabularyItemId: row.vocabulary_item_id,
        savedWordId: row.id,
        source: row.source,
        savedAt: row.saved_at,
        memoryState: row.memoryState,
      })),
      deletedCustomGroups: affectedGroups.samples.slice(0, sampleLimit),
    },
  };
}
