import type {
  ConfusingPair,
  EnrichedWordRelation,
  OfficialLibraryId,
  OfficialResumeTargets,
  WordMorphology,
  LearningRoundType,
  PersistedLearningSession,
  ResumeCandidate,
  Word,
} from '../types';
import { toConfusingPairs, toWordMorphology, toWordRelations } from '../types';
import { normalizeRound2ChoiceDistractors } from '../../shared/round2ChoiceDistractors';
import { supabase } from './supabase';
import {
  OFFICIAL_LIBRARY_DEFINITIONS,
  resolveOfficialLibraryId,
  resolveOfficialStudyModeFromGroupName,
} from './officialLibrary';
import {
  clampSessionIndex,
  createResumeCandidate,
  filterWordsToRound1Confirmed,
  filterMasteredSessionWords,
  isCoreLearningComplete,
  isCoreLearningRound,
  isLearningRoundType,
  isReinforcementRound,
  normalizePersistedLearningSession,
  normalizeSessionPassedQueueIndices,
  normalizeSessionQueueWordIds,
  normalizeSessionRound1ConfirmedWordIds,
  repairRound1ConfirmedSessionQueue,
  reconcileSessionWithRound2History,
} from './learningSession';

interface LearningGroupSessionRow {
  id: string;
  group_name: string | null;
  source_type: 'custom' | 'system' | null;
  library_id: string | null;
  created_at: string;
  status: 'active' | 'completed' | null;
  completed_at: string | null;
  session_round: LearningRoundType | null;
  session_current_index: number | null;
  session_queue_word_ids: unknown;
  session_passed_queue_indices?: unknown;
  session_round1_confirmed_word_ids?: unknown;
  session_last_active_at: string | null;
}

interface LearningGroupBaseRow {
  id: string;
  group_name: string | null;
  source_type: 'custom' | 'system' | null;
  library_id: string | null;
  created_at: string;
  status: 'active' | 'completed' | null;
  completed_at: string | null;
}

interface LearningGroupStaleGuardRow {
  status: 'active' | 'completed' | null;
  completed_at: string | null;
  session_round: LearningRoundType | null;
}

interface GroupRound2AttemptRow {
  vocabulary_item_id: string;
  was_correct: boolean;
  created_at: string;
}

interface GroupReviewStateRow {
  vocabulary_item_id: string;
  memory_state: string | null;
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
  memory_tip: string | null;
  audio_uk_url: string | null;
  audio_us_url: string | null;
  round2_choice_distractors?: unknown;
  vocabulary_senses: VocabularySenseRow[];
  vocabulary_morphology_parts?: VocabularyMorphologyPartRow[] | null;
  vocabulary_relations?: VocabularyRelationRow[] | null;
  confused_words?: ConfusedWordRow[] | null;
}

interface LearningGroupWordRow {
  sequence_no: number | null;
  vocabulary_item_id: string | null;
  round1_confirmed_at?: string | null;
  round2_completed_at?: string | null;
  round3_completed_at?: string | null;
  learned_at?: string | null;
  round2_required?: boolean | null;
  round3_required?: boolean | null;
  vocabulary_items: VocabularyItemRow | VocabularyItemRow[];
}

type LearningGroupLookupRow = LearningGroupSessionRow | LearningGroupBaseRow;

function isMissingLearningSessionColumnError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  return [
    'session_round',
    'session_current_index',
    'session_queue_word_ids',
    'session_passed_queue_indices',
    'session_round1_confirmed_word_ids',
    'session_last_active_at',
  ].some((column) => message.includes(column));
}

function isMissingPassedQueueIndicesColumnError(error: { message?: string } | null | undefined) {
  return (error?.message ?? '').includes('session_passed_queue_indices');
}

function isMissingRound1ConfirmedColumnError(error: { message?: string } | null | undefined) {
  return (error?.message ?? '').includes('session_round1_confirmed_word_ids');
}

function isMissingRichVocabularySchemaError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  return [
    'morphology_summary_zh',
    'vocabulary_morphology_parts',
    'vocabulary_relations',
    'sort_order',
    'round2_choice_distractors',
  ].some((part) => message.includes(part));
}

function isMissingLearningGroupWordProgressSchemaError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  return [
    'round1_confirmed_at',
    'round2_completed_at',
    'round3_completed_at',
    'learned_at',
    'round2_required',
    'round3_required',
  ].some((column) => message.includes(column));
}

function hasLearningSessionColumns(row: LearningGroupLookupRow): row is LearningGroupSessionRow {
  return 'session_round' in row;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveGroupTitle(row: Pick<LearningGroupSessionRow, 'group_name'>) {
  return row.group_name?.trim() || '这组词';
}

function mapMorphology(summary: string | null, parts: VocabularyMorphologyPartRow[]): WordMorphology {
  return toWordMorphology({
    summary_zh: summary ?? '',
    parts: [...parts]
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((part) => ({
        text: part.part_text ?? '',
        kind: part.part_kind ?? 'root',
        meaning_zh: part.meaning_zh ?? '',
        note_zh: part.note_zh ?? '',
      })),
  });
}

function mapRelations(rows: VocabularyRelationRow[], type: 'derived' | 'synonym' | 'antonym'): EnrichedWordRelation[] {
  return [...rows]
    .filter((relation) => relation.relation_type === type)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((relation) => ({
      word: relation.related_word ?? '',
      meaning_zh: relation.meaning_zh ?? '',
      note_zh: relation.note_zh ?? '',
    }))
    .filter((relation) => relation.word);
}

function mapConfusions(rows: ConfusedWordRow[]): ConfusingPair[] {
  return toConfusingPairs(
    [...rows]
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((row) => ({
        word: row.confused_word ?? '',
        difference_zh: row.difference_note_zh ?? '',
      })),
  ).filter((pair) => pair.word);
}

function mapGroupWord(row: LearningGroupWordRow): Word | null {
  const vocabularyItem = asArray(row.vocabulary_items)[0];
  if (!vocabularyItem) return null;

  const confusingPairs = mapConfusions(vocabularyItem.confused_words ?? []);

  return {
    id: vocabularyItem.id,
    word: vocabularyItem.word,
    phonetic: vocabularyItem.ipa_uk ?? '',
    ipa_uk: vocabularyItem.ipa_uk ?? '',
    ipa_us: vocabularyItem.ipa_us ?? '',
    pos_tags: vocabularyItem.vocabulary_senses.map((sense) => sense.pos ?? '').filter(Boolean),
    ner_entities: vocabularyItem.ner_label ? [{ label: vocabularyItem.ner_label, text: vocabularyItem.word }] : [],
    chinese_definition: vocabularyItem.primary_meaning_zh ?? '',
    senses: vocabularyItem.vocabulary_senses.map((sense) => ({
      pos: sense.pos ?? '',
      meaning_zh: sense.meaning_zh ?? '',
      example_sentence: sense.example_sentence ?? '',
      example_translation_zh: sense.example_translation_zh ?? '',
    })),
    example_sentences: vocabularyItem.vocabulary_senses.map((sense) => sense.example_sentence ?? '').filter(Boolean),
    morphology: mapMorphology(vocabularyItem.morphology_summary_zh, vocabularyItem.vocabulary_morphology_parts ?? []),
    derivedWords: toWordRelations(mapRelations(vocabularyItem.vocabulary_relations ?? [], 'derived')),
    synonyms: toWordRelations(mapRelations(vocabularyItem.vocabulary_relations ?? [], 'synonym')),
    antonyms: toWordRelations(mapRelations(vocabularyItem.vocabulary_relations ?? [], 'antonym')),
    confusingPairs,
    confusing_pair: confusingPairs[0],
    round2ChoiceDistractors: normalizeRound2ChoiceDistractors(vocabularyItem.round2_choice_distractors),
    memory_tip: vocabularyItem.memory_tip ?? '',
    audio_uk_url: vocabularyItem.audio_uk_url,
    audio_us_url: vocabularyItem.audio_us_url,
  };
}

function uniqueVocabularyItemIds(wordIds: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const wordId of wordIds) {
    const trimmed = wordId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

type CoreLearningRound = Extract<LearningRoundType, 'round1' | 'round2' | 'round3'>;

async function markLearningGroupWordProgress(
  groupId: string,
  wordIds: string[],
  round: CoreLearningRound,
  options: {
    round2Required?: boolean;
    round3Required?: boolean;
  } = {},
) {
  const vocabularyItemIds = uniqueVocabularyItemIds(wordIds);
  if (vocabularyItemIds.length === 0) return 0;

  const { data, error } = await supabase.rpc('mark_learning_group_word_progress', {
    p_learning_group_id: groupId,
    p_vocabulary_item_ids: vocabularyItemIds,
    p_round: round,
    p_round2_required: options.round2Required ?? true,
    p_round3_required: options.round3Required ?? true,
  });

  if (error) {
    throw new Error(`learning_group_words progress update failed: ${error.message}`);
  }

  return typeof data === 'number' ? data : 0;
}

export async function markLearningGroupWordsRound1Confirmed(
  groupId: string,
  wordIds: string[],
  options: {
    round2Required: boolean;
    round3Required: boolean;
  },
) {
  return markLearningGroupWordProgress(groupId, wordIds, 'round1', options);
}

export async function markLearningGroupWordsRoundCompleted(
  groupId: string,
  wordIds: string[],
  round: Extract<LearningRoundType, 'round2' | 'round3'>,
) {
  return markLearningGroupWordProgress(groupId, wordIds, round);
}

function toPersistedLearningSession(
  row: LearningGroupLookupRow,
  words: Word[],
  article: string | null,
): PersistedLearningSession | null {
  if (!hasLearningSessionColumns(row)) {
    return null;
  }

  if (!isLearningRoundType(row.session_round)) {
    return null;
  }

  const normalizedSession = normalizePersistedLearningSession(
    {
      groupId: row.id,
      round: row.session_round,
      currentIndex: row.session_current_index ?? 0,
      queueWordIds: normalizeSessionQueueWordIds(row.session_queue_word_ids),
      passedQueueIndices: normalizeSessionPassedQueueIndices(
        row.session_passed_queue_indices,
        normalizeSessionQueueWordIds(row.session_queue_word_ids).length,
        row.session_current_index ?? 0,
      ),
      round1ConfirmedWordIds: normalizeSessionRound1ConfirmedWordIds(row.session_round1_confirmed_word_ids),
      lastActiveAt: row.session_last_active_at ?? row.created_at,
      groupCompleted: isCoreLearningComplete({
        status: row.status,
        completedAt: row.completed_at,
        sessionRound: row.session_round,
      }),
      completedAt: row.completed_at,
      libraryId: resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type),
      officialMode: resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type)
        ? resolveOfficialStudyModeFromGroupName(
            resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type)!,
            row.group_name,
          )
        : null,
      article,
    },
    words,
  );

  return normalizedSession;
}

function toResumeCandidate(row: LearningGroupLookupRow): ResumeCandidate | null {
  if (!hasLearningSessionColumns(row)) {
    return null;
  }

  if (!isLearningRoundType(row.session_round)) {
    return null;
  }

  return createResumeCandidate({
    groupId: row.id,
    groupTitle: resolveGroupTitle(row),
    createdAt: row.created_at,
    round: row.session_round,
    currentIndex: row.session_current_index ?? 0,
    queueWordIds: normalizeSessionQueueWordIds(row.session_queue_word_ids),
    passedQueueIndices: normalizeSessionPassedQueueIndices(
      row.session_passed_queue_indices,
      normalizeSessionQueueWordIds(row.session_queue_word_ids).length,
      row.session_current_index ?? 0,
    ),
    round1ConfirmedWordIds: normalizeSessionRound1ConfirmedWordIds(row.session_round1_confirmed_word_ids),
    lastActiveAt: row.session_last_active_at ?? row.created_at,
    groupCompleted: isCoreLearningComplete({
      status: row.status,
      completedAt: row.completed_at,
      sessionRound: row.session_round,
    }),
    completedAt: row.completed_at,
    libraryId: resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type),
    officialMode: resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type)
      ? resolveOfficialStudyModeFromGroupName(
          resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type)!,
          row.group_name,
        )
      : null,
    article: null,
  });
}

function isResumeCandidateForLibrary(
  row: Pick<LearningGroupSessionRow, 'source_type' | 'group_name' | 'library_id'>,
  libraryId: OfficialLibraryId | undefined,
) {
  if (!libraryId) return true;
  return resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type) === libraryId;
}

function isActiveResumeCandidate(candidate: ResumeCandidate | null | undefined): candidate is ResumeCandidate {
  return Boolean(candidate && isCoreLearningRound(candidate.round) && !candidate.groupCompleted);
}

function isReinforcementResumeCandidate(candidate: ResumeCandidate | null | undefined): candidate is ResumeCandidate {
  return Boolean(candidate && isReinforcementRound(candidate.round) && candidate.groupCompleted);
}

function buildOfficialResumeTargets(
  rows: LearningGroupSessionRow[],
  libraryId: OfficialLibraryId,
): OfficialResumeTargets {
  let active: ResumeCandidate | null = null;
  let reinforcement: ResumeCandidate | null = null;

  for (const row of rows) {
    if (!isResumeCandidateForLibrary(row, libraryId)) {
      continue;
    }

    const candidate = toResumeCandidate(row);
    if (!candidate) {
      continue;
    }

    if (!active && isActiveResumeCandidate(candidate)) {
      active = candidate;
      continue;
    }

    if (!reinforcement && isReinforcementResumeCandidate(candidate)) {
      reinforcement = candidate;
    }

    if (active && reinforcement) {
      break;
    }
  }

  return { active, reinforcement };
}

async function fetchLearningGroupRow(userId: string, groupId: string): Promise<LearningGroupLookupRow | null> {
  const fullResult = await supabase
    .from('learning_groups')
    .select(
      `
      id,
      group_name,
      source_type,
      library_id,
      created_at,
      status,
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

  if (!fullResult.error) {
    return (fullResult.data as LearningGroupSessionRow | null) ?? null;
  }

  if (isMissingPassedQueueIndicesColumnError(fullResult.error)) {
    const legacySessionResult = await supabase
      .from('learning_groups')
      .select(
        `
        id,
        group_name,
        source_type,
        library_id,
        created_at,
        status,
        completed_at,
        session_round,
        session_current_index,
        session_queue_word_ids,
        session_last_active_at
      `,
      )
      .eq('id', groupId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!legacySessionResult.error) {
      return (legacySessionResult.data as LearningGroupSessionRow | null) ?? null;
    }

    if (!isMissingLearningSessionColumnError(legacySessionResult.error)) {
      throw new Error(`learning_groups lookup failed: ${legacySessionResult.error.message}`);
    }
  } else if (!isMissingLearningSessionColumnError(fullResult.error)) {
    throw new Error(`learning_groups lookup failed: ${fullResult.error.message}`);
  }

  const fallbackResult = await supabase
    .from('learning_groups')
    .select(
      `
      id,
      group_name,
      source_type,
      library_id,
      created_at,
      status,
      completed_at
    `,
    )
    .eq('id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fallbackResult.error) {
    throw new Error(`learning_groups lookup failed: ${fallbackResult.error.message}`);
  }

  return (fallbackResult.data as LearningGroupBaseRow | null) ?? null;
}

async function fetchResumeCandidateBySource(
  userId: string,
  libraryId?: OfficialLibraryId,
): Promise<ResumeCandidate | null> {
  const { data, error } = await supabase
    .from('learning_groups')
    .select(
      `
      id,
      group_name,
      source_type,
      library_id,
      created_at,
      status,
      completed_at,
      session_round,
      session_current_index,
      session_queue_word_ids,
      session_passed_queue_indices,
      session_round1_confirmed_word_ids,
      session_last_active_at
    `,
    )
    .eq('user_id', userId)
    .not('session_round', 'is', null)
    .order('session_last_active_at', { ascending: false })
    .order('created_at', { ascending: false });

  let rowsData: unknown[] | null = data;
  if (error) {
    if (isMissingPassedQueueIndicesColumnError(error)) {
      const legacyRows = await supabase
        .from('learning_groups')
        .select(
          `
          id,
          group_name,
          source_type,
          library_id,
          created_at,
          status,
          completed_at,
          session_round,
          session_current_index,
          session_queue_word_ids,
          session_last_active_at
        `,
        )
        .eq('user_id', userId)
        .not('session_round', 'is', null)
        .order('session_last_active_at', { ascending: false })
        .order('created_at', { ascending: false });

      if (legacyRows.error) {
        if (isMissingLearningSessionColumnError(legacyRows.error)) {
          return null;
        }
        throw new Error(`resume candidate lookup failed: ${legacyRows.error.message}`);
      }

      rowsData = legacyRows.data;
    } else if (isMissingLearningSessionColumnError(error)) {
      return null;
    } else {
      throw new Error(`resume candidate lookup failed: ${error.message}`);
    }
  }

  const rows = (rowsData ?? []) as LearningGroupSessionRow[];
  const match = rows
    .filter((row) => isResumeCandidateForLibrary(row, libraryId))
    .map(toResumeCandidate)
    .find((candidate): candidate is ResumeCandidate => isActiveResumeCandidate(candidate));
  return match ?? null;
}

export async function fetchResumeCandidate(userId: string): Promise<ResumeCandidate | null> {
  return fetchResumeCandidateBySource(userId);
}

export async function fetchOfficialResumeTargets(
  userId: string,
  libraryId: OfficialLibraryId,
): Promise<OfficialResumeTargets> {
  const rows = await supabase
    .from('learning_groups')
    .select(
      `
      id,
      group_name,
      source_type,
      library_id,
      created_at,
      status,
      completed_at,
      session_round,
      session_current_index,
      session_queue_word_ids,
      session_passed_queue_indices,
      session_round1_confirmed_word_ids,
      session_last_active_at
    `,
    )
    .eq('user_id', userId)
    .not('session_round', 'is', null)
    .order('session_last_active_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (rows.error) {
    if (isMissingPassedQueueIndicesColumnError(rows.error)) {
      const legacyRows = await supabase
        .from('learning_groups')
        .select(
          `
          id,
          group_name,
          source_type,
          library_id,
          created_at,
          status,
          completed_at,
          session_round,
          session_current_index,
          session_queue_word_ids,
          session_last_active_at
        `,
        )
        .eq('user_id', userId)
        .not('session_round', 'is', null)
        .order('session_last_active_at', { ascending: false })
        .order('created_at', { ascending: false });

      if (legacyRows.error) {
        if (isMissingLearningSessionColumnError(legacyRows.error)) {
          return { active: null, reinforcement: null };
        }
        throw new Error(`resume candidate lookup failed: ${legacyRows.error.message}`);
      }

      return buildOfficialResumeTargets((legacyRows.data ?? []) as LearningGroupSessionRow[], libraryId);
    }

    if (isMissingLearningSessionColumnError(rows.error)) {
      return { active: null, reinforcement: null };
    }

    throw new Error(`resume candidate lookup failed: ${rows.error.message}`);
  }

  return buildOfficialResumeTargets((rows.data ?? []) as LearningGroupSessionRow[], libraryId);
}

export async function fetchOfficialResumeCandidates(userId: string) {
  const rows = await supabase
    .from('learning_groups')
    .select(
      `
      id,
      group_name,
      source_type,
      library_id,
      created_at,
      status,
      completed_at,
      session_round,
      session_current_index,
      session_queue_word_ids,
      session_passed_queue_indices,
      session_round1_confirmed_word_ids,
      session_last_active_at
    `,
    )
    .eq('user_id', userId)
    .not('session_round', 'is', null)
    .order('session_last_active_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (rows.error) {
    if (isMissingPassedQueueIndicesColumnError(rows.error)) {
      const legacyRows = await supabase
        .from('learning_groups')
        .select(
          `
          id,
          group_name,
          source_type,
          library_id,
          created_at,
          status,
          completed_at,
          session_round,
          session_current_index,
          session_queue_word_ids,
          session_last_active_at
        `,
        )
        .eq('user_id', userId)
        .not('session_round', 'is', null)
        .order('session_last_active_at', { ascending: false })
        .order('created_at', { ascending: false });

      if (!legacyRows.error) {
        const legacyLearningGroups = (legacyRows.data ?? []) as LearningGroupSessionRow[];
        return Object.fromEntries(
          OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => {
            return [definition.id, buildOfficialResumeTargets(legacyLearningGroups, definition.id)];
          }),
        ) as Record<OfficialLibraryId, OfficialResumeTargets>;
      }

      if (!isMissingLearningSessionColumnError(legacyRows.error)) {
        throw new Error(`resume candidate lookup failed: ${legacyRows.error.message}`);
      }

      return Object.fromEntries(
        OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [definition.id, { active: null, reinforcement: null }]),
      ) as Record<OfficialLibraryId, OfficialResumeTargets>;
    }

    if (isMissingLearningSessionColumnError(rows.error)) {
      return Object.fromEntries(
        OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [definition.id, { active: null, reinforcement: null }]),
      ) as Record<OfficialLibraryId, OfficialResumeTargets>;
    }

    throw new Error(`resume candidate lookup failed: ${rows.error.message}`);
  }

  const learningGroups = (rows.data ?? []) as LearningGroupSessionRow[];

  return Object.fromEntries(
    OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => {
      return [definition.id, buildOfficialResumeTargets(learningGroups, definition.id)];
    }),
  ) as Record<OfficialLibraryId, OfficialResumeTargets>;
}

export async function fetchLearningGroupSession(
  userId: string,
  groupId: string,
): Promise<{ groupTitle: string; words: Word[]; session: PersistedLearningSession | null } | null> {
  const progressWordColumns = `
        sequence_no,
        vocabulary_item_id,
        round1_confirmed_at,
        round2_completed_at,
        round3_completed_at,
        learned_at,
        round2_required,
        round3_required
      `;
  const baseWordColumns = `
        sequence_no,
        vocabulary_item_id
      `;
  const richVocabularySelect = `
        vocabulary_items!inner (
          id,
          word,
          ipa_uk,
          ipa_us,
          primary_meaning_zh,
          ner_label,
          morphology_summary_zh,
          memory_tip,
          audio_uk_url,
          audio_us_url,
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
      `;
  const legacyVocabularySelect = `
        vocabulary_items!inner (
          id,
          word,
          ipa_uk,
          ipa_us,
          primary_meaning_zh,
          ner_label,
          memory_tip,
          audio_uk_url,
          audio_us_url,
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
  const richWordSelect = `
        ${progressWordColumns},
        ${richVocabularySelect}
      `;
  const legacyWordSelect = `
        ${progressWordColumns},
        ${legacyVocabularySelect}
      `;
  const richWordSelectWithoutProgress = `
        ${baseWordColumns},
        ${richVocabularySelect}
      `;
  const legacyWordSelectWithoutProgress = `
        ${baseWordColumns},
        ${legacyVocabularySelect}
      `;
  const [groupData, wordResult, articleResult, round2AttemptResult] = await Promise.all([
    fetchLearningGroupRow(userId, groupId),
    supabase
      .from('learning_group_words')
      .select(richWordSelect)
      .eq('learning_group_id', groupId)
      .order('sequence_no', { ascending: true }),
    supabase
      .from('generated_articles')
      .select('content')
      .eq('user_id', userId)
      .eq('learning_group_id', groupId)
      .maybeSingle(),
    supabase
      .from('review_events')
      .select('vocabulary_item_id, was_correct, created_at')
      .eq('user_id', userId)
      .eq('learning_group_id', groupId)
      .in('source', ['round2', 'round3'])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  if (!groupData) {
    return null;
  }

  let wordRows = (wordResult.data ?? []) as LearningGroupWordRow[];

  if (wordResult.error && isMissingLearningGroupWordProgressSchemaError(wordResult.error)) {
    const fallbackResult = await supabase
      .from('learning_group_words')
      .select(richWordSelectWithoutProgress)
      .eq('learning_group_id', groupId)
      .order('sequence_no', { ascending: true });

    if (fallbackResult.error && isMissingRichVocabularySchemaError(fallbackResult.error)) {
      const legacyFallbackResult = await supabase
        .from('learning_group_words')
        .select(legacyWordSelectWithoutProgress)
        .eq('learning_group_id', groupId)
        .order('sequence_no', { ascending: true });

      if (legacyFallbackResult.error) {
        throw new Error(`learning_group_words lookup failed: ${legacyFallbackResult.error.message}`);
      }

      wordRows = (legacyFallbackResult.data ?? []) as LearningGroupWordRow[];
    } else if (fallbackResult.error) {
      throw new Error(`learning_group_words lookup failed: ${fallbackResult.error.message}`);
    } else {
      wordRows = (fallbackResult.data ?? []) as LearningGroupWordRow[];
    }
  } else if (wordResult.error && isMissingRichVocabularySchemaError(wordResult.error)) {
    const fallbackResult = await supabase
      .from('learning_group_words')
      .select(legacyWordSelect)
      .eq('learning_group_id', groupId)
      .order('sequence_no', { ascending: true });

    if (fallbackResult.error && isMissingLearningGroupWordProgressSchemaError(fallbackResult.error)) {
      const legacyFallbackResult = await supabase
        .from('learning_group_words')
        .select(legacyWordSelectWithoutProgress)
        .eq('learning_group_id', groupId)
        .order('sequence_no', { ascending: true });

      if (legacyFallbackResult.error) {
        throw new Error(`learning_group_words lookup failed: ${legacyFallbackResult.error.message}`);
      }

      wordRows = (legacyFallbackResult.data ?? []) as LearningGroupWordRow[];
    } else if (fallbackResult.error) {
      throw new Error(`learning_group_words lookup failed: ${fallbackResult.error.message}`);
    } else {
      wordRows = (fallbackResult.data ?? []) as LearningGroupWordRow[];
    }
  } else if (wordResult.error) {
    throw new Error(`learning_group_words lookup failed: ${wordResult.error.message}`);
  }

  if (wordRows.length === 0 && !wordResult.error) {
    wordRows = [];
  }

  if (articleResult.error) {
    throw new Error(`generated_articles lookup failed: ${articleResult.error.message}`);
  }
  if (round2AttemptResult.error) {
    throw new Error(`review_events lookup failed: ${round2AttemptResult.error.message}`);
  }

  const dbConfirmedWordIds = normalizeSessionRound1ConfirmedWordIds(
    wordRows
      .filter((row) => Boolean(row.round1_confirmed_at))
      .map((row) => row.vocabulary_item_id)
      .filter((wordId): wordId is string => Boolean(wordId)),
  );

  const words = wordRows.map(mapGroupWord).filter((word): word is Word => Boolean(word));
  const wordIds = words.map((word) => word.id);
  const reviewStatesResult =
    wordIds.length > 0
      ? await supabase
          .from('review_states')
          .select('vocabulary_item_id, memory_state')
          .eq('user_id', userId)
          .in('vocabulary_item_id', wordIds)
      : { data: [], error: null };

  if (reviewStatesResult.error) {
    throw new Error(`review_states lookup failed: ${reviewStatesResult.error.message}`);
  }

  const masteredWordIds = ((reviewStatesResult.data ?? []) as GroupReviewStateRow[])
    .filter((row) => row.memory_state === 'mastered')
    .map((row) => row.vocabulary_item_id);
  let activeWords = filterMasteredSessionWords(words, masteredWordIds);
  const activeWordIds = new Set(activeWords.map((word) => word.id));
  const group = groupData;
  const article = articleResult.data?.content ?? null;
  const round2Attempts = (round2AttemptResult.data ?? []) as GroupRound2AttemptRow[];
  const correctWordIds = round2Attempts
    .filter((attempt) => attempt.was_correct)
    .map((attempt) => attempt.vocabulary_item_id);
  const lastRound2AttemptAt = round2Attempts.at(-1)?.created_at ?? null;
  let session = toPersistedLearningSession(group, activeWords, article);

  if (session && session.round !== 'round1') {
    const confirmedWordIds =
      dbConfirmedWordIds.length > 0
        ? dbConfirmedWordIds.filter((wordId) => activeWordIds.has(wordId))
        : normalizeSessionRound1ConfirmedWordIds(session.round1ConfirmedWordIds).filter((wordId) =>
            activeWordIds.has(wordId),
          );
    const repairedQueueWordIds =
      confirmedWordIds.length > 0
        ? repairRound1ConfirmedSessionQueue(session.queueWordIds, confirmedWordIds)
        : session.queueWordIds;
    activeWords = filterWordsToRound1Confirmed(activeWords, confirmedWordIds);
    session = normalizePersistedLearningSession(
      {
        ...session,
        queueWordIds: repairedQueueWordIds,
        round1ConfirmedWordIds: confirmedWordIds.length > 0 ? confirmedWordIds : session.round1ConfirmedWordIds,
      },
      activeWords,
    );
  }

  return {
    groupTitle: resolveGroupTitle(group),
    words: activeWords,
    session: session
      ? reconcileSessionWithRound2History(session, activeWords, {
          correctWordIds,
          lastAttemptAt: lastRound2AttemptAt,
        })
      : null,
  };
}

const SESSION_ROUND_RANK: Record<LearningRoundType, number> = {
  round1: 1,
  round2: 2,
  round3: 3,
  article: 4,
};

async function shouldSkipStaleSessionPersist(userId: string, session: PersistedLearningSession) {
  const currentResult = await supabase
    .from('learning_groups')
    .select('status, completed_at, session_round')
    .eq('id', session.groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (currentResult.error) {
    if (isMissingLearningSessionColumnError(currentResult.error)) {
      return false;
    }

    throw new Error(`learning_groups stale guard failed: ${currentResult.error.message}`);
  }

  const current = currentResult.data as LearningGroupStaleGuardRow | null;
  const currentRound = current?.session_round;
  if (!current || !isLearningRoundType(currentRound)) {
    return false;
  }

  const currentCompleted = isCoreLearningComplete({
    status: current.status,
    completedAt: current.completed_at,
    sessionRound: currentRound,
  });
  if (currentCompleted && !session.groupCompleted) {
    return true;
  }

  if (SESSION_ROUND_RANK[currentRound] > SESSION_ROUND_RANK[session.round]) {
    return true;
  }

  if (session.round !== 'round1') {
    return false;
  }

  const round2EventsResult = await supabase
    .from('review_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('learning_group_id', session.groupId)
    .in('source', ['round2', 'round3']);

  if (round2EventsResult.error) {
    throw new Error(`review_events stale guard failed: ${round2EventsResult.error.message}`);
  }

  return (round2EventsResult.count ?? 0) > 0;
}

function staleSafeSessionRoundFilter(session: PersistedLearningSession) {
  if (session.groupCompleted) {
    return null;
  }

  switch (session.round) {
    case 'round1':
      return 'session_round.is.null,session_round.eq.round1';
    case 'round2':
      return 'session_round.is.null,session_round.eq.round1,session_round.eq.round2';
    case 'round3':
      return 'session_round.is.null,session_round.eq.round1,session_round.eq.round2,session_round.eq.round3';
    default:
      return null;
  }
}

export async function persistLearningGroupSession(userId: string, session: PersistedLearningSession) {
  if (await shouldSkipStaleSessionPersist(userId, session)) {
    console.warn(`Skipped stale learning session snapshot for group ${session.groupId} at ${session.round}`);
    return;
  }

  const staleSafeFilter = staleSafeSessionRoundFilter(session);
  const completedAt = session.groupCompleted ? (session.completedAt ?? new Date().toISOString()) : null;
  let updateQuery = supabase
    .from('learning_groups')
    .update({
      status: session.groupCompleted ? 'completed' : 'active',
      completed_at: completedAt,
      session_round: session.round,
      session_current_index: clampSessionIndex(session.currentIndex, session.queueWordIds.length),
      session_queue_word_ids: session.queueWordIds,
      session_passed_queue_indices: normalizeSessionPassedQueueIndices(
        session.passedQueueIndices,
        session.queueWordIds.length,
        session.currentIndex,
      ),
      session_round1_confirmed_word_ids: normalizeSessionRound1ConfirmedWordIds(session.round1ConfirmedWordIds),
      session_last_active_at: session.lastActiveAt,
    })
    .eq('id', session.groupId)
    .eq('user_id', userId);
  if (staleSafeFilter) {
    updateQuery = updateQuery.or(staleSafeFilter).is('completed_at', null);
  }

  const { error } = await updateQuery;

  if (!error) {
    return;
  }

  if (isMissingRound1ConfirmedColumnError(error)) {
    let legacyConfirmedQuery = supabase
      .from('learning_groups')
      .update({
        status: session.groupCompleted ? 'completed' : 'active',
        completed_at: completedAt,
        session_round: session.round,
        session_current_index: clampSessionIndex(session.currentIndex, session.queueWordIds.length),
        session_queue_word_ids: session.queueWordIds,
        session_passed_queue_indices: normalizeSessionPassedQueueIndices(
          session.passedQueueIndices,
          session.queueWordIds.length,
          session.currentIndex,
        ),
        session_last_active_at: session.lastActiveAt,
      })
      .eq('id', session.groupId)
      .eq('user_id', userId);
    if (staleSafeFilter) {
      legacyConfirmedQuery = legacyConfirmedQuery.or(staleSafeFilter).is('completed_at', null);
    }

    const legacyConfirmedResult = await legacyConfirmedQuery;
    if (!legacyConfirmedResult.error) {
      return;
    }

    if (!isMissingPassedQueueIndicesColumnError(legacyConfirmedResult.error)) {
      throw new Error(`learning_groups session update failed: ${legacyConfirmedResult.error.message}`);
    }
  }

  if (isMissingPassedQueueIndicesColumnError(error)) {
    let legacySessionQuery = supabase
      .from('learning_groups')
      .update({
        status: session.groupCompleted ? 'completed' : 'active',
        completed_at: completedAt,
        session_round: session.round,
        session_current_index: clampSessionIndex(session.currentIndex, session.queueWordIds.length),
        session_queue_word_ids: session.queueWordIds,
        session_last_active_at: session.lastActiveAt,
      })
      .eq('id', session.groupId)
      .eq('user_id', userId);
    if (staleSafeFilter) {
      legacySessionQuery = legacySessionQuery.or(staleSafeFilter).is('completed_at', null);
    }

    const legacySessionResult = await legacySessionQuery;

    if (!legacySessionResult.error) {
      return;
    }

    if (!isMissingLearningSessionColumnError(legacySessionResult.error)) {
      throw new Error(`learning_groups session update failed: ${legacySessionResult.error.message}`);
    }
  } else if (!isMissingLearningSessionColumnError(error)) {
    throw new Error(`learning_groups session update failed: ${error.message}`);
  }

  if (isMissingLearningSessionColumnError(error)) {
    let fallbackQuery = supabase
      .from('learning_groups')
      .update({
        status: session.groupCompleted ? 'completed' : 'active',
        completed_at: completedAt,
      })
      .eq('id', session.groupId)
      .eq('user_id', userId);
    if (staleSafeFilter) {
      fallbackQuery = fallbackQuery.is('completed_at', null);
    }

    const fallbackResult = await fallbackQuery;

    if (!fallbackResult.error) {
      return;
    }

    throw new Error(`learning_groups session update failed: ${fallbackResult.error.message}`);
  }
}

export async function clearLearningGroupSession(
  userId: string,
  groupId: string,
  options: { markCompleted?: boolean } = {},
) {
  const updatePayload: Record<string, unknown> = {
    session_round: null,
    session_current_index: null,
    session_queue_word_ids: null,
    session_passed_queue_indices: null,
    session_round1_confirmed_word_ids: null,
    session_last_active_at: null,
  };

  if (options.markCompleted) {
    updatePayload.status = 'completed';
    updatePayload.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('learning_groups')
    .update(updatePayload)
    .eq('id', groupId)
    .eq('user_id', userId);

  if (!error) {
    return;
  }

  if (isMissingPassedQueueIndicesColumnError(error)) {
    const legacyPayload = { ...updatePayload };
    delete legacyPayload.session_passed_queue_indices;
    delete legacyPayload.session_round1_confirmed_word_ids;

    const legacyResult = await supabase
      .from('learning_groups')
      .update(legacyPayload)
      .eq('id', groupId)
      .eq('user_id', userId);

    if (!legacyResult.error) {
      return;
    }

    if (!isMissingLearningSessionColumnError(legacyResult.error)) {
      throw new Error(`learning_groups session clear failed: ${legacyResult.error.message}`);
    }
  } else if (!isMissingLearningSessionColumnError(error)) {
    throw new Error(`learning_groups session clear failed: ${error.message}`);
  }

  if (isMissingLearningSessionColumnError(error)) {
    if (!options.markCompleted) {
      return;
    }

    const fallbackResult = await supabase
      .from('learning_groups')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', groupId)
      .eq('user_id', userId);

    if (!fallbackResult.error) {
      return;
    }

    throw new Error(`learning_groups session clear failed: ${fallbackResult.error.message}`);
  }
}

export async function trimLearningGroupToWordIds(userId: string, groupId: string, keepWordIds: string[]) {
  const keepSet = new Set(keepWordIds.filter(Boolean));
  const { data: groupWords, error: groupWordsError } = await supabase
    .from('learning_group_words')
    .select('vocabulary_item_id')
    .eq('learning_group_id', groupId);

  if (groupWordsError) {
    throw new Error(`learning_group_words lookup failed: ${groupWordsError.message}`);
  }

  const removeWordIds = Array.from(
    new Set(
      ((groupWords ?? []) as Array<{ vocabulary_item_id: string }>)
        .map((row) => row.vocabulary_item_id)
        .filter((wordId) => wordId && !keepSet.has(wordId)),
    ),
  );

  if (removeWordIds.length === 0) {
    return { removedWordCount: 0, removedReviewStateCount: 0 };
  }

  const { data: sharedWords, error: sharedWordsError } = await supabase
    .from('learning_group_words')
    .select('vocabulary_item_id, learning_groups!inner(user_id)')
    .in('vocabulary_item_id', removeWordIds)
    .neq('learning_group_id', groupId)
    .eq('learning_groups.user_id', userId);

  if (sharedWordsError) {
    throw new Error(`shared learning_group_words lookup failed: ${sharedWordsError.message}`);
  }

  const sharedWordIds = new Set(
    ((sharedWords ?? []) as Array<{ vocabulary_item_id: string }>).map((row) => row.vocabulary_item_id).filter(Boolean),
  );
  const orphanWordIds = removeWordIds.filter((wordId) => !sharedWordIds.has(wordId));

  const { error: deleteGroupWordsError } = await supabase
    .from('learning_group_words')
    .delete()
    .eq('learning_group_id', groupId)
    .in('vocabulary_item_id', removeWordIds);

  if (deleteGroupWordsError) {
    throw new Error(`learning_group_words delete failed: ${deleteGroupWordsError.message}`);
  }

  let removedReviewStateCount = 0;
  if (orphanWordIds.length > 0) {
    const { error: reviewEventsError } = await supabase
      .from('review_events')
      .delete()
      .eq('user_id', userId)
      .in('vocabulary_item_id', orphanWordIds);

    if (reviewEventsError) {
      throw new Error(`review_events delete failed: ${reviewEventsError.message}`);
    }

    const { error: reviewStatesError, count } = await supabase
      .from('review_states')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .in('vocabulary_item_id', orphanWordIds);

    if (reviewStatesError) {
      throw new Error(`review_states delete failed: ${reviewStatesError.message}`);
    }

    removedReviewStateCount = count ?? 0;
  }

  return {
    removedWordCount: removeWordIds.length,
    removedReviewStateCount,
  };
}

export async function fetchGeneratedArticle(userId: string, groupId: string) {
  const { data, error } = await supabase
    .from('generated_articles')
    .select('content')
    .eq('user_id', userId)
    .eq('learning_group_id', groupId)
    .maybeSingle();

  if (error) {
    throw new Error(`generated_articles lookup failed: ${error.message}`);
  }

  return data?.content ?? null;
}

export async function upsertGeneratedArticle(userId: string, groupId: string, content: string, targetWords: string[]) {
  const { error } = await supabase.from('generated_articles').upsert(
    {
      user_id: userId,
      learning_group_id: groupId,
      title: '文章巩固',
      content,
      target_words_json: targetWords,
    },
    { onConflict: 'learning_group_id' },
  );

  if (error) {
    throw new Error(`generated_articles upsert failed: ${error.message}`);
  }
}
