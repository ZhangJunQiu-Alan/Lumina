import { supabase } from './supabase';
import { apiFetch } from './api';
import { EnrichedWord, toWord, type OfficialLibraryId, Word } from '../types';
import {
  analyzeWordBatch,
  formatDuplicateWordsMessage,
  normalizeWordKey,
  sanitizeWordInput,
} from '../../shared/wordBatch';
import { normalizeRound2ChoiceDistractors } from '../../shared/round2ChoiceDistractors';

export type GroupSourceType = 'custom' | 'system';
export type SavedWordSource = 'import' | 'reading_popup' | 'manual';

interface SaveToSupabaseOptions {
  groupName?: string;
  groupSourceType?: GroupSourceType;
  libraryId?: OfficialLibraryId | null;
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
  source_type: string | null;
  audio_uk_url: string | null;
  audio_us_url: string | null;
  round2_choice_distractors?: unknown;
  vocabulary_senses: VocabularySenseRow[] | null;
  vocabulary_morphology_parts: VocabularyMorphologyPartRow[] | null;
  vocabulary_relations: VocabularyRelationRow[] | null;
  confused_words: ConfusedWordRow[] | null;
}

interface PersistVocabularyEntriesOptions {
  sourceType?: GroupSourceType;
}

export interface PersistedVocabularyEntry extends EnrichedWord {
  id: string;
  source_type: string | null;
  audio_uk_url: string | null;
  audio_us_url: string | null;
}

const vocabularyEntrySelect = `
  id,
  word,
  ipa_uk,
  ipa_us,
  primary_meaning_zh,
  ner_label,
  morphology_summary_zh,
  memory_tip,
  source_type,
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
`;

const legacyVocabularyEntrySelect = `
  id,
  word,
  ipa_uk,
  ipa_us,
  primary_meaning_zh,
  ner_label,
  memory_tip,
  source_type,
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
`;

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

function mapVocabularyEntry(row: VocabularyItemRow): PersistedVocabularyEntry {
  const sortedMorphologyParts = [...(row.vocabulary_morphology_parts ?? [])].sort(
    (left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0),
  );
  const sortedRelations = [...(row.vocabulary_relations ?? [])].sort(
    (left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0),
  );
  const confusions = [...(row.confused_words ?? [])]
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((item) => ({
      word: item.confused_word ?? '',
      difference_zh: item.difference_note_zh ?? '',
    }))
    .filter((item) => item.word);
  const confusedWord = confusions[0];

  return {
    id: row.id,
    word: row.word,
    ipa_uk: row.ipa_uk ?? '',
    ipa_us: row.ipa_us ?? '',
    primary_meaning_zh: row.primary_meaning_zh ?? '',
    ner_label: row.ner_label,
    senses: (row.vocabulary_senses ?? []).map((sense) => ({
      pos: sense.pos ?? '',
      meaning_zh: sense.meaning_zh ?? '',
      example_sentence: sense.example_sentence ?? '',
      example_translation_zh: sense.example_translation_zh ?? '',
    })),
    morphology: {
      summary_zh: row.morphology_summary_zh ?? '',
      parts: sortedMorphologyParts.map((part) => ({
        text: part.part_text ?? '',
        kind: part.part_kind ?? 'root',
        meaning_zh: part.meaning_zh ?? '',
        note_zh: part.note_zh ?? '',
      })),
    },
    derived_words: sortedRelations
      .filter((relation) => relation.relation_type === 'derived')
      .map((relation) => ({
        word: relation.related_word ?? '',
        meaning_zh: relation.meaning_zh ?? '',
        note_zh: relation.note_zh ?? '',
      }))
      .filter((relation) => relation.word),
    synonyms: sortedRelations
      .filter((relation) => relation.relation_type === 'synonym')
      .map((relation) => ({
        word: relation.related_word ?? '',
        meaning_zh: relation.meaning_zh ?? '',
        note_zh: relation.note_zh ?? '',
      }))
      .filter((relation) => relation.word),
    antonyms: sortedRelations
      .filter((relation) => relation.relation_type === 'antonym')
      .map((relation) => ({
        word: relation.related_word ?? '',
        meaning_zh: relation.meaning_zh ?? '',
        note_zh: relation.note_zh ?? '',
      }))
      .filter((relation) => relation.word),
    confusions,
    confused_word: confusedWord?.word ?? null,
    confused_diff_zh: confusedWord?.difference_zh ?? null,
    round2_choice_distractors: normalizeRound2ChoiceDistractors(row.round2_choice_distractors),
    memory_tip: row.memory_tip ?? '',
    source_type: row.source_type,
    audio_uk_url: row.audio_uk_url,
    audio_us_url: row.audio_us_url,
  };
}

function isVocabularyEntryReady(entry: PersistedVocabularyEntry) {
  const sensesReady =
    entry.senses.length > 0 &&
    entry.senses.every((sense) =>
      Boolean(
        sense.pos.trim() &&
        sense.meaning_zh.trim() &&
        sense.example_sentence.trim() &&
        sense.example_translation_zh.trim(),
      ),
    );

  return Boolean(
    entry.ipa_uk.trim() &&
    entry.ipa_us.trim() &&
    entry.primary_meaning_zh.trim() &&
    entry.morphology.summary_zh.trim() &&
    entry.memory_tip.trim() &&
    sensesReady,
  );
}

async function loadVocabularyEntriesByNormalizedWords(words: string[]) {
  if (words.length === 0) return [];

  const normalizedWords = Array.from(new Set(words.map(normalizeWordKey)));
  const { data, error } = await supabase
    .from('vocabulary_items')
    .select(vocabularyEntrySelect)
    .in('word', normalizedWords);

  if (!error) {
    return ((data ?? []) as VocabularyItemRow[]).map(mapVocabularyEntry);
  }

  if (!isMissingRichVocabularySchemaError(error)) {
    throw new Error(`vocabulary_items lookup failed: ${error.message}`);
  }

  const fallbackResult = await supabase
    .from('vocabulary_items')
    .select(legacyVocabularyEntrySelect)
    .in('word', normalizedWords);

  if (fallbackResult.error) {
    throw new Error(`vocabulary_items lookup failed: ${fallbackResult.error.message}`);
  }

  return ((fallbackResult.data ?? []) as VocabularyItemRow[]).map(mapVocabularyEntry);
}

export async function fetchPersistedVocabularyEntriesByIds(ids: string[]): Promise<PersistedVocabularyEntry[]> {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  if (uniqueIds.length > 200) {
    const entries: PersistedVocabularyEntry[] = [];
    for (let offset = 0; offset < uniqueIds.length; offset += 200) {
      entries.push(...(await fetchPersistedVocabularyEntriesByIds(uniqueIds.slice(offset, offset + 200))));
    }
    return entries;
  }

  const { data, error } = await supabase.from('vocabulary_items').select(vocabularyEntrySelect).in('id', uniqueIds);

  let rows: PersistedVocabularyEntry[];

  if (!error) {
    rows = ((data ?? []) as VocabularyItemRow[]).map(mapVocabularyEntry);
  } else {
    if (!isMissingRichVocabularySchemaError(error)) {
      throw new Error(`vocabulary_items lookup failed: ${error.message}`);
    }

    const fallbackResult = await supabase
      .from('vocabulary_items')
      .select(legacyVocabularyEntrySelect)
      .in('id', uniqueIds);

    if (fallbackResult.error) {
      throw new Error(`vocabulary_items lookup failed: ${fallbackResult.error.message}`);
    }

    rows = ((fallbackResult.data ?? []) as VocabularyItemRow[]).map(mapVocabularyEntry);
  }

  const entryById = new Map(rows.map((entry) => [entry.id, entry]));
  return uniqueIds.map((id) => entryById.get(id)).filter((entry): entry is PersistedVocabularyEntry => Boolean(entry));
}

export async function fetchVocabularyEntriesByWords(words: string[]) {
  const batch = analyzeWordBatch(words);
  if (batch.words.length === 0) {
    return { existing: [], missing: [] };
  }

  if (batch.duplicateWords.length > 0) {
    throw new Error(formatDuplicateWordsMessage(batch.duplicateWords));
  }

  const loadedEntries = await loadVocabularyEntriesByNormalizedWords(batch.words);
  const entryByKey = new Map(loadedEntries.map((entry) => [normalizeWordKey(entry.word), entry]));

  const existing: PersistedVocabularyEntry[] = [];
  const missing: string[] = [];

  for (const word of batch.words) {
    const entry = entryByKey.get(normalizeWordKey(word));

    if (entry && isVocabularyEntryReady(entry)) {
      existing.push(entry);
      continue;
    }

    missing.push(word);
  }

  return { existing, missing };
}

export async function persistEnrichedVocabularyEntries(
  enriched: EnrichedWord[],
  options: PersistVocabularyEntriesOptions = {},
): Promise<PersistedVocabularyEntry[]> {
  const preparedEnriched = enriched.map((entry) => ({
    ...entry,
    word: sanitizeWordInput(entry.word),
  }));
  const batch = analyzeWordBatch(preparedEnriched.map((entry) => entry.word));
  if (batch.words.length === 0) {
    return [];
  }

  if (batch.duplicateWords.length > 0) {
    throw new Error(formatDuplicateWordsMessage(batch.duplicateWords));
  }

  const response = await apiFetch('/api/vocab/persist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entries: preparedEnriched,
      sourceType: options.sourceType ?? 'custom',
    }),
  });

  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? `HTTP ${response.status}`);
  }

  return (payload as { data?: PersistedVocabularyEntry[] }).data ?? [];
}

export async function createLearningGroupFromVocabularyEntries(
  userId: string,
  entries: PersistedVocabularyEntry[],
  options: SaveToSupabaseOptions = {},
): Promise<{ groupId: string; words: Word[] }> {
  if (entries.length === 0) {
    throw new Error('这组词还没有可保存的内容。');
  }

  const batch = analyzeWordBatch(entries.map((entry) => entry.word));

  if (batch.duplicateWords.length > 0) {
    throw new Error(formatDuplicateWordsMessage(batch.duplicateWords));
  }

  const sourceType = options.groupSourceType ?? 'custom';
  if (sourceType === 'system' && !options.libraryId) {
    throw new Error('系统词库缺少 libraryId。');
  }

  const groupName = options.groupName ?? `Custom · ${new Date().toLocaleDateString()}`;
  const { data: groupId, error } = await supabase.rpc('create_learning_group_exclusive', {
    p_user_id: userId,
    p_group_name: groupName,
    p_source_type: sourceType,
    p_library_id: options.libraryId ?? null,
    p_vocabulary_item_ids: entries.map((entry) => entry.id),
  });

  if (error) {
    throw new Error(`create_learning_group_exclusive: ${error.message}`);
  }

  if (!groupId) {
    throw new Error('create_learning_group_exclusive: missing group id');
  }

  return {
    groupId: groupId as string,
    words: entries.map(toWord),
  };
}

export async function saveToSupabase(
  enriched: EnrichedWord[],
  userId: string,
  options: SaveToSupabaseOptions = {},
): Promise<{ groupId: string; words: Word[] }> {
  const persistedEntries = await persistEnrichedVocabularyEntries(enriched, {
    sourceType: options.groupSourceType ?? 'custom',
  });

  return createLearningGroupFromVocabularyEntries(userId, persistedEntries, options);
}

export async function saveToUserSavedWords(
  entries: PersistedVocabularyEntry[],
  userId: string,
  source: SavedWordSource,
): Promise<{ saved: number; skipped: number; total: number }> {
  const vocabularyItemIds = Array.from(new Set(entries.map((entry) => entry.id).filter(Boolean)));

  if (vocabularyItemIds.length === 0) {
    return { saved: 0, skipped: 0, total: 0 };
  }

  const rows = vocabularyItemIds.map((vocabularyItemId) => ({
    user_id: userId,
    vocabulary_item_id: vocabularyItemId,
    source,
  }));

  const { data, error } = await supabase
    .from('user_saved_words')
    .upsert(rows, {
      onConflict: 'user_id,vocabulary_item_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) {
    throw new Error(`user_saved_words: ${error.message}`);
  }

  const saved = data?.length ?? 0;
  return {
    saved,
    skipped: Math.max(vocabularyItemIds.length - saved, 0),
    total: vocabularyItemIds.length,
  };
}
