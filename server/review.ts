import { supabaseAdmin } from './supabase.js';
import {
  intervalForState,
  MemoryState,
  normalizeElapsedMs,
  resolveReviewState,
  resolveRound2State,
  ReviewAttemptSource,
  ReviewResultType,
  sortDueReviewRows,
  toNextReviewAt,
  toResultType,
} from './review-domain.js';

export interface ReviewAttemptInput {
  userId: string;
  vocabularyItemId: string;
  learningGroupId?: string | null;
  source: ReviewAttemptSource;
  wasCorrect: boolean;
  elapsedMs: number;
  timestamp?: number;
}

export async function recordBatchReviewAttempts(
  userId: string,
  attempts: Omit<ReviewAttemptInput, 'userId'>[]
): Promise<ReviewAttemptResponse[]> {
  const results: ReviewAttemptResponse[] = [];

  // Sequential processing to maintain SRS logic consistency per word
  for (const attempt of attempts) {
    const result = await recordReviewAttempt({
      userId,
      ...attempt,
    });
    results.push(result);
  }

  return results;
}

export interface ReviewAttemptResponse {
  memoryState: MemoryState;
  nextReviewAt: string | null;
  graduated: boolean;
  transition: {
    from: MemoryState | null;
    to: MemoryState;
    source: ReviewAttemptSource;
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

function buildWord(row: DueReviewRow) {
  const vocabularyItem = Array.isArray(row.vocabulary_items)
    ? row.vocabulary_items[0]
    : row.vocabulary_items;
  const relations = [...(vocabularyItem?.vocabulary_relations ?? [])]
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));
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
    pos_tags: (vocabularyItem?.vocabulary_senses ?? [])
      .map((sense) => sense.pos ?? '')
      .filter(Boolean),
    ner_entities: vocabularyItem?.ner_label
      ? [{ label: vocabularyItem.ner_label, text: vocabularyItem.word }]
      : [],
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
  return [
    'morphology_summary_zh',
    'vocabulary_morphology_parts',
    'vocabulary_relations',
    'sort_order',
  ].some((part) => message.includes(part));
}

export async function recordReviewAttempt(input: ReviewAttemptInput): Promise<ReviewAttemptResponse> {
  const now = input.timestamp ? new Date(input.timestamp) : new Date();
  const elapsedMs = normalizeElapsedMs(input.elapsedMs);
  const result = toResultType(input.wasCorrect, elapsedMs);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('review_states')
    .select('user_id, vocabulary_item_id, memory_state, review_count, lapse_count, last_reviewed_at, next_review_at, ease_factor, graduated_at, last_assessed_at')
    .eq('user_id', input.userId)
    .eq('vocabulary_item_id', input.vocabularyItemId)
    .maybeSingle<ReviewStateRow & { last_assessed_at: string | null }>();

  if (existingError) {
    throw new Error(`review_states lookup failed: ${existingError.message}`);
  }

  // Conflict handling: if DB has a newer record, skip this stale attempt.
  if (existing?.last_assessed_at && new Date(existing.last_assessed_at) > now) {
    console.warn(`[Conflict] Skipping stale attempt for word ${input.vocabularyItemId}. DB: ${existing.last_assessed_at}, Incoming: ${now.toISOString()}`);
    const currentState = existing.memory_state;
    return {
      memoryState: currentState,
      nextReviewAt: existing.next_review_at,
      graduated: currentState === 'mastered',
      transition: {
        from: currentState,
        to: currentState,
        source: input.source,
        result,
        graduated: currentState === 'mastered',
        nextReviewAt: existing.next_review_at,
      },
    };
  }

  const currentState = existing?.memory_state ?? 'new';
  const shouldIncrementReviewCounters = input.source === 'review';

  // Calculate new success count: previous successes + (1 if current is correct)
  // Successes = review_count - lapse_count
  const previousSuccesses = (existing?.review_count ?? 0) - (existing?.lapse_count ?? 0);
  const totalSuccesses = previousSuccesses + (result !== 'wrong' ? 1 : 0);

  const nextState = input.source === 'round2'
    ? resolveRound2State(currentState, result)
    : resolveReviewState(currentState, result, totalSuccesses);

  // If the user got it wrong during a review, keep it "due" for today (don't push to future).
  // This allows the word to stay in the queue if the user exits the session midway.
  const nextReviewAt = (input.source === 'review' && result === 'wrong')
    ? (existing?.next_review_at ?? now.toISOString())
    : toNextReviewAt(nextState, now);

  const graduated = nextState === 'mastered';

  const { error: upsertError } = await supabaseAdmin
    .from('review_states')
    .upsert({
      user_id: input.userId,
      vocabulary_item_id: input.vocabularyItemId,
      ease_factor: existing?.ease_factor ?? 2.5,
      interval_days: intervalForState(nextState),
      last_reviewed_at: shouldIncrementReviewCounters ? now.toISOString() : (existing?.last_reviewed_at ?? null),
      next_review_at: nextReviewAt,
      review_count: shouldIncrementReviewCounters ? (existing?.review_count ?? 0) + 1 : (existing?.review_count ?? 0),
      lapse_count: shouldIncrementReviewCounters && result === 'wrong'
        ? (existing?.lapse_count ?? 0) + 1
        : (existing?.lapse_count ?? 0),
      memory_state: nextState,
      last_result: result,
      last_elapsed_ms: elapsedMs,
      last_assessed_at: now.toISOString(),
      graduated_at: graduated ? (existing?.graduated_at ?? now.toISOString()) : null,
    }, { onConflict: 'user_id,vocabulary_item_id' });

  if (upsertError) {
    throw new Error(`review_states upsert failed: ${upsertError.message}`);
  }

  const { error: eventError } = await supabaseAdmin
    .from('review_events')
    .insert({
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

export async function fetchDueReviewWords(userId: string) {
  const nowIso = new Date().toISOString();
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
