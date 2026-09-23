import { getUserReviewTimeZone } from './review-timezone.ts';
import { toNextReviewAt } from './review-domain.ts';
import {
  formatOfficialCounterGroupName,
  isOfficialLibraryId,
  resolveOfficialLibraryId,
  resolveOfficialStudyModeFromGroupName,
} from '../officialLibraryLite.ts';
import { normalizeRound2ChoiceDistractors } from '../round2ChoiceDistractors.ts';
import type { MemoryState, OfficialLibraryId, OfficialStudyMode, Round2ChoiceDistractor } from '../types.ts';
import { supabaseAdmin } from './supabase.ts';

const ROUND1_BATCH_SIZE = 30;
const ROUTINE_DAY_RESET_HOUR = 5;
const REVIEW_DAY_THRESHOLD = 50;
const QUERY_CHUNK_SIZE = 100;
const CORE_ROUNDS = ['round1', 'round2', 'round3'] as const;
const ROUTINE_STEPS = ['review', 'round1', 'round2', 'round3'] as const;

type CoreLearningRound = (typeof CORE_ROUNDS)[number];
type RoutineStep = (typeof ROUTINE_STEPS)[number];

interface LearningGroupRow {
  id: string;
  group_name: string | null;
  source_type: 'custom' | 'system' | null;
  library_id: string | null;
  status: 'active' | 'completed' | null;
  created_at: string;
  completed_at: string | null;
  session_round: string | null;
  session_current_index: number | null;
  session_queue_word_ids: unknown;
  session_passed_queue_indices: unknown;
  session_round1_confirmed_word_ids: unknown;
  session_last_active_at: string | null;
}

interface LearningSenseRow {
  pos: string | null;
  meaning_zh: string | null;
  example_sentence: string | null;
  example_translation_zh: string | null;
}

interface LearningMorphologyPartRow {
  part_text: string | null;
  part_kind: 'prefix' | 'root' | 'suffix' | null;
  meaning_zh: string | null;
  note_zh: string | null;
  sort_order: number | null;
}

interface LearningRelationRow {
  relation_type: 'derived' | 'synonym' | 'antonym' | null;
  related_word: string | null;
  meaning_zh: string | null;
  note_zh: string | null;
  sort_order: number | null;
}

interface LearningConfusionRow {
  confused_word: string | null;
  difference_note_zh: string | null;
  sort_order: number | null;
}

interface LearningVocabularyItemRow {
  id: string;
  word: string;
  ipa_uk: string | null;
  ipa_us: string | null;
  primary_meaning_zh: string | null;
  morphology_summary_zh: string | null;
  memory_tip: string | null;
  round2_choice_distractors: unknown;
  vocabulary_senses: LearningSenseRow[] | null;
  vocabulary_morphology_parts: LearningMorphologyPartRow[] | null;
  vocabulary_relations: LearningRelationRow[] | null;
  confused_words: LearningConfusionRow[] | null;
}

interface LearningGroupWordRow {
  vocabulary_item_id: string;
  sequence_no: number | null;
  vocabulary_items: LearningVocabularyItemRow | LearningVocabularyItemRow[] | null;
}

interface UserLearningSettingsRow {
  round2_enabled: boolean | null;
  reinforcement_round3_enabled: boolean | null;
}

interface ReviewStateActivationRow {
  vocabulary_item_id: string;
  memory_state: MemoryState;
  next_review_at: string | null;
}

interface DailyRoutineRow {
  id: string;
  main_learning_group_id: string | null;
  step_order_json: unknown;
  completed_steps_json: unknown;
  status: 'not_started' | 'in_progress' | 'completed' | null;
}

export interface LearningWordPayload {
  id: string;
  word: string;
  phonetic: string;
  ipaUk: string;
  ipaUs: string;
  meaning: string;
  memoryTip: string;
  posTags: string[];
  senses: Array<{
    pos: string;
    meaning: string;
    exampleSentence: string;
    exampleTranslation: string;
  }>;
  morphologySummary: string;
  morphologyParts: Array<{
    text: string;
    kind: 'prefix' | 'root' | 'suffix';
    meaning: string;
    note: string;
  }>;
  derivedWords: Array<{ word: string; meaning: string; note: string }>;
  synonyms: Array<{ word: string; meaning: string; note: string }>;
  antonyms: Array<{ word: string; meaning: string; note: string }>;
  confusingPairs: Array<{ word: string; difference: string }>;
  round2ChoiceDistractors: Round2ChoiceDistractor[];
}

export interface LearningSessionSnapshotPayload {
  round: CoreLearningRound;
  currentIndex: number;
  queueWordIds: string[];
  passedQueueIndices: number[];
  round1ConfirmedWordIds: string[];
}

export interface LearningSessionPayload {
  group: {
    id: string;
    title: string;
    sourceType: 'custom' | 'system';
    libraryId: OfficialLibraryId | null;
    officialMode: OfficialStudyMode | null;
    status: 'active' | 'completed';
  };
  session: LearningSessionSnapshotPayload | null;
  words: LearningWordPayload[];
  preferences: {
    recallEnabled: boolean;
    dictationEnabled: boolean;
  };
  completed: boolean;
}

export interface SaveLearningSessionInput {
  round: CoreLearningRound;
  currentIndex: number;
  queueWordIds: string[];
  passedQueueIndices?: number[];
  round1ConfirmedWordIds?: string[];
  timeZone?: string | null;
}

export interface CompleteLearningRoundInput {
  round: CoreLearningRound;
  confirmedWordIds?: string[];
  timeZone?: string | null;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isCoreRound(value: unknown): value is CoreLearningRound {
  return typeof value === 'string' && CORE_ROUNDS.includes(value as CoreLearningRound);
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function normalizeQueue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function normalizePassedIndices(value: unknown, currentIndex: number, queueLength: number) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (entry): entry is number =>
          typeof entry === 'number' &&
          Number.isInteger(entry) &&
          entry >= 0 &&
          entry < Math.min(Math.max(currentIndex, 0), queueLength),
      ),
    ),
  ].sort((left, right) => left - right);
}

function clampIndex(value: number, queueLength: number) {
  if (queueLength <= 0 || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), queueLength - 1);
}

function normalizeTimeZone(value?: string | null) {
  const candidate = value?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

function resolveRoutineDate(timeZone?: string | null) {
  const safeTimeZone = normalizeTimeZone(timeZone);
  const shifted = new Date(Date.now() - ROUTINE_DAY_RESET_HOUR * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function normalizeRoutineSteps(value: unknown): RoutineStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is RoutineStep => typeof entry === 'string' && ROUTINE_STEPS.includes(entry as RoutineStep),
  );
}

function buildRoutineStepOrder(dueCount: number): RoutineStep[] {
  if (dueCount > REVIEW_DAY_THRESHOLD) return ['review'];
  if (dueCount > 0) return ['review', 'round1', 'round2', 'round3'];
  return ['round1', 'round2', 'round3'];
}

function mergeRoutineSteps(stepOrder: RoutineStep[], current: RoutineStep[], additions: RoutineStep[]) {
  const selected = new Set([...current, ...additions]);
  return stepOrder.filter((step) => selected.has(step));
}

function routineStatus(stepOrder: RoutineStep[], completed: RoutineStep[], groupId: string | null) {
  if (stepOrder.length > 0 && stepOrder.every((step) => completed.includes(step))) return 'completed';
  if (completed.length > 0 || groupId) return 'in_progress';
  return 'not_started';
}

function relationPayload(rows: LearningRelationRow[], type: LearningRelationRow['relation_type']) {
  return [...rows]
    .filter((row) => row.relation_type === type)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((row) => ({
      word: row.related_word?.trim() ?? '',
      meaning: row.meaning_zh?.trim() ?? '',
      note: row.note_zh?.trim() ?? '',
    }))
    .filter((row) => row.word);
}

function mapLearningWord(row: LearningGroupWordRow): LearningWordPayload | null {
  const item = asArray(row.vocabulary_items)[0];
  if (!item) return null;
  const senses = item.vocabulary_senses ?? [];
  const relations = item.vocabulary_relations ?? [];

  return {
    id: item.id,
    word: item.word,
    phonetic: item.ipa_uk ?? '',
    ipaUk: item.ipa_uk ?? '',
    ipaUs: item.ipa_us ?? '',
    meaning: item.primary_meaning_zh ?? '',
    memoryTip: item.memory_tip ?? '',
    posTags: senses.map((sense) => sense.pos?.trim() ?? '').filter(Boolean),
    senses: senses.map((sense) => ({
      pos: sense.pos ?? '',
      meaning: sense.meaning_zh ?? '',
      exampleSentence: sense.example_sentence ?? '',
      exampleTranslation: sense.example_translation_zh ?? '',
    })),
    morphologySummary: item.morphology_summary_zh ?? '',
    morphologyParts: [...(item.vocabulary_morphology_parts ?? [])]
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((part) => ({
        text: part.part_text ?? '',
        kind: part.part_kind ?? 'root',
        meaning: part.meaning_zh ?? '',
        note: part.note_zh ?? '',
      })),
    derivedWords: relationPayload(relations, 'derived'),
    synonyms: relationPayload(relations, 'synonym'),
    antonyms: relationPayload(relations, 'antonym'),
    confusingPairs: [...(item.confused_words ?? [])]
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((pair) => ({
        word: pair.confused_word?.trim() ?? '',
        difference: pair.difference_note_zh?.trim() ?? '',
      }))
      .filter((pair) => pair.word),
    round2ChoiceDistractors: normalizeRound2ChoiceDistractors(item.round2_choice_distractors),
  };
}

async function fetchLearningGroup(userId: string, groupId: string) {
  const { data, error } = await supabaseAdmin
    .from('learning_groups')
    .select(
      `
      id,
      group_name,
      source_type,
      library_id,
      status,
      created_at,
      completed_at,
      session_round,
      session_current_index,
      session_queue_word_ids,
      session_passed_queue_indices,
      session_round1_confirmed_word_ids,
      session_last_active_at
    `,
    )
    .eq('id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`learning group lookup failed: ${error.message}`);
  return (data as LearningGroupRow | null) ?? null;
}

async function fetchLearningWords(groupId: string) {
  const rows: LearningGroupWordRow[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabaseAdmin
      .from('learning_group_words')
      .select(
        `
      vocabulary_item_id,
      sequence_no,
      vocabulary_items!inner (
        id,
        word,
        ipa_uk,
        ipa_us,
        primary_meaning_zh,
        morphology_summary_zh,
        memory_tip,
        round2_choice_distractors,
        vocabulary_senses (
          pos,
          meaning_zh,
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
      .eq('learning_group_id', groupId)
      .order('sequence_no', { ascending: true })
      .range(offset, offset + 199);

    if (error) throw new Error(`learning group words lookup failed: ${error.message}`);
    const batch = (data ?? []) as unknown as LearningGroupWordRow[];
    rows.push(...batch);
    if (batch.length < 200) break;
  }
  return rows.map(mapLearningWord).filter(Boolean) as LearningWordPayload[];
}

async function fetchLearningPreferences(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .select('round2_enabled, reinforcement_round3_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (error && !error.message.includes('user_settings')) {
    throw new Error(`user settings lookup failed: ${error.message}`);
  }

  const settings = (data as UserLearningSettingsRow | null) ?? null;
  return {
    recallEnabled: settings?.reinforcement_round3_enabled ?? true,
    dictationEnabled: settings?.round2_enabled ?? true,
  };
}

function buildSnapshot(group: LearningGroupRow, words: LearningWordPayload[]): LearningSessionSnapshotPayload | null {
  if (group.status === 'completed' || group.completed_at) return null;
  const wordIds = words.map((word) => word.id);
  const availableIds = new Set(wordIds);
  const round = isCoreRound(group.session_round) ? group.session_round : 'round1';
  const storedConfirmed = normalizeStringArray(group.session_round1_confirmed_word_ids).filter((id) =>
    availableIds.has(id),
  );
  const scopedIds = round === 'round1' || storedConfirmed.length === 0 ? wordIds : storedConfirmed;
  const storedQueue = normalizeQueue(group.session_queue_word_ids).filter((id) => availableIds.has(id));
  const queueWordIds = storedQueue.length > 0 ? storedQueue : scopedIds;
  const currentIndex = clampIndex(group.session_current_index ?? 0, queueWordIds.length);

  return {
    round,
    currentIndex,
    queueWordIds,
    passedQueueIndices: normalizePassedIndices(group.session_passed_queue_indices, currentIndex, queueWordIds.length),
    round1ConfirmedWordIds: storedConfirmed,
  };
}

async function ensureRoutine(userId: string, timeZone?: string | null) {
  const safeTimeZone = normalizeTimeZone(timeZone);
  const localDate = resolveRoutineDate(safeTimeZone);
  const existing = await supabaseAdmin
    .from('daily_routine_progress')
    .select('id, main_learning_group_id, step_order_json, completed_steps_json, status')
    .eq('user_id', userId)
    .eq('local_date', localDate)
    .maybeSingle();

  if (existing.error) {
    if (existing.error.message.includes('daily_routine_progress')) return null;
    throw new Error(`daily routine lookup failed: ${existing.error.message}`);
  }
  if (existing.data) return existing.data as DailyRoutineRow;

  const dueResult = await supabaseAdmin
    .from('review_states')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('memory_state', 'mastered')
    .not('next_review_at', 'is', null)
    .lte('next_review_at', new Date().toISOString());
  if (dueResult.error) throw new Error(`due review count failed: ${dueResult.error.message}`);
  const dueCount = dueResult.count ?? 0;
  const stepOrder = buildRoutineStepOrder(dueCount);
  const inserted = await supabaseAdmin
    .from('daily_routine_progress')
    .upsert(
      {
        user_id: userId,
        local_date: localDate,
        timezone: safeTimeZone,
        day_kind: dueCount > REVIEW_DAY_THRESHOLD ? 'review_day' : 'learning_day',
        starting_due_count: dueCount,
        step_order_json: stepOrder,
        completed_steps_json: [],
        status: 'not_started',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,local_date', ignoreDuplicates: true },
    )
    .select('id, main_learning_group_id, step_order_json, completed_steps_json, status')
    .maybeSingle();

  if (inserted.error) {
    if (inserted.error.message.includes('daily_routine_progress')) return null;
    throw new Error(`daily routine insert failed: ${inserted.error.message}`);
  }
  if (inserted.data) return inserted.data as DailyRoutineRow;

  const refetched = await supabaseAdmin
    .from('daily_routine_progress')
    .select('id, main_learning_group_id, step_order_json, completed_steps_json, status')
    .eq('user_id', userId)
    .eq('local_date', localDate)
    .maybeSingle();
  if (refetched.error) throw new Error(`daily routine refetch failed: ${refetched.error.message}`);
  return (refetched.data as DailyRoutineRow | null) ?? null;
}

async function updateRoutine(userId: string, groupId: string, additions: RoutineStep[], timeZone?: string | null) {
  const routine = await ensureRoutine(userId, timeZone);
  if (!routine) return;
  const stepOrder = normalizeRoutineSteps(routine.step_order_json);
  const completed = mergeRoutineSteps(stepOrder, normalizeRoutineSteps(routine.completed_steps_json), additions);
  const { error } = await supabaseAdmin
    .from('daily_routine_progress')
    .update({
      main_learning_group_id: groupId,
      completed_steps_json: completed,
      status: routineStatus(stepOrder, completed, groupId),
      updated_at: new Date().toISOString(),
    })
    .eq('id', routine.id);
  if (error) throw new Error(`daily routine update failed: ${error.message}`);
}

async function persistSnapshot(
  userId: string,
  groupId: string,
  input: SaveLearningSessionInput,
  validWordIds: Set<string>,
) {
  if (!isCoreRound(input.round)) throw new Error('未知学习轮次。');
  if (input.queueWordIds.length === 0) throw new Error('学习队列不能为空。');
  if (input.queueWordIds.some((id) => !validWordIds.has(id))) throw new Error('学习队列包含不属于本组的单词。');

  const confirmed = normalizeStringArray(input.round1ConfirmedWordIds).filter((id) => validWordIds.has(id));
  const queue = normalizeQueue(input.queueWordIds);
  const currentIndex = clampIndex(input.currentIndex, queue.length);
  const { error } = await supabaseAdmin
    .from('learning_groups')
    .update({
      status: 'active',
      completed_at: null,
      session_round: input.round,
      session_current_index: currentIndex,
      session_queue_word_ids: queue,
      session_passed_queue_indices: normalizePassedIndices(input.passedQueueIndices, currentIndex, queue.length),
      session_round1_confirmed_word_ids: confirmed,
      session_last_active_at: new Date().toISOString(),
    })
    .eq('id', groupId)
    .eq('user_id', userId)
    .neq('status', 'completed');
  if (error) throw new Error(`learning session update failed: ${error.message}`);
}

async function markGroupWordProgress(
  userId: string,
  groupId: string,
  wordIds: string[],
  round: CoreLearningRound,
  preferences: { recallEnabled: boolean; dictationEnabled: boolean },
) {
  const uniqueIds = normalizeStringArray(wordIds);
  if (uniqueIds.length === 0) return;
  const timestamp = new Date().toISOString();
  const payload =
    round === 'round1'
      ? {
          round1_confirmed_at: timestamp,
          round2_required: preferences.recallEnabled,
          round3_required: preferences.dictationEnabled,
        }
      : round === 'round2'
        ? { round2_completed_at: timestamp }
        : { round3_completed_at: timestamp };

  for (let offset = 0; offset < uniqueIds.length; offset += QUERY_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(offset, offset + QUERY_CHUNK_SIZE);
    const { data, error } = await supabaseAdmin
      .from('learning_group_words')
      .update(payload)
      .eq('learning_group_id', groupId)
      .in('vocabulary_item_id', chunk)
      .select('vocabulary_item_id');
    if (error) throw new Error(`learning word progress update failed: ${error.message}`);
    if ((data ?? []).length !== chunk.length) throw new Error('有些单词不属于当前学习组。');
  }

  const learnedNow =
    (round === 'round1' && !preferences.recallEnabled && !preferences.dictationEnabled) ||
    (round === 'round2' && !preferences.dictationEnabled) ||
    round === 'round3';
  if (!learnedNow) return;

  for (let offset = 0; offset < uniqueIds.length; offset += QUERY_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(offset, offset + QUERY_CHUNK_SIZE);
    const { error } = await supabaseAdmin
      .from('learning_group_words')
      .update({ learned_at: timestamp })
      .eq('learning_group_id', groupId)
      .in('vocabulary_item_id', chunk);
    if (error) throw new Error(`learning word learned update failed: ${error.message}`);
  }

  await activateReviewStates(userId, uniqueIds, timestamp);
}

async function activateReviewStates(userId: string, wordIds: string[], timestamp: string) {
  const existingById = new Map<string, ReviewStateActivationRow>();

  for (let offset = 0; offset < wordIds.length; offset += QUERY_CHUNK_SIZE) {
    const chunk = wordIds.slice(offset, offset + QUERY_CHUNK_SIZE);
    const { data, error } = await supabaseAdmin
      .from('review_states')
      .select('vocabulary_item_id, memory_state, next_review_at')
      .eq('user_id', userId)
      .in('vocabulary_item_id', chunk);
    if (error) throw new Error(`review state activation lookup failed: ${error.message}`);
    for (const row of (data ?? []) as ReviewStateActivationRow[]) existingById.set(row.vocabulary_item_id, row);
  }

  const nextReviewAt = toNextReviewAt('fuzzy', new Date(timestamp), await getUserReviewTimeZone(userId))!;
  const missingIds = wordIds.filter((id) => !existingById.has(id));
  const newIds = wordIds.filter((id) => {
    const row = existingById.get(id);
    return row?.memory_state === 'new' && row.next_review_at === null;
  });

  if (missingIds.length > 0) {
    const { error } = await supabaseAdmin.from('review_states').insert(
      missingIds.map((vocabularyItemId) => ({
        user_id: userId,
        vocabulary_item_id: vocabularyItemId,
        memory_state: 'fuzzy',
        interval_days: 1,
        next_review_at: nextReviewAt,
        last_reviewed_at: timestamp,
      })),
    );
    if (error) throw new Error(`review state activation insert failed: ${error.message}`);
  }

  for (let offset = 0; offset < newIds.length; offset += QUERY_CHUNK_SIZE) {
    const chunk = newIds.slice(offset, offset + QUERY_CHUNK_SIZE);
    const { error } = await supabaseAdmin
      .from('review_states')
      .update({
        memory_state: 'fuzzy',
        interval_days: 1,
        next_review_at: nextReviewAt,
        last_reviewed_at: timestamp,
        graduated_at: null,
      })
      .eq('user_id', userId)
      .in('vocabulary_item_id', chunk)
      .eq('memory_state', 'new')
      .is('next_review_at', null);
    if (error) throw new Error(`review state activation update failed: ${error.message}`);
  }
}

async function trimOfficialGroup(groupId: string, keepWordIds: string[]) {
  const keep = new Set(keepWordIds);
  const { data, error } = await supabaseAdmin
    .from('learning_group_words')
    .select('vocabulary_item_id')
    .eq('learning_group_id', groupId);
  if (error) throw new Error(`official learning group trim lookup failed: ${error.message}`);
  const removeIds = (data ?? [])
    .map((row) => (row as { vocabulary_item_id: string }).vocabulary_item_id)
    .filter((id) => !keep.has(id));
  if (removeIds.length === 0) return;
  const { error: deleteError } = await supabaseAdmin
    .from('learning_group_words')
    .delete()
    .eq('learning_group_id', groupId)
    .in('vocabulary_item_id', removeIds);
  if (deleteError) throw new Error(`official learning group trim failed: ${deleteError.message}`);
}

async function completeGroup(userId: string, groupId: string) {
  const timestamp = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('learning_groups')
    .update({
      status: 'completed',
      completed_at: timestamp,
      session_round: null,
      session_current_index: null,
      session_queue_word_ids: null,
      session_passed_queue_indices: null,
      session_round1_confirmed_word_ids: null,
      session_last_active_at: null,
    })
    .eq('id', groupId)
    .eq('user_id', userId);
  if (error) throw new Error(`learning group completion failed: ${error.message}`);
}

export async function getLearningSession(userId: string, groupId: string): Promise<LearningSessionPayload | null> {
  const group = await fetchLearningGroup(userId, groupId);
  if (!group) return null;
  const [words, preferences] = await Promise.all([fetchLearningWords(groupId), fetchLearningPreferences(userId)]);
  const sourceType = group.source_type === 'system' ? 'system' : 'custom';
  const libraryId = resolveOfficialLibraryId(group.library_id, group.group_name, group.source_type);
  const completed = group.status === 'completed' || Boolean(group.completed_at);

  return {
    group: {
      id: group.id,
      title: group.group_name?.trim() || '这组词',
      sourceType,
      libraryId,
      officialMode: libraryId ? resolveOfficialStudyModeFromGroupName(libraryId, group.group_name) : null,
      status: completed ? 'completed' : 'active',
    },
    session: buildSnapshot(group, words),
    words,
    preferences,
    completed,
  };
}

export async function startOfficialLearningSession(
  userId: string,
  input: { libraryId: OfficialLibraryId; mode: OfficialStudyMode; timeZone?: string | null },
) {
  if (!isOfficialLibraryId(input.libraryId)) throw new Error('未知官方词库。');
  if (input.mode !== 'sequential' && input.mode !== 'shuffle') throw new Error('未知学习顺序。');

  const { data: existingGroups, error: existingError } = await supabaseAdmin
    .from('learning_groups')
    .select('id, status, completed_at, session_round')
    .eq('user_id', userId)
    .eq('source_type', 'system')
    .eq('library_id', input.libraryId)
    .order('created_at', { ascending: false });
  if (existingError) throw new Error(`official active group lookup failed: ${existingError.message}`);
  const activeGroup = (existingGroups ?? []).find(
    (row) =>
      (row as { status: string | null }).status !== 'completed' &&
      !(row as { completed_at: string | null }).completed_at,
  ) as { id: string } | undefined;
  if (activeGroup) {
    await updateRoutine(userId, activeGroup.id, [], input.timeZone);
    return getLearningSession(userId, activeGroup.id);
  }

  const { data: nextRows, error: nextError } = await supabaseAdmin.rpc('official_next_batch', {
    p_user_id: userId,
    p_library_id: input.libraryId,
    p_mode: input.mode,
    p_limit: ROUND1_BATCH_SIZE,
  });
  if (nextError) throw new Error(`official next batch failed: ${nextError.message}`);
  const batch = (nextRows ?? []) as Array<{ word: string; word_position: number }>;
  if (batch.length === 0) throw new Error('这个官方词库已经全部完成。');

  const normalizedWords = batch.map((row) => row.word.trim().toLowerCase());
  const { data: vocabRows, error: vocabError } = await supabaseAdmin
    .from('vocabulary_items')
    .select('id, word')
    .in('word', normalizedWords);
  if (vocabError) throw new Error(`official vocabulary lookup failed: ${vocabError.message}`);
  const vocabByWord = new Map(
    (vocabRows ?? []).map((row) => [(row as { word: string }).word.trim().toLowerCase(), (row as { id: string }).id]),
  );
  const vocabularyItemIds = normalizedWords.map((word) => vocabByWord.get(word)).filter(Boolean) as string[];
  if (vocabularyItemIds.length !== batch.length) {
    throw new Error('这批官方词还没有完整预置，请稍后再试。');
  }

  const groupName = formatOfficialCounterGroupName(
    input.libraryId,
    input.mode,
    (existingGroups?.length ?? 0) + 1,
    vocabularyItemIds.length,
  );
  const { data: groupId, error: createError } = await supabaseAdmin.rpc('create_learning_group_exclusive', {
    p_user_id: userId,
    p_group_name: groupName,
    p_source_type: 'system',
    p_library_id: input.libraryId,
    p_vocabulary_item_ids: vocabularyItemIds,
  });
  if (createError) throw new Error(`official learning group creation failed: ${createError.message}`);
  if (typeof groupId !== 'string') throw new Error('官方学习组创建失败。');

  await persistSnapshot(
    userId,
    groupId,
    {
      round: 'round1',
      currentIndex: 0,
      queueWordIds: vocabularyItemIds,
      passedQueueIndices: [],
      round1ConfirmedWordIds: [],
      timeZone: input.timeZone,
    },
    new Set(vocabularyItemIds),
  );
  await updateRoutine(userId, groupId, [], input.timeZone);
  return getLearningSession(userId, groupId);
}

export async function saveLearningSession(
  userId: string,
  groupId: string,
  input: SaveLearningSessionInput,
): Promise<LearningSessionPayload> {
  const current = await getLearningSession(userId, groupId);
  if (!current || current.completed) throw new Error('这组学习已经结束，无法继续保存。');
  const currentRound = current.session?.round ?? 'round1';
  if (CORE_ROUNDS.indexOf(input.round) < CORE_ROUNDS.indexOf(currentRound)) {
    throw new Error('不能用旧轮次覆盖当前学习进度。');
  }
  await persistSnapshot(userId, groupId, input, new Set(current.words.map((word) => word.id)));
  const inferredCompleted: RoutineStep[] =
    input.round === 'round1' ? [] : input.round === 'round2' ? ['round1'] : ['round1', 'round2'];
  await updateRoutine(userId, groupId, inferredCompleted, input.timeZone);
  const updated = await getLearningSession(userId, groupId);
  if (!updated) throw new Error('保存后无法重新读取学习组。');
  return updated;
}

export async function completeLearningRound(
  userId: string,
  groupId: string,
  input: CompleteLearningRoundInput,
): Promise<LearningSessionPayload> {
  const current = await getLearningSession(userId, groupId);
  if (!current || current.completed || !current.session) throw new Error('这组学习已经结束。');
  if (current.session.round !== input.round) throw new Error('学习轮次已经变化，请重新打开本组。');

  const allWordIds = current.words.map((word) => word.id);
  const preferences = current.preferences;

  if (input.round === 'round1') {
    const confirmed = normalizeStringArray(input.confirmedWordIds).filter((id) => allWordIds.includes(id));
    if (confirmed.length === 0) throw new Error('至少确认 1 个词后才能进入下一轮。');
    if (current.group.sourceType === 'system') await trimOfficialGroup(groupId, confirmed);
    await markGroupWordProgress(userId, groupId, confirmed, 'round1', preferences);
    await updateRoutine(userId, groupId, ['round1'], input.timeZone);

    const nextRound: CoreLearningRound | null = preferences.recallEnabled
      ? 'round2'
      : preferences.dictationEnabled
        ? 'round3'
        : null;
    if (!nextRound) {
      await updateRoutine(userId, groupId, ['round2', 'round3'], input.timeZone);
      await completeGroup(userId, groupId);
    } else {
      await persistSnapshot(
        userId,
        groupId,
        {
          round: nextRound,
          currentIndex: 0,
          queueWordIds: confirmed,
          passedQueueIndices: [],
          round1ConfirmedWordIds: confirmed,
          timeZone: input.timeZone,
        },
        new Set(confirmed),
      );
      if (!preferences.recallEnabled) await updateRoutine(userId, groupId, ['round2'], input.timeZone);
    }
  } else if (input.round === 'round2') {
    const scopedWordIds =
      current.session.round1ConfirmedWordIds.length > 0 ? current.session.round1ConfirmedWordIds : allWordIds;
    await markGroupWordProgress(userId, groupId, scopedWordIds, 'round2', preferences);
    await updateRoutine(userId, groupId, ['round2'], input.timeZone);
    if (preferences.dictationEnabled) {
      await persistSnapshot(
        userId,
        groupId,
        {
          round: 'round3',
          currentIndex: 0,
          queueWordIds: scopedWordIds,
          passedQueueIndices: [],
          round1ConfirmedWordIds: scopedWordIds,
          timeZone: input.timeZone,
        },
        new Set(allWordIds),
      );
    } else {
      await markGroupWordProgress(userId, groupId, scopedWordIds, 'round3', preferences);
      await updateRoutine(userId, groupId, ['round3'], input.timeZone);
      await completeGroup(userId, groupId);
    }
  } else {
    const scopedWordIds =
      current.session.round1ConfirmedWordIds.length > 0 ? current.session.round1ConfirmedWordIds : allWordIds;
    await markGroupWordProgress(userId, groupId, scopedWordIds, 'round3', preferences);
    await updateRoutine(userId, groupId, ['round3'], input.timeZone);
    await completeGroup(userId, groupId);
  }

  const updated = await getLearningSession(userId, groupId);
  if (!updated) throw new Error('完成轮次后无法重新读取学习组。');
  return updated;
}

export function validateLearningRoundInput(value: unknown): value is CoreLearningRound {
  return isCoreRound(value);
}

export function validateOfficialStudyMode(value: unknown): value is OfficialStudyMode {
  return value === 'sequential' || value === 'shuffle';
}

export function validateOfficialLibraryId(value: unknown): value is OfficialLibraryId {
  return typeof value === 'string' && isOfficialLibraryId(value);
}
