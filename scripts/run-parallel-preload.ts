import 'dotenv/config';
import { OFFICIAL_LIBRARY_DEFINITIONS } from '../src/lib/officialLibrary.ts';
import { enrichWords, type GeminiWordResult } from '../server/gemini.ts';
import { supabaseAdmin } from '../server/supabase.ts';
import { analyzeWordBatch, formatDuplicateWordsMessage, normalizeWordKey, sanitizeWordInput } from '../shared/wordBatch.ts';

const ALL_OFFICIAL_WORDS = Array.from(
  new Set(
    OFFICIAL_LIBRARY_DEFINITIONS.flatMap((def) => def.words)
  )
);

interface CliOptions {
  batchSize: number;
  delayMs: number;
  limit: number | null;
  retryCount: number;
  retryDelayMs: number;
}

interface ExistingVocabularyRow {
  word: string;
  source_type: string | null;
}

interface VocabularyLookupRow {
  word: string;
  ipa_uk: string | null;
  ipa_us: string | null;
  primary_meaning_zh: string | null;
  morphology_summary_zh: string | null;
  memory_tip: string | null;
  vocabulary_senses: Array<{
    pos: string | null;
    meaning_zh: string | null;
    example_sentence: string | null;
    example_translation_zh: string | null;
  }> | null;
}

const DEFAULT_BATCH_SIZE = 3; // MODIFIED: 强制设置 batchSize 为 3
const DEFAULT_DELAY_MS = 0;
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;
const OFFICIAL_WORD_CHUNK_SIZE = 200;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    batchSize: DEFAULT_BATCH_SIZE,
    delayMs: DEFAULT_DELAY_MS,
    limit: null,
    retryCount: DEFAULT_RETRY_COUNT,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--batch-size' && next) {
      options.batchSize = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === '--delay-ms' && next) {
      options.delayMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === '--limit' && next) {
      options.limit = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === '--retry' && next) {
      options.retryCount = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === '--retry-delay-ms' && next) {
      options.retryDelayMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error('--limit 必须是正整数。');
  }

  return options;
}

function chunkWords(words: string[], chunkSize: number) {
  return Array.from(
    { length: Math.ceil(words.length / chunkSize) },
    (_, index) => words.slice(index * chunkSize, (index + 1) * chunkSize),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isVocabularyReady(row: VocabularyLookupRow) {
  const senses = row.vocabulary_senses ?? [];
  const senseReady = senses.length > 0 && senses.every((sense) => (
    Boolean(
      sense.pos?.trim()
      && sense.meaning_zh?.trim()
      && sense.example_sentence?.trim()
      && sense.example_translation_zh?.trim()
    )
  ));

  return Boolean(
    row.ipa_uk?.trim()
    && row.ipa_us?.trim()
    && row.primary_meaning_zh?.trim()
    && row.morphology_summary_zh?.trim()
    && row.memory_tip?.trim()
    && senseReady,
  );
}

async function collectMissingOfficialWords() {
  const readyWords = new Set<string>();

  for (const words of chunkWords(ALL_OFFICIAL_WORDS.map(normalizeWordKey), OFFICIAL_WORD_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from('vocabulary_items')
      .select(`
        word,
        ipa_uk,
        ipa_us,
        primary_meaning_zh,
        morphology_summary_zh,
        memory_tip,
        vocabulary_senses (
          pos,
          meaning_zh,
          example_sentence,
          example_translation_zh
        )
      `)
      .in('word', words);

    if (error) {
      throw new Error(`vocabulary_items readiness lookup failed: ${error.message}`);
    }

    for (const row of (data ?? []) as VocabularyLookupRow[]) {
      if (isVocabularyReady(row)) {
        readyWords.add(normalizeWordKey(row.word));
      }
    }
  }

  return ALL_OFFICIAL_WORDS.filter((word) => !readyWords.has(normalizeWordKey(word)));
}

async function persistEnrichedBatch(enriched: GeminiWordResult[]) {
  const preparedEnriched = enriched.map((entry) => ({
    ...entry,
    word: sanitizeWordInput(entry.word),
  }));
  const batch = analyzeWordBatch(preparedEnriched.map((entry) => entry.word));

  if (batch.duplicateWords.length > 0) {
    throw new Error(formatDuplicateWordsMessage(batch.duplicateWords));
  }

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('vocabulary_items')
    .select('word, source_type')
    .in('word', batch.normalizedWords);

  if (existingError) {
    throw new Error(`vocabulary_items source lookup failed: ${existingError.message}`);
  }

  const existingSourceTypeByWord = new Map(
    ((existingRows ?? []) as ExistingVocabularyRow[]).map((row) => [row.word, row.source_type]),
  );

  const items = preparedEnriched.map((entry) => {
    const normalizedWord = normalizeWordKey(entry.word);

    return {
      word: normalizedWord,
      ipa_uk: entry.ipa_uk,
      ipa_us: entry.ipa_us,
      primary_meaning_zh: entry.primary_meaning_zh,
      ner_label: entry.ner_label,
      morphology_summary_zh: entry.morphology.summary_zh,
      memory_tip: entry.memory_tip,
      source_type: existingSourceTypeByWord.get(normalizedWord) ?? 'system',
    };
  });

  const { data: insertedItems, error: itemsError } = await supabaseAdmin
    .from('vocabulary_items')
    .upsert(items, { onConflict: 'word' })
    .select('id, word');

  if (itemsError) {
    throw new Error(`vocabulary_items upsert failed: ${itemsError.message}`);
  }

  const wordIdMap = new Map(
    (insertedItems ?? []).map((row) => [row.word as string, row.id as string]),
  );

  for (const entry of preparedEnriched) {
    const vocabularyItemId = wordIdMap.get(normalizeWordKey(entry.word));
    const confusions = entry.confusions.length > 0
      ? entry.confusions
      : entry.confused_word
        ? [{ word: entry.confused_word, difference_zh: entry.confused_diff_zh ?? '' }]
        : [];

    if (!vocabularyItemId) {
      throw new Error(`词条写入后没有拿到 id：${entry.word}`);
    }

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
  }
}

async function enrichWithRetries(words: string[], retryCount: number, retryDelayMs: number) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      return await enrichWords(words, { source: 'official_library', enrichmentType: 'batch' });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Batch failed (${attempt}/${retryCount}): ${message}`);
      if (attempt < retryCount) {
        await sleep(retryDelayMs * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function printCoverageSummary(label: string) {
  const missingWords = await collectMissingOfficialWords();
  const readyCount = ALL_OFFICIAL_WORDS.length - missingWords.length;
  console.log(`[${label}] ready=${readyCount} missing=${missingWords.length} total=${ALL_OFFICIAL_WORDS.length}`);
}

async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing: Promise<void>[] = [];
  for (let i = 0; i < array.length; i++) {
    const item = array[i];
    const p = Promise.resolve().then(() => iteratorFn(item, i));
    ret.push(p);

    if (poolLimit <= array.length) {
      const e: Promise<void> = p.then(() => {
        executing.splice(executing.indexOf(e), 1);
      });
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  options.batchSize = 3; // 强制要求每个 batch 为 3
  const CONCURRENCY_LIMIT = 10; // 强制开启 10 个会话

  await printCoverageSummary('before');

  const missingWords = await collectMissingOfficialWords();
  const targetWords = options.limit === null ? missingWords : missingWords.slice(0, options.limit);

  if (targetWords.length === 0) {
    console.log('官方词库词条已经全部预载完成，不需要继续补。');
    return;
  }

  console.log(
    `准备补齐 ${targetWords.length} 个官方词条，batchSize=${options.batchSize} 并发数=${CONCURRENCY_LIMIT} delayMs=${options.delayMs} retry=${options.retryCount} retryDelayMs=${options.retryDelayMs}`,
  );

  const batches = chunkWords(targetWords, options.batchSize);
  let completedBatches = 0;

  await asyncPool(CONCURRENCY_LIMIT, batches, async (words, index) => {
    const batchLabel = `${index + 1}/${batches.length}`;
    console.log(`[START ${batchLabel}] 词汇: ${words.join(', ')}`);

    try {
      const enriched = await enrichWithRetries(words, options.retryCount, options.retryDelayMs);
      await persistEnrichedBatch(enriched);

      completedBatches++;
      const processedCount = Math.min(completedBatches * options.batchSize, targetWords.length);
      console.log(`[SUCCESS ${batchLabel}] ✅ 保存成功. 进度: ${processedCount}/${targetWords.length}`);

      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    } catch (err) {
      console.error(`[ERROR ${batchLabel}] ❌ 处理失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  await printCoverageSummary('after');
  console.log('官方词库预载完成。');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
