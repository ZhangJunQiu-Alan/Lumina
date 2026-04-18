import { supabase } from './supabase';
import { EnrichedWord, toWord, Word } from '../types';
import { analyzeWordBatch, formatDuplicateWordsMessage, normalizeWordKey, sanitizeWordInput } from '../../shared/wordBatch';

export type GroupSourceType = 'custom' | 'system';

interface SaveToSupabaseOptions {
  groupName?: string;
  groupSourceType?: GroupSourceType;
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
}

interface VocabularyItemRow {
  id: string;
  word: string;
  ipa_uk: string | null;
  ipa_us: string | null;
  primary_meaning_zh: string | null;
  ner_label: string | null;
  memory_tip: string | null;
  source_type: string | null;
  audio_uk_url: string | null;
  audio_us_url: string | null;
  vocabulary_senses: VocabularySenseRow[] | null;
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

function mapVocabularyEntry(row: VocabularyItemRow): PersistedVocabularyEntry {
  const confusedWord = row.confused_words?.[0];

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
    confused_word: confusedWord?.confused_word ?? null,
    confused_diff_zh: confusedWord?.difference_note_zh ?? null,
    memory_tip: row.memory_tip ?? '',
    source_type: row.source_type,
    audio_uk_url: row.audio_uk_url,
    audio_us_url: row.audio_us_url,
  };
}

function isVocabularyEntryReady(entry: PersistedVocabularyEntry) {
  return Boolean(
    entry.ipa_uk.trim()
    && entry.primary_meaning_zh.trim()
    && entry.memory_tip.trim()
    && entry.senses.length > 0,
  );
}

async function loadVocabularyEntriesByNormalizedWords(words: string[]) {
  if (words.length === 0) return [];

  const normalizedWords = Array.from(new Set(words.map(normalizeWordKey)));
  const { data, error } = await supabase
    .from('vocabulary_items')
    .select(vocabularyEntrySelect)
    .in('word', normalizedWords);

  if (error) {
    throw new Error(`vocabulary_items lookup failed: ${error.message}`);
  }

  return ((data ?? []) as VocabularyItemRow[]).map(mapVocabularyEntry);
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
  const entryByKey = new Map(
    loadedEntries.map((entry) => [normalizeWordKey(entry.word), entry]),
  );

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

  const { data: existingItems, error: existingItemsError } = await supabase
    .from('vocabulary_items')
    .select('word, source_type')
    .in('word', batch.normalizedWords);

  if (existingItemsError) {
    throw new Error(`vocabulary_items existing lookup failed: ${existingItemsError.message}`);
  }

  const existingSourceTypeByWord = new Map(
    ((existingItems ?? []) as Array<{ word: string; source_type: string | null }>)
      .map((row) => [row.word, row.source_type]),
  );

  const items = preparedEnriched.map((entry) => {
    const normalizedWord = normalizeWordKey(entry.word);

    return {
      word: normalizedWord,
      ipa_uk: entry.ipa_uk,
      ipa_us: entry.ipa_us,
      primary_meaning_zh: entry.primary_meaning_zh,
      ner_label: entry.ner_label,
      memory_tip: entry.memory_tip,
      source_type: existingSourceTypeByWord.get(normalizedWord) ?? options.sourceType ?? 'custom',
    };
  });

  const { data: insertedItems, error: itemsError } = await supabase
    .from('vocabulary_items')
    .upsert(items, { onConflict: 'word' })
    .select('id, word');

  if (itemsError) {
    throw new Error(`vocabulary_items: ${itemsError.message}`);
  }

  const wordIdMap = new Map(
    insertedItems!.map((row: { id: string; word: string }) => [row.word, row.id]),
  );

  await Promise.all(preparedEnriched.map(async (entry) => {
    const vocabId = wordIdMap.get(normalizeWordKey(entry.word));
    if (!vocabId) return;

    const { error: deleteSenseError } = await supabase
      .from('vocabulary_senses')
      .delete()
      .eq('vocabulary_item_id', vocabId);
    if (deleteSenseError) {
      throw new Error(`senses cleanup [${entry.word}]: ${deleteSenseError.message}`);
    }

    if (entry.senses.length > 0) {
      const { error } = await supabase.from('vocabulary_senses').insert(
        entry.senses.map((sense) => ({
          vocabulary_item_id: vocabId,
          pos: sense.pos,
          meaning_zh: sense.meaning_zh,
          example_sentence: sense.example_sentence,
          example_translation_zh: sense.example_translation_zh,
        })),
      );
      if (error) {
        throw new Error(`senses [${entry.word}]: ${error.message}`);
      }
    }

    const { error: deleteConfusedError } = await supabase
      .from('confused_words')
      .delete()
      .eq('vocabulary_item_id', vocabId);
    if (deleteConfusedError) {
      throw new Error(`confused_words cleanup [${entry.word}]: ${deleteConfusedError.message}`);
    }

    if (entry.confused_word) {
      const { error } = await supabase.from('confused_words').insert({
        vocabulary_item_id: vocabId,
        confused_word: entry.confused_word,
        difference_note_zh: entry.confused_diff_zh,
      });
      if (error) {
        throw new Error(`confused_words [${entry.word}]: ${error.message}`);
      }
    }
  }));

  const persistedEntries = await loadVocabularyEntriesByNormalizedWords(batch.words);
  const entryByKey = new Map(
    persistedEntries.map((entry) => [normalizeWordKey(entry.word), entry]),
  );

  return batch.words.map((word) => {
    const entry = entryByKey.get(normalizeWordKey(word));

    if (!entry) {
      throw new Error(`词条写入后没有查回来：${word}`);
    }

    return entry;
  });
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

  const { data: group, error: groupError } = await supabase
    .from('learning_groups')
    .insert({
      user_id: userId,
      group_name: options.groupName ?? `Custom · ${new Date().toLocaleDateString()}`,
      source_type: options.groupSourceType ?? 'custom',
    })
    .select('id')
    .single();

  if (groupError) {
    throw new Error(`learning_groups: ${groupError.message}`);
  }

  const groupWords = entries
    .map((entry, index) => ({
      learning_group_id: group.id,
      vocabulary_item_id: entry.id,
      sequence_no: index,
    }));
  const { error: linkError } = await supabase.from('learning_group_words').insert(groupWords);
  if (linkError) {
    throw new Error(`learning_group_words: ${linkError.message}`);
  }

  const reviewRows = entries.map((entry) => ({
    user_id: userId,
    vocabulary_item_id: entry.id,
    memory_state: 'new',
    interval_days: null,
    next_review_at: null,
    graduated_at: null,
  }));

  const { error: reviewError } = await supabase
    .from('review_states')
    .upsert(reviewRows, { onConflict: 'user_id,vocabulary_item_id' });

  if (reviewError) {
    throw new Error(`review_states: ${reviewError.message}`);
  }

  return {
    groupId: group.id as string,
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
