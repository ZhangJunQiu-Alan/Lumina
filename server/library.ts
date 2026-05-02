import { supabaseAdmin } from './supabase.js';
import { intervalForState, toNextReviewAt, type MemoryState, type ReviewResultType } from './review-domain.js';
import { queueFullEnrichmentForVocabularyItemId } from './vocab.js';
import {
  isOfficialLibraryId,
  resolveLibraryGroupSourceType,
  resolveOfficialLibraryId,
} from '../src/lib/officialLibrary.js';
import { isCoreLearningComplete } from '../src/lib/learningSession.js';
import type { OfficialLibraryId } from '../src/types.js';
import {
  isOfficialDiscardableRound,
  resolveActuallyLearnedWordIds,
} from '../shared/officialDiscard.js';

interface GroupWordRow {
  vocabulary_item_id: string;
  sequence_no?: number | null;
}

interface SharedWordRow {
  vocabulary_item_id: string;
}

interface LearningGroupDiscardRow {
  id: string;
  group_name: string | null;
  source_type: 'custom' | 'system' | null;
  library_id: string | null;
  created_at: string;
  status: 'active' | 'completed' | null;
  completed_at: string | null;
  session_round: string | null;
  session_current_index: number | null;
  session_queue_word_ids: unknown;
}

function isSystemLibraryGroup(sourceType: string | null, libraryId: string | null, groupName: string | null) {
  return resolveLibraryGroupSourceType(
    sourceType === 'system' ? 'system' : sourceType === 'custom' ? 'custom' : null,
    libraryId,
    groupName,
  ) === 'system';
}

export interface DeleteLearningGroupResult {
  deletedGroupId: string;
  deletedWordCount: number;
  removedReviewStateCount: number;
}

export interface DiscardActiveOfficialLearningGroupInput {
  libraryId: OfficialLibraryId;
  groupId: string;
  timeZone?: string | null;
}

export interface DiscardActiveOfficialLearningGroupResult {
  discardedGroupId: string;
  preservedWordCount: number;
  forcedFuzzyWordCount: number;
  removedUnlearnedWordCount: number;
  removedReviewStateCount: number;
}

export type SavedWordSource = 'reading_popup' | 'manual';

export interface SaveWordToLibraryResult {
  vocabularyItemId: string;
  inserted: boolean;
  saved: boolean;
  fullEnrichmentQueued: boolean;
  skippedReason?: 'non_new_state';
}

export interface RemoveWordFromLibraryResult {
  vocabularyItemId: string;
  removed: boolean;
}

interface ReviewStateRow {
  vocabulary_item_id: string;
  memory_state: MemoryState;
  review_count: number | null;
  lapse_count: number | null;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  ease_factor: number | null;
  graduated_at: string | null;
  last_result: ReviewResultType | null;
  last_elapsed_ms: number | null;
  last_assessed_at: string | null;
}

interface ReviewEventWordRow {
  vocabulary_item_id: string;
}

interface DailyRoutineProgressRow {
  id: string;
  step_order_json: unknown;
  completed_steps_json: unknown;
}

type RoutineStepKey = 'review' | 'round1' | 'round2';

const ROUTINE_STEPS: RoutineStepKey[] = ['review', 'round1', 'round2'];

function isRoutineStepKey(value: unknown): value is RoutineStepKey {
  return typeof value === 'string' && ROUTINE_STEPS.includes(value as RoutineStepKey);
}

function normalizeRoutineSteps(value: unknown): RoutineStepKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRoutineStepKey);
}

function resolveRoutineStatus(stepOrder: RoutineStepKey[], completedSteps: RoutineStepKey[]) {
  if (stepOrder.length > 0 && stepOrder.every((step) => completedSteps.includes(step))) {
    return 'completed';
  }

  if (completedSteps.length > 0) {
    return 'in_progress';
  }

  return 'not_started';
}

function resolveTimeZone(timeZone?: string | null) {
  if (!timeZone) return 'UTC';

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function resolveLocalDate(timeZone?: string | null) {
  const safeTimeZone = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function isMissingDailyRoutineProgressError(error: { message?: string } | null | undefined) {
  return (error?.message ?? '').includes('daily_routine_progress');
}

function isStrongerThanNew(state: MemoryState | null | undefined) {
  return state === 'fuzzy'
    || state === 'slow_recall'
    || state === 'stable_recall'
    || state === 'mastered';
}

export async function deleteLearningGroup(userId: string, groupId: string): Promise<DeleteLearningGroupResult> {
  const { data: group, error: groupError } = await supabaseAdmin
    .from('learning_groups')
    .select('id, source_type, library_id, group_name')
    .eq('id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (groupError) {
    throw new Error(`learning_groups lookup failed: ${groupError.message}`);
  }

  if (!group) {
    throw new Error('这组词不存在，或它不属于你。');
  }

  if (isSystemLibraryGroup(group.source_type, group.library_id, group.group_name)) {
    throw new Error('系统词库暂时不支持删除。');
  }

  const { data: groupWords, error: groupWordsError } = await supabaseAdmin
    .from('learning_group_words')
    .select('vocabulary_item_id')
    .eq('learning_group_id', groupId);

  if (groupWordsError) {
    throw new Error(`learning_group_words lookup failed: ${groupWordsError.message}`);
  }

  const targetWordIds = Array.from(
    new Set(((groupWords ?? []) as GroupWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean)),
  );

  let removedReviewStateCount = 0;

  if (targetWordIds.length > 0) {
    const { data: sharedWords, error: sharedWordsError } = await supabaseAdmin
      .from('learning_group_words')
      .select('vocabulary_item_id, learning_groups!inner(user_id)')
      .in('vocabulary_item_id', targetWordIds)
      .neq('learning_group_id', groupId)
      .eq('learning_groups.user_id', userId);

    if (sharedWordsError) {
      throw new Error(`shared learning_group_words lookup failed: ${sharedWordsError.message}`);
    }

    const sharedWordIds = new Set(
      ((sharedWords ?? []) as SharedWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean),
    );
    const orphanWordIds = targetWordIds.filter((wordId) => !sharedWordIds.has(wordId));

    if (orphanWordIds.length > 0) {
      const { error: reviewEventsError } = await supabaseAdmin
        .from('review_events')
        .delete()
        .eq('user_id', userId)
        .in('vocabulary_item_id', orphanWordIds);

      if (reviewEventsError) {
        throw new Error(`review_events delete failed: ${reviewEventsError.message}`);
      }

      const { error: reviewStatesError, count } = await supabaseAdmin
        .from('review_states')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .in('vocabulary_item_id', orphanWordIds);

      if (reviewStatesError) {
        throw new Error(`review_states delete failed: ${reviewStatesError.message}`);
      }

      removedReviewStateCount = count ?? 0;
    }
  }

  const { error: deleteGroupError } = await supabaseAdmin
    .from('learning_groups')
    .delete()
    .eq('id', groupId)
    .eq('user_id', userId);

  if (deleteGroupError) {
    throw new Error(`learning_groups delete failed: ${deleteGroupError.message}`);
  }

  return {
    deletedGroupId: groupId,
    deletedWordCount: targetWordIds.length,
    removedReviewStateCount,
  };
}

export async function saveWordToLibrary(
  userId: string,
  vocabularyItemId: string,
  source: SavedWordSource = 'reading_popup',
): Promise<SaveWordToLibraryResult> {
  const savedWordState = await ensureWordIsNewForSavedLibrary(userId, vocabularyItemId);
  if (!savedWordState.allowed) {
    const { error: cleanupError } = await supabaseAdmin
      .from('user_saved_words')
      .delete()
      .eq('user_id', userId)
      .eq('vocabulary_item_id', vocabularyItemId);

    if (cleanupError) {
      throw new Error(`user_saved_words non-new cleanup failed: ${cleanupError.message}`);
    }

    return {
      vocabularyItemId,
      inserted: false,
      saved: false,
      fullEnrichmentQueued: false,
      skippedReason: 'non_new_state',
    };
  }

  const queueResult = await queueFullEnrichmentForVocabularyItemId(vocabularyItemId, source);
  if (queueResult.reason === 'not_found') {
    throw new Error('这个词条不存在，无法加入词库。');
  }

  const { data, error } = await supabaseAdmin
    .from('user_saved_words')
    .upsert(
      {
        user_id: userId,
        vocabulary_item_id: vocabularyItemId,
        source,
      },
      { onConflict: 'user_id,vocabulary_item_id', ignoreDuplicates: true },
    )
    .select('id');

  if (error) {
    throw new Error(`user_saved_words upsert failed: ${error.message}`);
  }

  return {
    vocabularyItemId,
    inserted: (data?.length ?? 0) > 0,
    saved: true,
    fullEnrichmentQueued: queueResult.queued,
  };
}

export async function removeWordFromLibrary(
  userId: string,
  vocabularyItemId: string,
): Promise<RemoveWordFromLibraryResult> {
  const { error, count } = await supabaseAdmin
    .from('user_saved_words')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('vocabulary_item_id', vocabularyItemId);

  if (error) {
    throw new Error(`user_saved_words delete failed: ${error.message}`);
  }

  return {
    vocabularyItemId,
    removed: (count ?? 0) > 0,
  };
}

async function fetchDiscardGroup(userId: string, groupId: string) {
  const { data, error } = await supabaseAdmin
    .from('learning_groups')
    .select(`
      id,
      group_name,
      source_type,
      library_id,
      created_at,
      status,
      completed_at,
      session_round,
      session_current_index,
      session_queue_word_ids
    `)
    .eq('id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`learning_groups lookup failed: ${error.message}`);
  }

  return (data as LearningGroupDiscardRow | null) ?? null;
}

async function fetchGroupWordIds(groupId: string) {
  const { data, error } = await supabaseAdmin
    .from('learning_group_words')
    .select('vocabulary_item_id, sequence_no')
    .eq('learning_group_id', groupId)
    .order('sequence_no', { ascending: true });

  if (error) {
    throw new Error(`learning_group_words lookup failed: ${error.message}`);
  }

  return ((data ?? []) as GroupWordRow[])
    .map((row) => row.vocabulary_item_id)
    .filter(Boolean);
}

async function ensureWordIsNewForSavedLibrary(userId: string, vocabularyItemId: string) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('review_states')
    .select('memory_state')
    .eq('user_id', userId)
    .eq('vocabulary_item_id', vocabularyItemId)
    .maybeSingle<{ memory_state: MemoryState }>();

  if (existingError) {
    throw new Error(`review_states lookup failed: ${existingError.message}`);
  }

  if (existing?.memory_state && existing.memory_state !== 'new') {
    return { allowed: false, created: false };
  }

  if (existing?.memory_state === 'new') {
    return { allowed: true, created: false };
  }

  const { error: upsertError } = await supabaseAdmin
    .from('review_states')
    .upsert(
      {
        user_id: userId,
        vocabulary_item_id: vocabularyItemId,
        memory_state: 'new',
        interval_days: null,
        next_review_at: null,
        graduated_at: null,
      },
      {
        onConflict: 'user_id,vocabulary_item_id',
        ignoreDuplicates: true,
      },
    );

  if (upsertError) {
    throw new Error(`review_states saved-word upsert failed: ${upsertError.message}`);
  }

  const { data: current, error: currentError } = await supabaseAdmin
    .from('review_states')
    .select('memory_state')
    .eq('user_id', userId)
    .eq('vocabulary_item_id', vocabularyItemId)
    .maybeSingle<{ memory_state: MemoryState }>();

  if (currentError) {
    throw new Error(`review_states lookup failed: ${currentError.message}`);
  }

  return {
    allowed: (current?.memory_state ?? 'new') === 'new',
    created: true,
  };
}

async function fetchRound2AttemptWordIds(userId: string, groupId: string) {
  const { data, error } = await supabaseAdmin
    .from('review_events')
    .select('vocabulary_item_id')
    .eq('user_id', userId)
    .eq('learning_group_id', groupId)
    .eq('source', 'round2');

  if (error) {
    throw new Error(`review_events lookup failed: ${error.message}`);
  }

  return ((data ?? []) as ReviewEventWordRow[])
    .map((row) => row.vocabulary_item_id)
    .filter(Boolean);
}

async function forceMissingLearnedWordsToFuzzy(userId: string, learnedWordIds: string[], now: Date) {
  if (learnedWordIds.length === 0) return 0;

  const { data, error } = await supabaseAdmin
    .from('review_states')
    .select(`
      vocabulary_item_id,
      memory_state,
      review_count,
      lapse_count,
      last_reviewed_at,
      next_review_at,
      ease_factor,
      graduated_at,
      last_result,
      last_elapsed_ms,
      last_assessed_at
    `)
    .eq('user_id', userId)
    .in('vocabulary_item_id', learnedWordIds);

  if (error) {
    throw new Error(`review_states lookup failed: ${error.message}`);
  }

  const existingByWordId = new Map(
    ((data ?? []) as ReviewStateRow[]).map((row) => [row.vocabulary_item_id, row]),
  );
  const nextReviewAt = toNextReviewAt('fuzzy', now);
  const rows = learnedWordIds
    .map((wordId) => {
      const existing = existingByWordId.get(wordId);
      if (isStrongerThanNew(existing?.memory_state)) {
        return null;
      }

      return {
        user_id: userId,
        vocabulary_item_id: wordId,
        ease_factor: existing?.ease_factor ?? 2.5,
        interval_days: intervalForState('fuzzy'),
        last_reviewed_at: existing?.last_reviewed_at ?? null,
        next_review_at: nextReviewAt,
        review_count: existing?.review_count ?? 0,
        lapse_count: existing?.lapse_count ?? 0,
        memory_state: 'fuzzy',
        last_result: existing?.last_result ?? null,
        last_elapsed_ms: existing?.last_elapsed_ms ?? null,
        last_assessed_at: now.toISOString(),
        graduated_at: null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (rows.length === 0) return 0;

  const { error: upsertError } = await supabaseAdmin
    .from('review_states')
    .upsert(rows, { onConflict: 'user_id,vocabulary_item_id' });

  if (upsertError) {
    throw new Error(`review_states upsert failed: ${upsertError.message}`);
  }

  return rows.length;
}

async function findUnsharedWordIds(userId: string, groupId: string, wordIds: string[]) {
  if (wordIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('learning_group_words')
    .select('vocabulary_item_id, learning_groups!inner(user_id)')
    .in('vocabulary_item_id', wordIds)
    .neq('learning_group_id', groupId)
    .eq('learning_groups.user_id', userId);

  if (error) {
    throw new Error(`shared learning_group_words lookup failed: ${error.message}`);
  }

  const sharedWordIds = new Set(
    ((data ?? []) as SharedWordRow[]).map((row) => row.vocabulary_item_id).filter(Boolean),
  );

  return wordIds.filter((wordId) => !sharedWordIds.has(wordId));
}

async function deleteReviewDataForWords(userId: string, wordIds: string[]) {
  if (wordIds.length === 0) return 0;

  const { error: eventsError } = await supabaseAdmin
    .from('review_events')
    .delete()
    .eq('user_id', userId)
    .in('vocabulary_item_id', wordIds);

  if (eventsError) {
    throw new Error(`review_events delete failed: ${eventsError.message}`);
  }

  const { error: statesError, count } = await supabaseAdmin
    .from('review_states')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .in('vocabulary_item_id', wordIds);

  if (statesError) {
    throw new Error(`review_states delete failed: ${statesError.message}`);
  }

  return count ?? 0;
}

async function clearTodayRoutineBinding(userId: string, groupId: string, timeZone?: string | null) {
  const localDate = resolveLocalDate(timeZone);
  const { data, error } = await supabaseAdmin
    .from('daily_routine_progress')
    .select('id, step_order_json, completed_steps_json')
    .eq('user_id', userId)
    .eq('local_date', localDate)
    .eq('main_learning_group_id', groupId)
    .maybeSingle();

  if (error) {
    if (isMissingDailyRoutineProgressError(error)) return;
    throw new Error(`daily_routine_progress lookup failed: ${error.message}`);
  }

  const row = (data as DailyRoutineProgressRow | null) ?? null;
  if (!row) return;

  const stepOrder = normalizeRoutineSteps(row.step_order_json);
  const completedSteps = normalizeRoutineSteps(row.completed_steps_json)
    .filter((step) => step === 'review' && stepOrder.includes(step));
  const status = resolveRoutineStatus(stepOrder, completedSteps);

  const { error: updateError } = await supabaseAdmin
    .from('daily_routine_progress')
    .update({
      main_learning_group_id: null,
      completed_steps_json: completedSteps,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  if (updateError) {
    if (isMissingDailyRoutineProgressError(updateError)) return;
    throw new Error(`daily_routine_progress update failed: ${updateError.message}`);
  }
}

export async function discardActiveOfficialLearningGroup(
  userId: string,
  input: DiscardActiveOfficialLearningGroupInput,
): Promise<DiscardActiveOfficialLearningGroupResult> {
  if (!isOfficialLibraryId(input.libraryId)) {
    throw new Error('未知官方词库。');
  }

  const group = await fetchDiscardGroup(userId, input.groupId);
  if (!group) {
    throw new Error('这组词不存在，或它不属于你。');
  }

  const resolvedLibraryId = resolveOfficialLibraryId(group.library_id, group.group_name, group.source_type);
  if (resolvedLibraryId !== input.libraryId) {
    throw new Error('这组词不属于当前官方路径。');
  }

  if (
    !isOfficialDiscardableRound(group.session_round)
    || isCoreLearningComplete({
      status: group.status,
      completedAt: group.completed_at,
      sessionRound: group.session_round,
    })
  ) {
    throw new Error('只能切换未完成的官方主线学习组。');
  }

  const [groupWordIds, round2AttemptWordIds] = await Promise.all([
    fetchGroupWordIds(group.id),
    fetchRound2AttemptWordIds(userId, group.id),
  ]);
  const groupWordIdSet = new Set(groupWordIds);
  const learnedWordIds = resolveActuallyLearnedWordIds({
    round: group.session_round,
    currentIndex: group.session_current_index,
    queueWordIds: group.session_queue_word_ids,
    fallbackWordIds: groupWordIds,
    round2AttemptWordIds,
  }).filter((wordId) => groupWordIdSet.has(wordId));
  const learnedWordIdSet = new Set(learnedWordIds);
  const unlearnedWordIds = groupWordIds.filter((wordId) => !learnedWordIdSet.has(wordId));

  const [forcedFuzzyWordCount, unsharedUnlearnedWordIds] = await Promise.all([
    forceMissingLearnedWordsToFuzzy(userId, learnedWordIds, new Date()),
    findUnsharedWordIds(userId, group.id, unlearnedWordIds),
  ]);
  const removedReviewStateCount = await deleteReviewDataForWords(userId, unsharedUnlearnedWordIds);

  await clearTodayRoutineBinding(userId, group.id, input.timeZone);

  const { error: deleteGroupError } = await supabaseAdmin
    .from('learning_groups')
    .delete()
    .eq('id', group.id)
    .eq('user_id', userId);

  if (deleteGroupError) {
    throw new Error(`learning_groups delete failed: ${deleteGroupError.message}`);
  }

  return {
    discardedGroupId: group.id,
    preservedWordCount: learnedWordIds.length,
    forcedFuzzyWordCount,
    removedUnlearnedWordCount: unsharedUnlearnedWordIds.length,
    removedReviewStateCount,
  };
}
