import type {
  LearningRoundType,
  PersistedLearningSession,
  ResumeCandidate,
  Word,
} from '../types';
import { supabase } from './supabase';
import { resolveLibraryGroupSourceType } from './officialLibrary';
import {
  clampSessionIndex,
  createResumeCandidate,
  isLearningRoundType,
  normalizePersistedLearningSession,
  normalizeSessionQueueWordIds,
} from './learningSession';

interface LearningGroupSessionRow {
  id: string;
  group_name: string | null;
  source_type: 'custom' | 'system' | null;
  created_at: string;
  status: 'active' | 'completed' | null;
  session_round: LearningRoundType | null;
  session_current_index: number | null;
  session_queue_word_ids: unknown;
  session_last_active_at: string | null;
}

interface LearningGroupBaseRow {
  id: string;
  group_name: string | null;
  source_type: 'custom' | 'system' | null;
  created_at: string;
  status: 'active' | 'completed' | null;
}

interface VocabularySenseRow {
  pos: string | null;
  example_sentence: string | null;
}

interface ConfusedWordRow {
  confused_word: string | null;
  difference_note_zh: string | null;
}

interface VocabularyItemRow {
  id: string;
  word: string;
  ipa_uk: string | null;
  primary_meaning_zh: string | null;
  ner_label: string | null;
  audio_uk_url: string | null;
  audio_us_url: string | null;
  vocabulary_senses: VocabularySenseRow[];
  confused_words: ConfusedWordRow[];
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

function mapGroupWord(row: LearningGroupWordRow): Word | null {
  const vocabularyItem = asArray(row.vocabulary_items)[0];
  if (!vocabularyItem) return null;

  const confusedWord = vocabularyItem.confused_words[0];

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
    example_sentences: vocabularyItem.vocabulary_senses
      .map((sense) => sense.example_sentence ?? '')
      .filter(Boolean),
    confusing_pair: confusedWord?.confused_word
      ? { word: confusedWord.confused_word, difference: confusedWord.difference_note_zh ?? '' }
      : undefined,
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
    article: null,
  });
}

function isResumeCandidateForSource(
  row: Pick<LearningGroupSessionRow, 'source_type' | 'group_name'>,
  sourceType: 'custom' | 'system' | undefined,
) {
  if (!sourceType) return true;
  return resolveLibraryGroupSourceType(row.source_type, row.group_name) === sourceType;
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
      created_at,
      status,
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
      created_at,
      status
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
  sourceType?: 'custom' | 'system',
): Promise<ResumeCandidate | null> {
  const { data, error } = await supabase
    .from('learning_groups')
    .select(`
      id,
      group_name,
      source_type,
      created_at,
      status,
      session_round,
      session_current_index,
      session_queue_word_ids,
      session_last_active_at
    `)
    .eq('user_id', userId)
    .neq('status', 'completed')
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
  const match = rows.find((row) => isResumeCandidateForSource(row, sourceType));
  return match ? toResumeCandidate(match) : null;
}

export async function fetchResumeCandidate(userId: string): Promise<ResumeCandidate | null> {
  return fetchResumeCandidateBySource(userId);
}

export async function fetchOfficialResumeCandidate(userId: string): Promise<ResumeCandidate | null> {
  return fetchResumeCandidateBySource(userId, 'system');
}

export async function fetchLearningGroupSession(
  userId: string,
  groupId: string,
): Promise<{ groupTitle: string; words: Word[]; session: PersistedLearningSession | null } | null> {
  const [groupData, wordResult, articleResult] = await Promise.all([
    fetchLearningGroupRow(userId, groupId),
    supabase
      .from('learning_group_words')
      .select(`
        sequence_no,
        vocabulary_items!inner (
          id,
          word,
          ipa_uk,
          primary_meaning_zh,
          ner_label,
          audio_uk_url,
          audio_us_url,
          vocabulary_senses (
            pos,
            example_sentence
          ),
          confused_words (
            confused_word,
            difference_note_zh
          )
        )
      `)
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

  if (wordResult.error) {
    throw new Error(`learning_group_words lookup failed: ${wordResult.error.message}`);
  }

  if (articleResult.error) {
    throw new Error(`generated_articles lookup failed: ${articleResult.error.message}`);
  }

  const words = ((wordResult.data ?? []) as LearningGroupWordRow[])
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
  const { error } = await supabase
    .from('learning_groups')
    .update({
      status: 'active',
      completed_at: null,
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
        status: 'active',
        completed_at: null,
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
