import { supabaseAdmin } from './supabase.ts';
import { getUserReviewTimeZone } from './review-timezone.ts';
import {
  FIRST_MEMORY_STATE,
  intervalForState,
  MAX_DAILY_REVIEW_WORDS,
  MemoryState,
  normalizeElapsedMs,
  planReviewBacklogRedistribution,
  ReviewBacklogRescheduleUpdate,
  resolveReviewState,
  resolveRound2State,
  ReviewAttemptSource,
  ReviewEventSource,
  ReviewResultType,
  ReviewScheduleRow,
  sortDueReviewRows,
  toNextReviewAt,
  toResultType,
  toReviewDateKey,
} from './review-domain.ts';

export interface ReviewAttemptInput {
  userId: string;
  vocabularyItemId: string;
  learningGroupId?: string | null;
  source: ReviewAttemptSource;
  wasCorrect: boolean;
  elapsedMs: number;
  timestamp?: number;
}

export interface MarkVocabularyUnknownInput {
  userId: string;
  vocabularyItemId: string;
  learningGroupId?: string | null;
  timestamp?: number;
}

export interface MarkVocabularyMasteredInput {
  userId: string;
  vocabularyItemId: string;
  learningGroupId?: string | null;
}

export async function recordBatchReviewAttempts(
  userId: string,
  attempts: Omit<ReviewAttemptInput, 'userId'>[],
): Promise<ReviewAttemptResponse[]> {
  const results: ReviewAttemptResponse[] = [];

  // Sequential processing to maintain SRS logic consistency per word
  for (const attempt of attempts) {
    if (attempt.source !== 'round2' && attempt.source !== 'round3' && attempt.source !== 'review') {
      throw new Error(`Invalid review attempt source: ${attempt.source}`);
    }

    const result = await recordReviewAttempt({
      userId,
      ...attempt,
    });
    results.push(result);
  }

  return results;
}

function isDictationAttemptSource(source: ReviewAttemptSource) {
  return source === 'round3' || source === 'round2';
}

export interface ReviewAttemptResponse {
  memoryState: MemoryState;
  nextReviewAt: string | null;
  graduated: boolean;
  ignored?: boolean;
  transition: {
    from: MemoryState | null;
    to: MemoryState;
    source: ReviewEventSource;
    result: ReviewResultType;
    graduated: boolean;
    nextReviewAt: string | null;
  };
}

interface ReviewStateRow {
  user_id: string;
  vocabulary_item_id: string;
  memory_state: MemoryState;
  review_count: number;
  lapse_count: number;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  ease_factor: number | null;
  graduated_at: string | null;
}

interface ReviewEventTransitionRow {
  previous_state: MemoryState | null;
  next_state: MemoryState;
  source: ReviewEventSource;
  was_correct: boolean;
  elapsed_ms: number | null;
  next_review_at: string | null;
}

interface VocabularySenseRow {
  pos: string | null;
  meaning_zh: string | null;
  example_sentence: string | null;
  example_translation_zh: string | null;
}

interface ConfusedWordRow {
  confused_word: string | null;
  difference_note_zh: string | null;
  sort_order: number | null;
}

interface VocabularyMorphologyPartRow {
  part_text: string | null;
  part_kind: 'prefix' | 'root' | 'suffix' | null;
  meaning_zh: string | null;
  note_zh: string | null;
  sort_order: number | null;
}

interface VocabularyRelationRow {
  relation_type: 'derived' | 'synonym' | 'antonym' | null;
  related_word: string | null;
  meaning_zh: string | null;
  note_zh: string | null;
  sort_order: number | null;
}

interface VocabularyItemRow {
  id: string;
  word: string;
  ipa_uk: string | null;
  ipa_us: string | null;
  primary_meaning_zh: string | null;
  ner_label: string | null;
  morphology_summary_zh: string | null;
  vocabulary_senses: VocabularySenseRow[];
  vocabulary_morphology_parts?: VocabularyMorphologyPartRow[] | null;
  vocabulary_relations?: VocabularyRelationRow[] | null;
  confused_words?: ConfusedWordRow[] | null;
}

interface DueReviewRow {
  vocabulary_item_id: string;
  memory_state: MemoryState;
  next_review_at: string | null;
  last_result: ReviewResultType | null;
  last_assessed_at: string | null;
  vocabulary_items: VocabularyItemRow | VocabularyItemRow[];
}

type ReviewScheduleStateRow = ReviewScheduleRow;

interface FutureReviewStateRow {
  next_review_at: string | null;
}

interface ReviewRoutineRow {
  id: string;
  main_learning_group_id: string | null;
  step_order_json: unknown;
  completed_steps_json: unknown;
  status: 'not_started' | 'in_progress' | 'completed' | null;
}

const REVIEW_DAY_THRESHOLD = 50;
const ROUTINE_DAY_RESET_HOUR = 5;
const ROUTINE_STEPS = ['review', 'round1', 'round2', 'round3'] as const;

type RoutineStep = (typeof ROUTINE_STEPS)[number];

function normalizeReviewTimeZone(value?: string | null) {
  const candidate = value?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

function resolveReviewRoutineDate(timeZone?: string | null) {
  const safeTimeZone = normalizeReviewTimeZone(timeZone);
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

function routineStatus(
  stepOrder: RoutineStep[],
  completedSteps: RoutineStep[],
  groupId: string | null,
): ReviewRoutineRow['status'] {
  if (stepOrder.length > 0 && stepOrder.every((step) => completedSteps.includes(step))) return 'completed';
  if (completedSteps.length > 0 || groupId) return 'in_progress';
  return 'not_started';
}

function isMissingRoutineTableError(error: { message?: string } | null | undefined) {
  return (error?.message ?? '').includes('daily_routine_progress');
}

async function ensureReviewRoutine(userId: string, timeZone: string | null | undefined, startingDueCount: number) {
  const safeTimeZone = normalizeReviewTimeZone(timeZone);
  const localDate = resolveReviewRoutineDate(safeTimeZone);
  const existing = await supabaseAdmin
    .from('daily_routine_progress')
    .select('id, main_learning_group_id, step_order_json, completed_steps_json, status')
    .eq('user_id', userId)
    .eq('local_date', localDate)
    .maybeSingle();

  if (existing.error) {
    if (isMissingRoutineTableError(existing.error)) return null;
    throw new Error(`daily routine lookup failed: ${existing.error.message}`);
  }
  if (existing.data) return existing.data as ReviewRoutineRow;

  const stepOrder = buildRoutineStepOrder(startingDueCount);
  const inserted = await supabaseAdmin
    .from('daily_routine_progress')
    .upsert(
      {
        user_id: userId,
        local_date: localDate,
        timezone: safeTimeZone,
        day_kind: startingDueCount > REVIEW_DAY_THRESHOLD ? 'review_day' : 'learning_day',
        starting_due_count: startingDueCount,
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
    if (isMissingRoutineTableError(inserted.error)) return null;
    throw new Error(`daily routine insert failed: ${inserted.error.message}`);
  }
  if (inserted.data) return inserted.data as ReviewRoutineRow;

  const refetched = await supabaseAdmin
    .from('daily_routine_progress')
    .select('id, main_learning_group_id, step_order_json, completed_steps_json, status')
    .eq('user_id', userId)
    .eq('local_date', localDate)
    .maybeSingle();
  if (refetched.error) throw new Error(`daily routine refetch failed: ${refetched.error.message}`);
  return (refetched.data as ReviewRoutineRow | null) ?? null;
}

async function markReviewRoutineStarted(userId: string, timeZone: string | null | undefined, startingDueCount: number) {
  const routine = await ensureReviewRoutine(userId, timeZone, startingDueCount);
  if (!routine) return;
  const stepOrder = normalizeRoutineSteps(routine.step_order_json);
  if (!stepOrder.includes('review') || routine.status === 'completed' || routine.status === 'in_progress') return;

  const { error } = await supabaseAdmin
    .from('daily_routine_progress')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', routine.id);
  if (error) throw new Error(`daily routine review start failed: ${error.message}`);
}

async function markReviewRoutineCompleted(userId: string, timeZone?: string | null) {
  const routine = await ensureReviewRoutine(userId, timeZone, 0);
  if (!routine) return;
  const stepOrder = normalizeRoutineSteps(routine.step_order_json);
  if (!stepOrder.includes('review')) return;
  const currentCompleted = normalizeRoutineSteps(routine.completed_steps_json);
  const selected = new Set([...currentCompleted, 'review' as const]);
  const completedSteps = stepOrder.filter((step) => selected.has(step));
  const { error } = await supabaseAdmin
    .from('daily_routine_progress')
    .update({
      completed_steps_json: completedSteps,
      status: routineStatus(stepOrder, completedSteps, routine.main_learning_group_id),
      updated_at: new Date().toISOString(),
    })
    .eq('id', routine.id);
  if (error) throw new Error(`daily routine review completion failed: ${error.message}`);
}

function buildWord(row: DueReviewRow) {
  const vocabularyItem = Array.isArray(row.vocabulary_items) ? row.vocabulary_items[0] : row.vocabulary_items;
  const relations = [...(vocabularyItem?.vocabulary_relations ?? [])].sort(
    (left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0),
  );
  const confusingPairs = [...(vocabularyItem?.confused_words ?? [])]
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((item) => ({
      word: item.confused_word ?? '',
      difference: item.difference_note_zh ?? '',
    }))
    .filter((item) => item.word);

  return {
    id: vocabularyItem?.id ?? row.vocabulary_item_id,
    word: vocabularyItem?.word ?? '',
    phonetic: vocabularyItem?.ipa_uk ?? '',
    ipa_uk: vocabularyItem?.ipa_uk ?? '',
    ipa_us: vocabularyItem?.ipa_us ?? '',
    pos_tags: (vocabularyItem?.vocabulary_senses ?? []).map((sense) => sense.pos ?? '').filter(Boolean),
    ner_entities: vocabularyItem?.ner_label ? [{ label: vocabularyItem.ner_label, text: vocabularyItem.word }] : [],
    chinese_definition: vocabularyItem?.primary_meaning_zh ?? '',
    senses: (vocabularyItem?.vocabulary_senses ?? []).map((sense) => ({
      pos: sense.pos ?? '',
      meaning_zh: sense.meaning_zh ?? '',
      example_sentence: sense.example_sentence ?? '',
      example_translation_zh: sense.example_translation_zh ?? '',
    })),
    example_sentences: (vocabularyItem?.vocabulary_senses ?? [])
      .map((sense) => sense.example_sentence ?? '')
      .filter(Boolean),
    morphology: {
      summaryZh: vocabularyItem?.morphology_summary_zh ?? '',
      parts: [...(vocabularyItem?.vocabulary_morphology_parts ?? [])]
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
        .map((part) => ({
          text: part.part_text ?? '',
          kind: part.part_kind ?? 'root',
          meaningZh: part.meaning_zh ?? '',
          noteZh: part.note_zh ?? '',
        })),
    },
    derivedWords: relations
      .filter((relation) => relation.relation_type === 'derived')
      .map((relation) => ({
        word: relation.related_word ?? '',
        meaningZh: relation.meaning_zh ?? '',
        noteZh: relation.note_zh ?? '',
      }))
      .filter((relation) => relation.word),
    synonyms: relations
      .filter((relation) => relation.relation_type === 'synonym')
      .map((relation) => ({
        word: relation.related_word ?? '',
        meaningZh: relation.meaning_zh ?? '',
        noteZh: relation.note_zh ?? '',
      }))
      .filter((relation) => relation.word),
    antonyms: relations
      .filter((relation) => relation.relation_type === 'antonym')
      .map((relation) => ({
        word: relation.related_word ?? '',
        meaningZh: relation.meaning_zh ?? '',
        noteZh: relation.note_zh ?? '',
      }))
      .filter((relation) => relation.word),
    confusingPairs,
    confusing_pair: confusingPairs[0],
    memoryState: row.memory_state,
    nextReviewAt: row.next_review_at,
    lastResult: row.last_result,
  };
}

function isMissingRichVocabularySchemaError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  return ['morphology_summary_zh', 'vocabulary_morphology_parts', 'vocabulary_relations', 'sort_order'].some((part) =>
    message.includes(part),
  );
}

async function fetchRecordedAttemptTransition(input: ReviewAttemptInput, createdAt: string) {
  const { data, error } = await supabaseAdmin
    .from('review_events')
    .select('previous_state, next_state, source, was_correct, elapsed_ms, next_review_at')
    .eq('user_id', input.userId)
    .eq('vocabulary_item_id', input.vocabularyItemId)
    .eq('created_at', createdAt);

  if (error) {
    throw new Error(`review_events replay lookup failed: ${error.message}`);
  }

  const rows = (data as ReviewEventTransitionRow[] | null) ?? [];
  return rows.find((row) => row.previous_state !== row.next_state) ?? rows[0] ?? null;
}

export async function recordReviewAttempt(input: ReviewAttemptInput): Promise<ReviewAttemptResponse> {
  const now = input.timestamp ? new Date(input.timestamp) : new Date();
  const elapsedMs = normalizeElapsedMs(input.elapsedMs);
  const result = toResultType(input.wasCorrect, elapsedMs);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('review_states')
    .select(
      'user_id, vocabulary_item_id, memory_state, review_count, lapse_count, last_reviewed_at, next_review_at, ease_factor, graduated_at, last_assessed_at',
    )
    .eq('user_id', input.userId)
    .eq('vocabulary_item_id', input.vocabularyItemId)
    .maybeSingle<ReviewStateRow & { last_assessed_at: string | null }>();

  if (existingError) {
    throw new Error(`review_states lookup failed: ${existingError.message}`);
  }

  const lastAssessedAt = existing?.last_assessed_at ? new Date(existing.last_assessed_at).getTime() : null;
  const incomingAssessedAt = now.getTime();

  // Conflict handling: if DB has this exact attempt, replay its original transition.
  if (existing && lastAssessedAt === incomingAssessedAt) {
    const recorded = await fetchRecordedAttemptTransition(input, now.toISOString());
    if (recorded) {
      const replayGraduated = recorded.previous_state !== 'mastered' && recorded.next_state === 'mastered';
      return {
        memoryState: existing.memory_state,
        nextReviewAt: existing.next_review_at,
        graduated: replayGraduated,
        transition: {
          from: recorded.previous_state,
          to: recorded.next_state,
          source: recorded.source,
          result: toResultType(recorded.was_correct, normalizeElapsedMs(recorded.elapsed_ms ?? elapsedMs)),
          graduated: replayGraduated,
          nextReviewAt: recorded.next_review_at,
        },
      };
    }

    return {
      memoryState: existing.memory_state,
      nextReviewAt: existing.next_review_at,
      graduated: false,
      ignored: true,
      transition: {
        from: existing.memory_state,
        to: existing.memory_state,
        source: input.source,
        result,
        graduated: false,
        nextReviewAt: existing.next_review_at,
      },
    };
  }

  // If DB has a newer record, skip this stale attempt.
  if (existing?.last_assessed_at && lastAssessedAt !== null && lastAssessedAt > incomingAssessedAt) {
    console.warn(
      `[Conflict] Skipping stale attempt for word ${input.vocabularyItemId}. DB: ${existing.last_assessed_at}, Incoming: ${now.toISOString()}`,
    );
    const currentState = existing.memory_state;
    return {
      memoryState: currentState,
      nextReviewAt: existing.next_review_at,
      graduated: false,
      ignored: true,
      transition: {
        from: currentState,
        to: currentState,
        source: input.source,
        result,
        graduated: false,
        nextReviewAt: existing.next_review_at,
      },
    };
  }

  const currentState = existing?.memory_state ?? 'new';
  const shouldIncrementReviewCounters = input.source === 'review' || isDictationAttemptSource(input.source);

  // Calculate new success count: previous successes + (1 if current is correct)
  // Successes = review_count - lapse_count
  const previousSuccesses = (existing?.review_count ?? 0) - (existing?.lapse_count ?? 0);
  const totalSuccesses = previousSuccesses + (result !== 'wrong' ? 1 : 0);

  const nextState = isDictationAttemptSource(input.source)
    ? resolveRound2State(currentState, result)
    : resolveReviewState(currentState, result, totalSuccesses);

  // If the user got it wrong during a review, keep it "due" for today (don't push to future).
  // This allows the word to stay in the queue if the user exits the session midway.
  const userTimeZone = await getUserReviewTimeZone(input.userId);
  const scheduledReviewAt =
    input.source === 'review' && result === 'wrong' ? now.toISOString() : toNextReviewAt(nextState, now, userTimeZone);
  const preserveEarlierDueDate = result === 'wrong' || isDictationAttemptSource(input.source);
  const nextReviewAt =
    preserveEarlierDueDate && scheduledReviewAt && existing?.next_review_at
      ? new Date(Math.min(Date.parse(existing.next_review_at), Date.parse(scheduledReviewAt))).toISOString()
      : scheduledReviewAt;

  const graduated = currentState !== 'mastered' && nextState === 'mastered';
  const routineDate = toReviewDateKey(now, userTimeZone);

  if (typeof (supabaseAdmin as { rpc?: unknown }).rpc === 'function') {
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('record_review_attempt_atomic', {
      p_user_id: input.userId,
      p_vocabulary_item_id: input.vocabularyItemId,
      p_learning_group_id: input.learningGroupId ?? null,
      p_source: input.source,
      p_was_correct: input.wasCorrect,
      p_elapsed_ms: elapsedMs,
      p_next_state: nextState,
      p_next_review_at: nextReviewAt,
      p_should_increment_review_counters: shouldIncrementReviewCounters,
      p_result: result,
      p_ease_factor: existing?.ease_factor ?? 2.5,
      p_interval_days: intervalForState(nextState),
      p_routine_date: routineDate,
      p_assessed_at: now.toISOString(),
    });

    if (!rpcError && rpcData) {
      const responseData = rpcData as {
        success: boolean;
        ignored?: boolean;
        memory_state: MemoryState;
        next_review_at: string | null;
        graduated: boolean;
        transition?: {
          from: MemoryState | null;
          to: MemoryState;
          source: ReviewEventSource;
          result: ReviewResultType;
          graduated: boolean;
          nextReviewAt: string | null;
        };
      };
      return {
        memoryState: responseData.memory_state ?? nextState,
        nextReviewAt: responseData.next_review_at ?? nextReviewAt,
        graduated: responseData.graduated ?? graduated,
        ignored: responseData.ignored,
        transition: responseData.transition ?? {
          from: existing?.memory_state ?? null,
          to: nextState,
          source: input.source,
          result,
          graduated,
          nextReviewAt,
        },
      };
    }

    if (rpcError && !isMissingRpcError(rpcError)) {
      throw new Error(`record_review_attempt_atomic failed: ${rpcError.message}`);
    }
  }

  // Graceful fallback for unmigrated environments
  const { error: upsertError } = await supabaseAdmin.from('review_states').upsert(
    {
      user_id: input.userId,
      vocabulary_item_id: input.vocabularyItemId,
      ease_factor: existing?.ease_factor ?? 2.5,
      interval_days: intervalForState(nextState),
      last_reviewed_at: shouldIncrementReviewCounters ? now.toISOString() : (existing?.last_reviewed_at ?? null),
      next_review_at: nextReviewAt,
      review_count: shouldIncrementReviewCounters ? (existing?.review_count ?? 0) + 1 : (existing?.review_count ?? 0),
      lapse_count:
        shouldIncrementReviewCounters && result === 'wrong'
          ? (existing?.lapse_count ?? 0) + 1
          : (existing?.lapse_count ?? 0),
      memory_state: nextState,
      last_result: result,
      last_elapsed_ms: elapsedMs,
      last_assessed_at: now.toISOString(),
      graduated_at: nextState === 'mastered' ? (existing?.graduated_at ?? now.toISOString()) : null,
    },
    { onConflict: 'user_id,vocabulary_item_id' },
  );

  if (upsertError) {
    throw new Error(`review_states upsert failed: ${upsertError.message}`);
  }

  const { error: eventError } = await supabaseAdmin.from('review_events').insert({
    user_id: input.userId,
    vocabulary_item_id: input.vocabularyItemId,
    learning_group_id: input.learningGroupId ?? null,
    source: input.source,
    was_correct: input.wasCorrect,
    elapsed_ms: elapsedMs,
    previous_state: existing?.memory_state ?? null,
    next_state: nextState,
    next_review_at: nextReviewAt,
    created_at: now.toISOString(),
  });

  if (eventError) {
    throw new Error(`review_events insert failed: ${eventError.message}`);
  }

  await recordDailyUserStatisticsFallback(supabaseAdmin, {
    userId: input.userId,
    routineDate,
    source: input.source,
    wasCorrect: input.wasCorrect,
    assessedAt: now.toISOString(),
    vocabularyItemId: input.vocabularyItemId,
  }).catch((err: Error) => {
    console.warn(`[Fallback] daily_user_statistics upsert error: ${err.message}`);
  });

  return {
    memoryState: nextState,
    nextReviewAt,
    graduated,
    transition: {
      from: existing?.memory_state ?? null,
      to: nextState,
      source: input.source,
      result,
      graduated,
      nextReviewAt,
    },
  };
}

export async function markVocabularyUnknown(input: MarkVocabularyUnknownInput): Promise<ReviewAttemptResponse> {
  const now = input.timestamp ? new Date(input.timestamp) : new Date();
  const assessedAt = now.toISOString();
  const source: ReviewAttemptSource = 'review';
  const result: ReviewResultType = 'wrong';

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('review_states')
    .select(
      'user_id, vocabulary_item_id, memory_state, review_count, lapse_count, last_reviewed_at, next_review_at, ease_factor, graduated_at, last_assessed_at',
    )
    .eq('user_id', input.userId)
    .eq('vocabulary_item_id', input.vocabularyItemId)
    .maybeSingle<ReviewStateRow & { last_assessed_at: string | null }>();

  if (existingError) {
    throw new Error(`review_states lookup failed: ${existingError.message}`);
  }

  const lastAssessedAt = existing?.last_assessed_at ? new Date(existing.last_assessed_at).getTime() : null;
  const incomingAssessedAt = now.getTime();

  if (existing?.last_assessed_at && lastAssessedAt !== null && lastAssessedAt > incomingAssessedAt) {
    const currentState = existing.memory_state;
    return {
      memoryState: currentState,
      nextReviewAt: existing.next_review_at,
      graduated: false,
      ignored: true,
      transition: {
        from: currentState,
        to: currentState,
        source,
        result,
        graduated: false,
        nextReviewAt: existing.next_review_at,
      },
    };
  }

  const currentState = existing?.memory_state ?? null;
  const nextState = FIRST_MEMORY_STATE;
  const nextReviewAt = new Date(
    Math.min(existing?.next_review_at ? Date.parse(existing.next_review_at) : now.getTime(), now.getTime()),
  ).toISOString();

  const userTimeZone = await getUserReviewTimeZone(input.userId);
  const routineDate = toReviewDateKey(now, userTimeZone);

  if (typeof (supabaseAdmin as { rpc?: unknown }).rpc === 'function') {
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('record_review_attempt_atomic', {
      p_user_id: input.userId,
      p_vocabulary_item_id: input.vocabularyItemId,
      p_learning_group_id: input.learningGroupId ?? null,
      p_source: source,
      p_was_correct: false,
      p_elapsed_ms: 0,
      p_next_state: nextState,
      p_next_review_at: nextReviewAt,
      p_should_increment_review_counters: true,
      p_result: result,
      p_ease_factor: existing?.ease_factor ?? 2.5,
      p_interval_days: intervalForState(nextState),
      p_routine_date: routineDate,
      p_assessed_at: assessedAt,
    });

    if (!rpcError && rpcData) {
      const responseData = rpcData as {
        success: boolean;
        ignored?: boolean;
        memory_state: MemoryState;
        next_review_at: string | null;
        graduated: boolean;
        transition?: {
          from: MemoryState | null;
          to: MemoryState;
          source: ReviewEventSource;
          result: ReviewResultType;
          graduated: boolean;
          nextReviewAt: string | null;
        };
      };
      return {
        memoryState: responseData.memory_state ?? nextState,
        nextReviewAt: responseData.next_review_at ?? nextReviewAt,
        graduated: false,
        ignored: responseData.ignored,
        transition: responseData.transition ?? {
          from: currentState,
          to: nextState,
          source,
          result,
          graduated: false,
          nextReviewAt,
        },
      };
    }

    if (rpcError && !isMissingRpcError(rpcError)) {
      throw new Error(`record_review_attempt_atomic failed: ${rpcError.message}`);
    }
  }

  // Graceful fallback for unmigrated environments
  const { error: upsertError } = await supabaseAdmin.from('review_states').upsert(
    {
      user_id: input.userId,
      vocabulary_item_id: input.vocabularyItemId,
      ease_factor: existing?.ease_factor ?? 2.5,
      interval_days: intervalForState(nextState),
      last_reviewed_at: assessedAt,
      next_review_at: nextReviewAt,
      review_count: (existing?.review_count ?? 0) + 1,
      lapse_count: (existing?.lapse_count ?? 0) + 1,
      memory_state: nextState,
      last_result: result,
      last_elapsed_ms: 0,
      last_assessed_at: assessedAt,
      graduated_at: null,
    },
    { onConflict: 'user_id,vocabulary_item_id' },
  );

  if (upsertError) {
    throw new Error(`review_states unknown mark failed: ${upsertError.message}`);
  }

  const { error: eventError } = await supabaseAdmin.from('review_events').insert({
    user_id: input.userId,
    vocabulary_item_id: input.vocabularyItemId,
    learning_group_id: input.learningGroupId ?? null,
    source,
    was_correct: false,
    elapsed_ms: 0,
    previous_state: currentState,
    next_state: nextState,
    next_review_at: nextReviewAt,
    created_at: assessedAt,
  });

  if (eventError) {
    throw new Error(`review_events unknown mark failed: ${eventError.message}`);
  }

  await recordDailyUserStatisticsFallback(supabaseAdmin, {
    userId: input.userId,
    routineDate,
    source,
    wasCorrect: false,
    assessedAt,
    vocabularyItemId: input.vocabularyItemId,
  }).catch((err: Error) => {
    console.warn(`[Fallback] daily_user_statistics upsert error: ${err.message}`);
  });

  return {
    memoryState: nextState,
    nextReviewAt,
    graduated: false,
    transition: {
      from: currentState,
      to: nextState,
      source,
      result,
      graduated: false,
      nextReviewAt,
    },
  };
}

export async function markVocabularyMastered(input: MarkVocabularyMasteredInput): Promise<ReviewAttemptResponse> {
  const now = new Date();
  const assessedAt = now.toISOString();
  const source: ReviewEventSource = 'manual_mastered';
  const result: ReviewResultType = 'fast_correct';
  const nextState: MemoryState = 'mastered';
  const nextReviewAt = toNextReviewAt(nextState, now);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('review_states')
    .select(
      'user_id, vocabulary_item_id, memory_state, review_count, lapse_count, last_reviewed_at, next_review_at, ease_factor, graduated_at, last_assessed_at',
    )
    .eq('user_id', input.userId)
    .eq('vocabulary_item_id', input.vocabularyItemId)
    .maybeSingle<ReviewStateRow & { last_assessed_at: string | null }>();

  if (existingError) {
    throw new Error(`review_states lookup failed: ${existingError.message}`);
  }

  const previousState = existing?.memory_state ?? null;
  const graduated = previousState !== 'mastered';

  const { error: upsertError } = await supabaseAdmin.from('review_states').upsert(
    {
      user_id: input.userId,
      vocabulary_item_id: input.vocabularyItemId,
      ease_factor: existing?.ease_factor ?? 2.5,
      interval_days: intervalForState(nextState),
      last_reviewed_at: assessedAt,
      next_review_at: nextReviewAt,
      review_count: existing?.review_count ?? 0,
      lapse_count: existing?.lapse_count ?? 0,
      memory_state: nextState,
      last_result: result,
      last_elapsed_ms: 0,
      last_assessed_at: assessedAt,
      graduated_at: existing?.graduated_at ?? assessedAt,
    },
    { onConflict: 'user_id,vocabulary_item_id' },
  );

  if (upsertError) {
    throw new Error(`review_states mastered mark failed: ${upsertError.message}`);
  }

  const { error: eventError } = await supabaseAdmin.from('review_events').insert({
    user_id: input.userId,
    vocabulary_item_id: input.vocabularyItemId,
    learning_group_id: input.learningGroupId ?? null,
    source,
    was_correct: true,
    elapsed_ms: 0,
    previous_state: previousState,
    next_state: nextState,
    next_review_at: nextReviewAt,
    created_at: assessedAt,
  });

  if (eventError) {
    throw new Error(`review_events mastered mark failed: ${eventError.message}`);
  }

  return {
    memoryState: nextState,
    nextReviewAt,
    graduated,
    transition: {
      from: previousState,
      to: nextState,
      source,
      result,
      graduated,
      nextReviewAt,
    },
  };
}

const REVIEW_SCHEDULE_SELECT = 'vocabulary_item_id, memory_state, next_review_at, last_assessed_at';

function groupBacklogUpdatesByDate(updates: ReviewBacklogRescheduleUpdate[]) {
  const grouped = new Map<string, string[]>();

  for (const update of updates) {
    const ids = grouped.get(update.nextReviewAt) ?? [];
    ids.push(update.vocabularyItemId);
    grouped.set(update.nextReviewAt, ids);
  }

  return grouped;
}

async function applyBacklogRescheduleUpdates(userId: string, updates: ReviewBacklogRescheduleUpdate[]) {
  for (const [nextReviewAt, vocabularyItemIds] of groupBacklogUpdatesByDate(updates)) {
    const { error } = await supabaseAdmin
      .from('review_states')
      .update({ next_review_at: nextReviewAt })
      .eq('user_id', userId)
      .in('vocabulary_item_id', vocabularyItemIds);

    if (error) {
      throw new Error(`review backlog reschedule failed: ${error.message}`);
    }
  }
}

export async function redistributeDueReviewBacklog(
  userId: string,
  options: {
    now?: Date;
    timeZone?: string | null;
  } = {},
) {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const dueResult = await supabaseAdmin
    .from('review_states')
    .select(REVIEW_SCHEDULE_SELECT)
    .eq('user_id', userId)
    .not('next_review_at', 'is', null)
    .neq('memory_state', 'mastered')
    .lte('next_review_at', nowIso);

  if (dueResult.error) {
    throw new Error(`due review schedule query failed: ${dueResult.error.message}`);
  }

  const dueRows = (dueResult.data ?? []) as ReviewScheduleStateRow[];
  if (dueRows.length <= MAX_DAILY_REVIEW_WORDS) {
    return {
      activeDueCount: dueRows.length,
      rescheduledCount: 0,
    };
  }

  const futureResult = await supabaseAdmin
    .from('review_states')
    .select('next_review_at')
    .eq('user_id', userId)
    .not('next_review_at', 'is', null)
    .neq('memory_state', 'mastered')
    .gt('next_review_at', nowIso);

  if (futureResult.error) {
    throw new Error(`future review schedule query failed: ${futureResult.error.message}`);
  }

  const plan = planReviewBacklogRedistribution(dueRows, (futureResult.data ?? []) as FutureReviewStateRow[], {
    now,
    timeZone: options.timeZone,
    dailyLimit: MAX_DAILY_REVIEW_WORDS,
  });

  if (plan.updates.length > 0) {
    await applyBacklogRescheduleUpdates(userId, plan.updates);
  }

  return {
    activeDueCount: plan.activeRows.length,
    rescheduledCount: plan.updates.length,
  };
}

export async function fetchDueReviewWords(
  userId: string,
  options: {
    timeZone?: string | null;
  } = {},
) {
  const now = new Date();
  const nowIso = now.toISOString();

  await redistributeDueReviewBacklog(userId, {
    now,
    timeZone: options.timeZone,
  });

  const richSelect = `
      vocabulary_item_id,
      memory_state,
      next_review_at,
      last_result,
      last_assessed_at,
      vocabulary_items!inner (
        id,
        word,
        ipa_uk,
        ipa_us,
        primary_meaning_zh,
        ner_label,
        morphology_summary_zh,
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
    `;
  const legacySelect = `
      vocabulary_item_id,
      memory_state,
      next_review_at,
      last_result,
      last_assessed_at,
      vocabulary_items!inner (
        id,
        word,
        ipa_uk,
        ipa_us,
        primary_meaning_zh,
        ner_label,
        vocabulary_senses (
          pos,
          meaning_zh,
          example_sentence,
          example_translation_zh
        ),
        confused_words (
          confused_word,
          difference_note_zh
        )
      )
    `;

  const initialResult = await supabaseAdmin
    .from('review_states')
    .select(richSelect)
    .eq('user_id', userId)
    .not('next_review_at', 'is', null)
    .neq('memory_state', 'mastered')
    .lte('next_review_at', nowIso)
    .order('next_review_at', { ascending: true })
    .order('last_assessed_at', { ascending: true });

  let data = (initialResult.data ?? []) as unknown as DueReviewRow[];
  let error = initialResult.error;

  if (error && isMissingRichVocabularySchemaError(error)) {
    const fallbackResult = await supabaseAdmin
      .from('review_states')
      .select(legacySelect)
      .eq('user_id', userId)
      .not('next_review_at', 'is', null)
      .neq('memory_state', 'mastered')
      .lte('next_review_at', nowIso)
      .order('next_review_at', { ascending: true })
      .order('last_assessed_at', { ascending: true });

    data = (fallbackResult.data ?? []) as unknown as DueReviewRow[];
    error = fallbackResult.error;
  }

  if (error) {
    throw new Error(`due review query failed: ${error.message}`);
  }

  const rows = sortDueReviewRows(data);

  return rows.map(buildWord);
}

export async function startReviewSession(userId: string, options: { timeZone?: string | null } = {}) {
  const words = await fetchDueReviewWords(userId, options);
  if (words.length > 0) {
    await markReviewRoutineStarted(userId, options.timeZone, words.length);
  }
  return words;
}

export async function completeReviewSession(userId: string, options: { timeZone?: string | null } = {}) {
  const remaining = await supabaseAdmin
    .from('review_states')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('next_review_at', 'is', null)
    .neq('memory_state', 'mastered')
    .lte('next_review_at', new Date().toISOString());
  if (remaining.error) throw new Error(`remaining due review count failed: ${remaining.error.message}`);
  if ((remaining.count ?? 0) > 0) throw new Error('仍有到期词尚未完成，请继续本轮复习。');

  await markReviewRoutineCompleted(userId, options.timeZone);
  return { completed: true };
}

function isMissingRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    Boolean(error.message?.includes('Could not find the function')) ||
    Boolean(error.message?.includes('does not exist'))
  );
}

async function recordDailyUserStatisticsFallback(
  client: typeof supabaseAdmin,
  input: {
    userId: string;
    routineDate: string;
    source: ReviewAttemptSource;
    wasCorrect: boolean;
    assessedAt: string;
    vocabularyItemId: string;
  },
) {
  let isFirstReviewForWordToday = false;
  if (input.source === 'review') {
    const { count, error } = await client
      .from('review_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', input.userId)
      .eq('vocabulary_item_id', input.vocabularyItemId)
      .eq('source', 'review')
      .gte('created_at', `${input.routineDate}T00:00:00.000Z`)
      .lte('created_at', `${input.routineDate}T23:59:59.999Z`);
    if (!error && (count ?? 0) <= 1) {
      isFirstReviewForWordToday = true;
    }
  }

  const { data: existing } = await client
    .from('daily_user_statistics')
    .select('review_word_count, attempt_count, correct_count')
    .eq('user_id', input.userId)
    .eq('date_key', input.routineDate)
    .maybeSingle<{ review_word_count: number; attempt_count: number; correct_count: number }>();

  if (existing) {
    await client
      .from('daily_user_statistics')
      .update({
        review_word_count: existing.review_word_count + (isFirstReviewForWordToday ? 1 : 0),
        attempt_count: existing.attempt_count + 1,
        correct_count: existing.correct_count + (input.wasCorrect ? 1 : 0),
        updated_at: input.assessedAt,
      })
      .eq('user_id', input.userId)
      .eq('date_key', input.routineDate);
  } else {
    await client.from('daily_user_statistics').insert({
      user_id: input.userId,
      date_key: input.routineDate,
      review_word_count: input.source === 'review' ? 1 : 0,
      attempt_count: 1,
      correct_count: input.wasCorrect ? 1 : 0,
      updated_at: input.assessedAt,
    });
  }
}
