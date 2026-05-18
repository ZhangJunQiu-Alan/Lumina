import { enrichWordLite, enrichWords, type GeminiWordResult, type LiteEnrichResult } from './gemini.js';
import { logger } from './logger.js';
import type { MemoryState } from './review-domain.js';
import { supabaseAdmin } from './supabase.js';
import { normalizeWordKey, sanitizeWordInput } from '../shared/wordBatch.js';

export type EnrichmentLevel = 'lite' | 'full';

export interface VocabularyItemRow {
  id: string;
  word: string;
  ipa_uk: string | null;
  ipa_us: string | null;
  primary_meaning_zh: string | null;
  ner_label: string | null;
  morphology_summary_zh: string | null;
  memory_tip: string | null;
  source_type: string | null;
  enrichment_level: EnrichmentLevel;
  created_at: string | null;
  audio_uk_url: string | null;
  audio_us_url: string | null;
}

export interface WordLookupResult {
  vocabulary_item: VocabularyItemRow;
  senses: Array<{
    pos: string;
    meaning_zh: string;
  }>;
  in_user_library: boolean;
  srs_state: MemoryState | null;
}

export interface LiteVocabularyResult {
  word: string;
  primary_meaning_zh: string;
  senses: Array<{
    pos: string;
    meaning_zh: string;
  }>;
  forms: string[];
}

export interface FullEnrichmentQueueResult {
  queued: boolean;
  vocabularyItemId?: string;
  word?: string;
  reason?: 'not_found' | 'already_full' | 'already_queued';
}

interface VocabularySenseRow {
  pos: string | null;
  meaning_zh: string | null;
}

interface FormLookupRow {
  vocabulary_item_id: string;
}

interface ReviewStateRow {
  memory_state: MemoryState | null;
}

const vocabularyItemSelect = `
  id,
  word,
  ipa_uk,
  ipa_us,
  primary_meaning_zh,
  ner_label,
  morphology_summary_zh,
  memory_tip,
  source_type,
  enrichment_level,
  created_at,
  audio_uk_url,
  audio_us_url
`;

const fullEnrichmentInflight = new Map<string, Promise<void>>();

export function sanitizeLookupWord(word: unknown) {
  return typeof word === 'string' ? normalizeWordKey(word) : '';
}

function isPostgrestDuplicateError(error: { code?: string } | null | undefined) {
  return error?.code === '23505';
}

async function fetchVocabularyItemByWord(word: string): Promise<VocabularyItemRow | null> {
  const { data, error } = await supabaseAdmin
    .from('vocabulary_items')
    .select(vocabularyItemSelect)
    .eq('word', word)
    .maybeSingle();

  if (error) {
    throw new Error(`vocabulary_items word lookup failed: ${error.message}`);
  }

  return (data as VocabularyItemRow | null) ?? null;
}

export async function fetchVocabularyItemById(vocabularyItemId: string): Promise<VocabularyItemRow | null> {
  const { data, error } = await supabaseAdmin
    .from('vocabulary_items')
    .select(vocabularyItemSelect)
    .eq('id', vocabularyItemId)
    .maybeSingle();

  if (error) {
    throw new Error(`vocabulary_items id lookup failed: ${error.message}`);
  }

  return (data as VocabularyItemRow | null) ?? null;
}

async function fetchVocabularyItemByForm(form: string): Promise<VocabularyItemRow | null> {
  const { data: formRow, error: formError } = await supabaseAdmin
    .from('vocabulary_item_forms')
    .select('vocabulary_item_id')
    .eq('form', form)
    .maybeSingle();

  if (formError) {
    throw new Error(`vocabulary_item_forms lookup failed: ${formError.message}`);
  }

  const vocabularyItemId = (formRow as FormLookupRow | null)?.vocabulary_item_id;
  if (!vocabularyItemId) return null;

  return fetchVocabularyItemById(vocabularyItemId);
}

export async function resolveExistingVocabularyItem(word: string): Promise<VocabularyItemRow | null> {
  const normalizedWord = sanitizeLookupWord(word);
  if (!normalizedWord) return null;

  const exactItem = await fetchVocabularyItemByWord(normalizedWord);
  if (exactItem) return exactItem;

  return fetchVocabularyItemByForm(normalizedWord);
}

async function fetchVocabularySenses(vocabularyItemId: string) {
  const { data, error } = await supabaseAdmin
    .from('vocabulary_senses')
    .select('pos, meaning_zh')
    .eq('vocabulary_item_id', vocabularyItemId);

  if (error) {
    throw new Error(`vocabulary_senses lookup failed: ${error.message}`);
  }

  return ((data ?? []) as VocabularySenseRow[])
    .map((sense) => ({
      pos: sense.pos ?? '',
      meaning_zh: sense.meaning_zh ?? '',
    }))
    .filter((sense) => sense.pos && sense.meaning_zh);
}

async function fetchVocabularyForms(vocabularyItemId: string) {
  const { data, error } = await supabaseAdmin
    .from('vocabulary_item_forms')
    .select('form')
    .eq('vocabulary_item_id', vocabularyItemId)
    .order('form', { ascending: true });

  if (error) {
    throw new Error(`vocabulary_item_forms list failed: ${error.message}`);
  }

  return ((data ?? []) as Array<{ form: string | null }>)
    .map((row) => row.form?.trim().toLowerCase() ?? '')
    .filter(Boolean);
}

async function insertVocabularyForms(vocabularyItemId: string, canonicalWord: string, forms: string[]) {
  const normalizedCanonicalWord = normalizeWordKey(canonicalWord);
  const uniqueForms = Array.from(
    new Set(forms.map((form) => normalizeWordKey(form)).filter((form) => form && form !== normalizedCanonicalWord)),
  );

  if (uniqueForms.length === 0) return;

  const { error } = await supabaseAdmin
    .from('vocabulary_item_forms')
    .upsert(
      uniqueForms.map((form) => ({
        vocabulary_item_id: vocabularyItemId,
        form,
      })),
      { onConflict: 'form', ignoreDuplicates: true },
    );

  if (error && !isPostgrestDuplicateError(error)) {
    throw new Error(`vocabulary_item_forms insert failed: ${error.message}`);
  }
}

async function replaceLiteVocabularySenses(vocabularyItemId: string, senses: LiteEnrichResult['senses']) {
  const { error: deleteError } = await supabaseAdmin
    .from('vocabulary_senses')
    .delete()
    .eq('vocabulary_item_id', vocabularyItemId);

  if (deleteError) {
    throw new Error(`vocabulary_senses cleanup failed: ${deleteError.message}`);
  }

  if (senses.length === 0) return;

  const { error: insertError } = await supabaseAdmin
    .from('vocabulary_senses')
    .insert(
      senses.map((sense) => ({
        vocabulary_item_id: vocabularyItemId,
        pos: sense.pos,
        meaning_zh: sense.meaning_zh,
      })),
    );

  if (insertError) {
    throw new Error(`vocabulary_senses insert failed: ${insertError.message}`);
  }
}

async function toLiteVocabularyResult(item: VocabularyItemRow): Promise<LiteVocabularyResult> {
  const [senses, forms] = await Promise.all([
    fetchVocabularySenses(item.id),
    fetchVocabularyForms(item.id),
  ]);

  return {
    word: item.word,
    primary_meaning_zh: item.primary_meaning_zh ?? '',
    senses,
    forms,
  };
}

export async function ensureLiteVocabularyEntry(
  word: string,
  source = 'reading_popup',
): Promise<LiteVocabularyResult> {
  const normalizedRequestedWord = sanitizeLookupWord(word);
  if (!normalizedRequestedWord) {
    throw new Error('Missing word');
  }

  const existingItem = await resolveExistingVocabularyItem(normalizedRequestedWord);
  if (existingItem) {
    return toLiteVocabularyResult(existingItem);
  }

  const liteResult = await enrichWordLite(normalizedRequestedWord, {
    source,
    enrichmentType: 'lite',
  });
  const canonicalWord = normalizeWordKey(liteResult.word || normalizedRequestedWord);
  const requestedForm = normalizedRequestedWord !== canonicalWord ? normalizedRequestedWord : '';
  const forms = [...liteResult.forms, requestedForm].filter(Boolean);

  const canonicalExistingItem = await fetchVocabularyItemByWord(canonicalWord);
  if (canonicalExistingItem) {
    await insertVocabularyForms(canonicalExistingItem.id, canonicalWord, forms);
    return toLiteVocabularyResult(canonicalExistingItem);
  }

  const { data: insertedRows, error: insertError } = await supabaseAdmin
    .from('vocabulary_items')
    .upsert(
      {
        word: canonicalWord,
        primary_meaning_zh: liteResult.primary_meaning_zh,
        source_type: 'custom',
        enrichment_level: 'lite',
      },
      { onConflict: 'word', ignoreDuplicates: true },
    )
    .select(vocabularyItemSelect);

  if (insertError && !isPostgrestDuplicateError(insertError)) {
    throw new Error(`vocabulary_items lite insert failed: ${insertError.message}`);
  }

  const insertedItem = ((insertedRows ?? []) as VocabularyItemRow[])[0] ?? null;
  const item = insertedItem ?? await fetchVocabularyItemByWord(canonicalWord);
  if (!item) {
    throw new Error(`vocabulary_items lite insert did not return item: ${canonicalWord}`);
  }

  if (insertedItem) {
    await replaceLiteVocabularySenses(item.id, liteResult.senses);
  }

  await insertVocabularyForms(item.id, canonicalWord, forms);
  return toLiteVocabularyResult(item);
}

export async function lemmatizeVocabularyWord(
  word: string,
  source = 'import_lemmatize',
): Promise<LiteVocabularyResult> {
  const normalizedRequestedWord = sanitizeLookupWord(word);
  if (!normalizedRequestedWord) {
    throw new Error('Missing word');
  }

  const existingFormItem = await fetchVocabularyItemByForm(normalizedRequestedWord);
  if (existingFormItem) {
    return toLiteVocabularyResult(existingFormItem);
  }

  const liteResult = await enrichWordLite(normalizedRequestedWord, {
    source,
    enrichmentType: 'lite',
  });
  const canonicalWord = normalizeWordKey(liteResult.word || normalizedRequestedWord);
  const requestedForm = normalizedRequestedWord !== canonicalWord ? normalizedRequestedWord : '';
  const forms = [...liteResult.forms, requestedForm].filter(Boolean);

  const canonicalExistingItem = await fetchVocabularyItemByWord(canonicalWord);
  if (canonicalExistingItem) {
    await insertVocabularyForms(canonicalExistingItem.id, canonicalWord, forms);
    return toLiteVocabularyResult(canonicalExistingItem);
  }

  const { data: insertedRows, error: insertError } = await supabaseAdmin
    .from('vocabulary_items')
    .upsert(
      {
        word: canonicalWord,
        primary_meaning_zh: liteResult.primary_meaning_zh,
        source_type: 'custom',
        enrichment_level: 'lite',
      },
      { onConflict: 'word', ignoreDuplicates: true },
    )
    .select(vocabularyItemSelect);

  if (insertError && !isPostgrestDuplicateError(insertError)) {
    throw new Error(`vocabulary_items lemma insert failed: ${insertError.message}`);
  }

  const insertedItem = ((insertedRows ?? []) as VocabularyItemRow[])[0] ?? null;
  const item = insertedItem ?? await fetchVocabularyItemByWord(canonicalWord);
  if (!item) {
    throw new Error(`vocabulary_items lemma insert did not return item: ${canonicalWord}`);
  }

  if (insertedItem) {
    await replaceLiteVocabularySenses(item.id, liteResult.senses);
  }

  await insertVocabularyForms(item.id, canonicalWord, forms);
  return toLiteVocabularyResult(item);
}

async function lookupSavedWord(userId: string, vocabularyItemId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_saved_words')
    .select('id')
    .eq('user_id', userId)
    .eq('vocabulary_item_id', vocabularyItemId)
    .maybeSingle();

  if (error) {
    throw new Error(`user_saved_words lookup failed: ${error.message}`);
  }

  return Boolean(data);
}

async function lookupReviewState(userId: string, vocabularyItemId: string): Promise<MemoryState | null> {
  const { data, error } = await supabaseAdmin
    .from('review_states')
    .select('memory_state')
    .eq('user_id', userId)
    .eq('vocabulary_item_id', vocabularyItemId)
    .maybeSingle();

  if (error) {
    throw new Error(`review_states lookup failed: ${error.message}`);
  }

  return ((data as ReviewStateRow | null)?.memory_state ?? null) as MemoryState | null;
}

export async function lookupWordForPopover(userId: string, word: string): Promise<WordLookupResult> {
  const normalizedWord = sanitizeLookupWord(word);
  if (!normalizedWord) {
    throw new Error('Missing word');
  }

  await ensureLiteVocabularyEntry(normalizedWord, 'reading_popup');
  const item = await resolveExistingVocabularyItem(normalizedWord);
  if (!item) {
    throw new Error(`Vocabulary item not found after lookup: ${normalizedWord}`);
  }

  const [senses, rawInUserLibrary, srsState] = await Promise.all([
    fetchVocabularySenses(item.id),
    lookupSavedWord(userId, item.id),
    lookupReviewState(userId, item.id),
  ]);
  const inUserLibrary = rawInUserLibrary && (!srsState || srsState === 'new');

  return {
    vocabulary_item: item,
    senses,
    in_user_library: inUserLibrary,
    srs_state: srsState,
  };
}

async function replaceFullVocabularyChildren(vocabularyItemId: string, entry: GeminiWordResult) {
  const { error: deleteSensesError } = await supabaseAdmin
    .from('vocabulary_senses')
    .delete()
    .eq('vocabulary_item_id', vocabularyItemId);
  if (deleteSensesError) {
    throw new Error(`vocabulary_senses cleanup failed [${entry.word}]: ${deleteSensesError.message}`);
  }

  if (entry.senses.length > 0) {
    const { error: insertSensesError } = await supabaseAdmin
      .from('vocabulary_senses')
      .insert(
        entry.senses.map((sense) => ({
          vocabulary_item_id: vocabularyItemId,
          pos: sense.pos,
          meaning_zh: sense.meaning_zh,
          example_sentence: sense.example_sentence,
          example_translation_zh: sense.example_translation_zh,
        })),
      );
    if (insertSensesError) {
      throw new Error(`vocabulary_senses insert failed [${entry.word}]: ${insertSensesError.message}`);
    }
  }

  const { error: deleteMorphologyError } = await supabaseAdmin
    .from('vocabulary_morphology_parts')
    .delete()
    .eq('vocabulary_item_id', vocabularyItemId);
  if (deleteMorphologyError) {
    throw new Error(`vocabulary_morphology_parts cleanup failed [${entry.word}]: ${deleteMorphologyError.message}`);
  }

  if (entry.morphology.parts.length > 0) {
    const { error: insertMorphologyError } = await supabaseAdmin
      .from('vocabulary_morphology_parts')
      .insert(
        entry.morphology.parts.map((part, index) => ({
          vocabulary_item_id: vocabularyItemId,
          part_text: part.text,
          part_kind: part.kind,
          meaning_zh: part.meaning_zh,
          note_zh: part.note_zh,
          sort_order: index,
        })),
      );
    if (insertMorphologyError) {
      throw new Error(`vocabulary_morphology_parts insert failed [${entry.word}]: ${insertMorphologyError.message}`);
    }
  }

  const { error: deleteRelationsError } = await supabaseAdmin
    .from('vocabulary_relations')
    .delete()
    .eq('vocabulary_item_id', vocabularyItemId);
  if (deleteRelationsError) {
    throw new Error(`vocabulary_relations cleanup failed [${entry.word}]: ${deleteRelationsError.message}`);
  }

  const relationRows = [
    ...entry.derived_words.map((relation, index) => ({
      vocabulary_item_id: vocabularyItemId,
      relation_type: 'derived',
      related_word: relation.word,
      meaning_zh: relation.meaning_zh,
      note_zh: relation.note_zh,
      sort_order: index,
    })),
    ...entry.synonyms.map((relation, index) => ({
      vocabulary_item_id: vocabularyItemId,
      relation_type: 'synonym',
      related_word: relation.word,
      meaning_zh: relation.meaning_zh,
      note_zh: relation.note_zh,
      sort_order: index,
    })),
    ...entry.antonyms.map((relation, index) => ({
      vocabulary_item_id: vocabularyItemId,
      relation_type: 'antonym',
      related_word: relation.word,
      meaning_zh: relation.meaning_zh,
      note_zh: relation.note_zh,
      sort_order: index,
    })),
  ];

  if (relationRows.length > 0) {
    const { error: insertRelationsError } = await supabaseAdmin
      .from('vocabulary_relations')
      .insert(relationRows);
    if (insertRelationsError) {
      throw new Error(`vocabulary_relations insert failed [${entry.word}]: ${insertRelationsError.message}`);
    }
  }

  const { error: deleteConfusedError } = await supabaseAdmin
    .from('confused_words')
    .delete()
    .eq('vocabulary_item_id', vocabularyItemId);
  if (deleteConfusedError) {
    throw new Error(`confused_words cleanup failed [${entry.word}]: ${deleteConfusedError.message}`);
  }

  const confusions = entry.confusions.length > 0
    ? entry.confusions
    : entry.confused_word
      ? [{ word: entry.confused_word, difference_zh: entry.confused_diff_zh ?? '' }]
      : [];

  if (confusions.length > 0) {
    const { error: insertConfusedError } = await supabaseAdmin
      .from('confused_words')
      .insert(
        confusions.map((confusion, index) => ({
          vocabulary_item_id: vocabularyItemId,
          confused_word: confusion.word,
          difference_note_zh: confusion.difference_zh,
          sort_order: index,
        })),
      );
    if (insertConfusedError) {
      throw new Error(`confused_words insert failed [${entry.word}]: ${insertConfusedError.message}`);
    }
  }

  // Forms are GLOBAL UNIQUE(form). insertVocabularyForms handles dedup + ON CONFLICT.
  // Don't DELETE existing rows — first-write-wins across the whole table.
  if (entry.forms && entry.forms.length > 0) {
    await insertVocabularyForms(vocabularyItemId, entry.word, entry.forms);
  }
}

async function enrichVocabularyItemToFull(vocabularyItemId: string, source = 'reading_popup') {
  const item = await fetchVocabularyItemById(vocabularyItemId);
  if (!item) {
    throw new Error(`Vocabulary item not found: ${vocabularyItemId}`);
  }

  if (item.enrichment_level !== 'lite') {
    return;
  }

  const startedAt = Date.now();
  logger.info('[full-enrich] start', {
    vocabulary_item_id: item.id,
    word: item.word,
    source,
  });

  const [entry] = await enrichWords([item.word], {
    source,
    enrichmentType: 'full',
  });
  await replaceFullVocabularyChildren(item.id, entry);

  const { error: updateError } = await supabaseAdmin
    .from('vocabulary_items')
    .update({
      word: item.word,
      ipa_uk: entry.ipa_uk,
      ipa_us: entry.ipa_us,
      primary_meaning_zh: entry.primary_meaning_zh,
      ner_label: entry.ner_label,
      morphology_summary_zh: entry.morphology.summary_zh,
      memory_tip: entry.memory_tip,
      source_type: item.source_type ?? 'custom',
      enrichment_level: 'full',
    })
    .eq('id', item.id);

  if (updateError) {
    throw new Error(`vocabulary_items full update failed [${item.word}]: ${updateError.message}`);
  }

  logger.info('[full-enrich] complete', {
    vocabulary_item_id: item.id,
    word: item.word,
    source,
    duration_ms: Date.now() - startedAt,
  });
}

function queueFullEnrichmentForItem(item: VocabularyItemRow, source = 'reading_popup'): FullEnrichmentQueueResult {
  if (item.enrichment_level !== 'lite') {
    return {
      queued: false,
      vocabularyItemId: item.id,
      word: item.word,
      reason: 'already_full',
    };
  }

  if (fullEnrichmentInflight.has(item.id)) {
    return {
      queued: true,
      vocabularyItemId: item.id,
      word: item.word,
      reason: 'already_queued',
    };
  }

  const task = enrichVocabularyItemToFull(item.id, source)
    .catch((error) => {
      logger.error('[full-enrich] failed', error, {
        vocabulary_item_id: item.id,
        word: item.word,
        source,
      });
    })
    .finally(() => {
      fullEnrichmentInflight.delete(item.id);
    });

  fullEnrichmentInflight.set(item.id, task);

  return {
    queued: true,
    vocabularyItemId: item.id,
    word: item.word,
  };
}

export async function queueFullEnrichmentForVocabularyItemId(
  vocabularyItemId: string,
  source = 'reading_popup',
): Promise<FullEnrichmentQueueResult> {
  const item = await fetchVocabularyItemById(vocabularyItemId);
  if (!item) {
    return { queued: false, vocabularyItemId, reason: 'not_found' };
  }

  return queueFullEnrichmentForItem(item, source);
}

export async function queueFullEnrichmentForWord(
  word: string,
  source = 'manual_api',
): Promise<FullEnrichmentQueueResult> {
  const item = await resolveExistingVocabularyItem(word);
  if (!item) {
    return { queued: false, word: sanitizeLookupWord(word), reason: 'not_found' };
  }

  return queueFullEnrichmentForItem(item, source);
}
