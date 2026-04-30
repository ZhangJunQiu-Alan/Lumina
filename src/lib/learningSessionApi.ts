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
import { supabase } from './supabase';
import {
  OFFICIAL_LIBRARY_DEFINITIONS,
  resolveLibraryGroupSourceType,
  resolveOfficialLibraryId,
} from './officialLibrary';
import {
  clampSessionIndex,
  createResumeCandidate,
  isCoreLearningComplete,
  isCoreLearningRound,
  isLearningRoundType,
  isReinforcementRound,
  normalizePersistedLearningSession,
  normalizeSessionQueueWordIds,
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
  memory_tip: string | null;
  audio_uk_url: string | null;
  audio_us_url: string | null;
  vocabulary_senses: VocabularySenseRow[];
  vocabulary_morphology_parts?: VocabularyMorphologyPartRow[] | null;
  vocabulary_relations?: VocabularyRelationRow[] | null;
  confused_words?: ConfusedWordRow[] | null;
}

interface LearningGroupWordRow {
  sequence_no: number | null;
  vocabulary_items: VocabularyItemRow | VocabularyItemRow[];
}

type LearningGroupLookupRow = LearningGroupSessionRow | LearningGroupBaseRow;

function isMissingLearningSessionColumnError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  return [
    'session_round',
    'session_current_index',
    'session_queue_word_ids',
    'session_last_active_at',
  ].some((column) => message.includes(column));
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

function mapMorphology(
  summary: string | null,
  parts: VocabularyMorphologyPartRow[],
): WordMorphology {
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

function mapRelations(
  rows: VocabularyRelationRow[],
  type: 'derived' | 'synonym' | 'antonym',
): EnrichedWordRelation[] {
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
    pos_tags: vocabularyItem.vocabulary_senses
      .map((sense) => sense.pos ?? '')
      .filter(Boolean),
    ner_entities: vocabularyItem.ner_label
      ? [{ label: vocabularyItem.ner_label, text: vocabularyItem.word }]
      : [],
    chinese_definition: vocabularyItem.primary_meaning_zh ?? '',
    senses: vocabularyItem.vocabulary_senses.map((sense) => ({
      pos: sense.pos ?? '',
      meaning_zh: sense.meaning_zh ?? '',
      example_sentence: sense.example_sentence ?? '',
      example_translation_zh: sense.example_translation_zh ?? '',
    })),
    example_sentences: vocabularyItem.vocabulary_senses
      .map((sense) => sense.example_sentence ?? '')
      .filter(Boolean),
    morphology: mapMorphology(
      vocabularyItem.morphology_summary_zh,
      vocabularyItem.vocabulary_morphology_parts ?? [],
    ),
    derivedWords: toWordRelations(mapRelations(vocabularyItem.vocabulary_relations ?? [], 'derived')),
    synonyms: toWordRelations(mapRelations(vocabularyItem.vocabulary_relations ?? [], 'synonym')),
    antonyms: toWordRelations(mapRelations(vocabularyItem.vocabulary_relations ?? [], 'antonym')),
    confusingPairs,
    confusing_pair: confusingPairs[0],
    memory_tip: vocabularyItem.memory_tip ?? '',
    audio_uk_url: vocabularyItem.audio_uk_url,
    audio_us_url: vocabularyItem.audio_us_url,
  };
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

  const normalizedSession = normalizePersistedLearningSession({
    groupId: row.id,
    round: row.session_round,
    currentIndex: row.session_current_index ?? 0,
    queueWordIds: normalizeSessionQueueWordIds(row.session_queue_word_ids),
    lastActiveAt: row.session_last_active_at ?? row.created_at,
    groupCompleted: isCoreLearningComplete({
      status: row.status,
      completedAt: row.completed_at,
      sessionRound: row.session_round,
    }),
    completedAt: row.completed_at,
    libraryId: resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type),
    article,
  }, words);

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
    lastActiveAt: row.session_last_active_at ?? row.created_at,
    groupCompleted: isCoreLearningComplete({
      status: row.status,
      completedAt: row.completed_at,
      sessionRound: row.session_round,
    }),
    completedAt: row.completed_at,
    libraryId: resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type),
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

function buildOfficialResumeTargets(rows: LearningGroupSessionRow[], libraryId: OfficialLibraryId): OfficialResumeTargets {
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

async function fetchLearningGroupRow(
  userId: string,
  groupId: string,
): Promise<LearningGroupLookupRow | null> {
  const fullResult = await supabase
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
      session_queue_word_ids,
      session_last_active_at
    `)
    .eq('id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!fullResult.error) {
    return (fullResult.data as LearningGroupSessionRow | null) ?? null;
  }

  if (!isMissingLearningSessionColumnError(fullResult.error)) {
    throw new Error(`learning_groups lookup failed: ${fullResult.error.message}`);
  }

  const fallbackResult = await supabase
    .from('learning_groups')
    .select(`
      id,
      group_name,
      source_type,
      library_id,
      created_at,
      status,
      completed_at
    `)
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
      session_queue_word_ids,
      session_last_active_at
    `)
    .eq('user_id', userId)
    .not('session_round', 'is', null)
    .order('session_last_active_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingLearningSessionColumnError(error)) {
      return null;
    }
    throw new Error(`resume candidate lookup failed: ${error.message}`);
  }

  const rows = ((data ?? []) as LearningGroupSessionRow[]);
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
      session_queue_word_ids,
      session_last_active_at
    `)
    .eq('user_id', userId)
    .not('session_round', 'is', null)
    .order('session_last_active_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (rows.error) {
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
      session_queue_word_ids,
      session_last_active_at
    `)
    .eq('user_id', userId)
    .not('session_round', 'is', null)
    .order('session_last_active_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (rows.error) {
    if (isMissingLearningSessionColumnError(rows.error)) {
      return Object.fromEntries(
        OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [
          definition.id,
          { active: null, reinforcement: null },
        ]),
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
  const richWordSelect = `
        sequence_no,
        vocabulary_items!inner (
          id,
          word,
          ipa_uk,
          primary_meaning_zh,
          ner_label,
          morphology_summary_zh,
          memory_tip,
          audio_uk_url,
          audio_us_url,
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
  const legacyWordSelect = `
        sequence_no,
        vocabulary_items!inner (
          id,
          word,
          ipa_uk,
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
  const [groupData, wordResult, articleResult] = await Promise.all([
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
  ]);

  if (!groupData) {
    return null;
  }

  let wordRows = (wordResult.data ?? []) as LearningGroupWordRow[];

  if (wordResult.error && isMissingRichVocabularySchemaError(wordResult.error)) {
    const fallbackResult = await supabase
      .from('learning_group_words')
      .select(legacyWordSelect)
      .eq('learning_group_id', groupId)
      .order('sequence_no', { ascending: true });

    if (fallbackResult.error) {
      throw new Error(`learning_group_words lookup failed: ${fallbackResult.error.message}`);
    }

    wordRows = (fallbackResult.data ?? []) as LearningGroupWordRow[];
  } else if (wordResult.error) {
    throw new Error(`learning_group_words lookup failed: ${wordResult.error.message}`);
  }

  if (articleResult.error) {
    throw new Error(`generated_articles lookup failed: ${articleResult.error.message}`);
  }

  const words = wordRows
    .map(mapGroupWord)
    .filter((word): word is Word => Boolean(word));
  const group = groupData;
  const article = articleResult.data?.content ?? null;

  return {
    groupTitle: resolveGroupTitle(group),
    words,
    session: toPersistedLearningSession(group, words, article),
  };
}

export async function persistLearningGroupSession(userId: string, session: PersistedLearningSession) {
  const completedAt = session.groupCompleted
    ? session.completedAt ?? new Date().toISOString()
    : null;
  const { error } = await supabase
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

  if (!error) {
    return;
  }

  if (isMissingLearningSessionColumnError(error)) {
    const fallbackResult = await supabase
      .from('learning_groups')
      .update({
        status: session.groupCompleted ? 'completed' : 'active',
        completed_at: completedAt,
      })
      .eq('id', session.groupId)
      .eq('user_id', userId);

    if (!fallbackResult.error) {
      return;
    }

    throw new Error(`learning_groups session update failed: ${fallbackResult.error.message}`);
  }

  if (error) {
    throw new Error(`learning_groups session update failed: ${error.message}`);
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

  if (error) {
    throw new Error(`learning_groups session clear failed: ${error.message}`);
  }
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

export async function upsertGeneratedArticle(
  userId: string,
  groupId: string,
  content: string,
  targetWords: string[],
) {
  const { error } = await supabase
    .from('generated_articles')
    .upsert({
      user_id: userId,
      learning_group_id: groupId,
      title: '文章巩固',
      content,
      target_words_json: targetWords,
    }, { onConflict: 'learning_group_id' });

  if (error) {
    throw new Error(`generated_articles upsert failed: ${error.message}`);
  }
}
