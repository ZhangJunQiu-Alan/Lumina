import 'dotenv/config';
import { enrichFormsOnly } from '../shared/server/gemini.ts';
import { supabaseAdmin } from '../shared/server/supabase.ts';
import { normalizeWordKey } from '../shared/wordBatch.ts';

interface CliOptions {
  limit: number | null;
  outerBatchSize: number;
  dryRun: boolean;
}

const DEFAULT_OUTER_BATCH_SIZE = 500;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: null,
    outerBatchSize: DEFAULT_OUTER_BATCH_SIZE,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--limit' && next) {
      options.limit = Number(next);
      i += 1;
    } else if (arg === '--outer-batch' && next) {
      options.outerBatchSize = Number(next);
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
backfill-vocabulary-item-forms — populate vocabulary_item_forms for existing vocabulary_items.

Options:
  --limit <N>          Only process first N words (useful for testing)
  --outer-batch <N>    Words per LLM-batch round before DB insert (default ${DEFAULT_OUTER_BATCH_SIZE})
  --dry-run            Skip DB writes; print what would be inserted

Concurrency / chunk-size are tuned via env vars in server/gemini.ts:
  GEMINI_FORMS_BATCH_SIZE        (default 30)
  GEMINI_FORMS_MAX_CONCURRENCY   (default 25)
  GEMINI_FORMS_MAX_OUTPUT_TOKENS (default 2048)
`);
      process.exit(0);
    }
  }
  return options;
}

async function fetchAllVocabularyItems(): Promise<Array<{ id: string; word: string }>> {
  const all: Array<{ id: string; word: string }> = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('vocabulary_items')
      .select('id, word')
      .order('word', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`vocabulary_items page fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function fetchVocabularyItemIdsWithForms(): Promise<Set<string>> {
  const set = new Set<string>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('vocabulary_item_forms')
      .select('vocabulary_item_id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`vocabulary_item_forms page fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) set.add((row as { vocabulary_item_id: string }).vocabulary_item_id);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return set;
}

async function insertFormsRows(
  rows: Array<{ vocabulary_item_id: string; form: string }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error, data } = await supabaseAdmin
    .from('vocabulary_item_forms')
    .upsert(rows, { onConflict: 'form', ignoreDuplicates: true })
    .select('id');
  if (error) {
    console.error('  ✗ insert failed:', error.message);
    return 0;
  }
  return data?.length ?? 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  console.log('🔍 Surveying current state...');
  const [allItems, idsWithForms] = await Promise.all([
    fetchAllVocabularyItems(),
    fetchVocabularyItemIdsWithForms(),
  ]);
  console.log(`   vocabulary_items total: ${allItems.length}`);
  console.log(`   already has forms:      ${idsWithForms.size}`);

  let needsBackfill = allItems.filter((item) => !idsWithForms.has(item.id));
  console.log(`   need backfill:          ${needsBackfill.length}`);

  if (options.limit !== null && Number.isFinite(options.limit)) {
    needsBackfill = needsBackfill.slice(0, options.limit);
    console.log(`   --limit applied:        processing ${needsBackfill.length}`);
  }
  if (options.dryRun) console.log('   (dry-run mode: no DB writes)');

  if (needsBackfill.length === 0) {
    console.log('\n✅ Nothing to do.');
    return;
  }

  let processedWords = 0;
  let totalFormsGenerated = 0;
  let totalFormsInserted = 0;

  for (let outerStart = 0; outerStart < needsBackfill.length; outerStart += options.outerBatchSize) {
    const slice = needsBackfill.slice(outerStart, outerStart + options.outerBatchSize);
    const wordToId = new Map<string, string>();
    for (const item of slice) wordToId.set(normalizeWordKey(item.word), item.id);

    const sliceStartedAt = Date.now();
    const llmResults = await enrichFormsOnly(
      slice.map((item) => item.word),
      { source: 'forms_backfill', enrichmentType: 'forms_only' },
    );
    const llmDurationMs = Date.now() - sliceStartedAt;

    const insertRows: Array<{ vocabulary_item_id: string; form: string }> = [];
    for (const result of llmResults) {
      const id = wordToId.get(normalizeWordKey(result.word));
      if (!id) continue;
      for (const form of result.forms) {
        insertRows.push({ vocabulary_item_id: id, form });
      }
    }
    totalFormsGenerated += insertRows.length;

    let insertedCount = 0;
    if (!options.dryRun && insertRows.length > 0) {
      // Chunked insert to avoid hitting DB payload limits
      const insertChunkSize = 500;
      for (let i = 0; i < insertRows.length; i += insertChunkSize) {
        insertedCount += await insertFormsRows(insertRows.slice(i, i + insertChunkSize));
      }
    }
    totalFormsInserted += insertedCount;
    processedWords += slice.length;

    const elapsedTotal = Math.round((Date.now() - startedAt) / 1000);
    const wordsPerSec = (processedWords / Math.max(elapsedTotal, 1)).toFixed(1);
    console.log(
      `[${processedWords}/${needsBackfill.length}] llm ${llmDurationMs}ms · ` +
        `${insertRows.length} forms generated, ${options.dryRun ? '(dry-run)' : `${insertedCount} inserted`} · ` +
        `${wordsPerSec} words/sec · ${elapsedTotal}s elapsed`,
    );
  }

  const totalDurationS = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n✅ Done in ${totalDurationS}s`);
  console.log(`   words processed:    ${processedWords}`);
  console.log(`   forms generated:    ${totalFormsGenerated}`);
  console.log(`   forms inserted:     ${options.dryRun ? '(dry-run)' : totalFormsInserted}`);
  if (totalFormsGenerated > totalFormsInserted && !options.dryRun) {
    console.log(`   forms skipped (UNIQUE conflict or insert error): ${totalFormsGenerated - totalFormsInserted}`);
  }
}

main().catch((error) => {
  console.error('\n❌ Backfill failed:', error);
  process.exit(1);
});
