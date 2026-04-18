import { supabase } from './supabase';
import { EnrichedWord, toWord, Word } from '../types';
import { analyzeWordBatch, formatDuplicateWordsMessage, normalizeWordKey, sanitizeWordInput } from '../../shared/wordBatch';

export type GroupSourceType = 'custom' | 'system';

interface SaveToSupabaseOptions {
  groupName?: string;
  groupSourceType?: GroupSourceType;
}

export async function saveToSupabase(
  enriched: EnrichedWord[],
  userId: string,
  options: SaveToSupabaseOptions = {},
): Promise<{ groupId: string; words: Word[] }> {
  const preparedEnriched = enriched.map((entry) => ({
    ...entry,
    word: sanitizeWordInput(entry.word),
  }));
  const batch = analyzeWordBatch(preparedEnriched.map((entry) => entry.word));

  if (batch.duplicateWords.length > 0) {
    throw new Error(formatDuplicateWordsMessage(batch.duplicateWords));
  }

  const items = preparedEnriched.map((entry) => ({
    word: normalizeWordKey(entry.word),
    ipa_uk: entry.ipa_uk,
    ipa_us: entry.ipa_us,
    primary_meaning_zh: entry.primary_meaning_zh,
    ner_label: entry.ner_label,
    memory_tip: entry.memory_tip,
    source_type: 'custom',
  }));

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

    await supabase.from('vocabulary_senses').delete().eq('vocabulary_item_id', vocabId);
    if (entry.senses.length > 0) {
      const { error } = await supabase.from('vocabulary_senses').insert(
        entry.senses.map((sense) => ({ vocabulary_item_id: vocabId, ...sense })),
      );
      if (error) {
        throw new Error(`senses [${entry.word}]: ${error.message}`);
      }
    }

    if (entry.confused_word) {
      await supabase.from('confused_words').delete().eq('vocabulary_item_id', vocabId);
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

  const groupWords = preparedEnriched
    .map((entry, index) => ({
      learning_group_id: group.id,
      vocabulary_item_id: wordIdMap.get(normalizeWordKey(entry.word)),
      sequence_no: index,
    }))
    .filter((row) => row.vocabulary_item_id);

  const { error: linkError } = await supabase.from('learning_group_words').insert(groupWords);
  if (linkError) {
    throw new Error(`learning_group_words: ${linkError.message}`);
  }

  const reviewRows = preparedEnriched
    .map((entry) => ({
      user_id: userId,
      vocabulary_item_id: wordIdMap.get(normalizeWordKey(entry.word)),
      memory_state: 'new',
      interval_days: null,
      next_review_at: null,
      graduated_at: null,
    }))
    .filter((row) => row.vocabulary_item_id);

  const { error: reviewError } = await supabase
    .from('review_states')
    .upsert(reviewRows, { onConflict: 'user_id,vocabulary_item_id' });

  if (reviewError) {
    throw new Error(`review_states: ${reviewError.message}`);
  }

  const persistedWords = preparedEnriched
    .map((entry) => ({ ...entry, id: wordIdMap.get(normalizeWordKey(entry.word)) }))
    .filter((entry): entry is EnrichedWord & { id: string } => Boolean(entry.id))
    .map(toWord);

  return { groupId: group.id as string, words: persistedWords };
}
