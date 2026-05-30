import 'dotenv/config';
import { OFFICIAL_LIBRARY_DEFINITIONS } from '../src/lib/officialLibrary.ts';
import { getOrCreateAudio } from '../shared/server/audio.ts';
import { supabaseAdmin } from '../shared/server/supabase.ts';
import { normalizeWordKey } from '../shared/wordBatch.ts';

const ALL_OFFICIAL_WORDS = Array.from(
  new Set(
    OFFICIAL_LIBRARY_DEFINITIONS.flatMap((def) => def.words)
  )
);

interface CliOptions {
  batchSize: number;
  delayMs: number;
  retryCount: number;
  retryDelayMs: number;
  limit: number | null;
}

interface AudioLookupRow {
  word: string;
  ipa_uk: string | null;
  primary_meaning_zh: string | null;
  memory_tip: string | null;
  audio_uk_url: string | null;
  audio_us_url: string | null;
  vocabulary_senses: Array<{ pos: string | null }> | null;
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_DELAY_MS = 500;
const DEFAULT_RETRY_COUNT = 5;
const DEFAULT_RETRY_DELAY_MS = 5000;
const LOOKUP_CHUNK_SIZE = 200;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    batchSize: DEFAULT_BATCH_SIZE,
    delayMs: DEFAULT_DELAY_MS,
    retryCount: DEFAULT_RETRY_COUNT,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    limit: null,
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

    if (arg === '--limit' && next) {
      options.limit = Number.parseInt(next, 10);
      index += 1;
    }
  }

  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error('--batch-size 必须是正整数。');
  }

  if (!Number.isInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay-ms 必须是大于等于 0 的整数。');
  }

  if (!Number.isInteger(options.retryCount) || options.retryCount < 1) {
    throw new Error('--retry 必须是大于等于 1 的整数。');
  }

  if (!Number.isInteger(options.retryDelayMs) || options.retryDelayMs < 0) {
    throw new Error('--retry-delay-ms 必须是大于等于 0 的整数。');
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

function isReadyForAudio(row: AudioLookupRow) {
  return Boolean(
    row.ipa_uk?.trim()
    && row.primary_meaning_zh?.trim()
    && row.memory_tip?.trim()
    && (row.vocabulary_senses?.length ?? 0) > 0,
  );
}

async function collectOfficialWordsMissingAudio() {
  const officialWords = ALL_OFFICIAL_WORDS.map(normalizeWordKey);
  const missingWords: string[] = [];
  let readyCount = 0;

  for (const words of chunkWords(officialWords, LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from('vocabulary_items')
      .select(`
        word,
        ipa_uk,
        primary_meaning_zh,
        memory_tip,
        audio_uk_url,
        audio_us_url,
        vocabulary_senses (
          pos
        )
      `)
      .in('word', words);

    if (error) {
      throw new Error(`audio lookup failed: ${error.message}`);
    }

    const byWord = new Map(
      ((data ?? []) as AudioLookupRow[]).map((row) => [normalizeWordKey(row.word), row]),
    );

    for (const word of words) {
      const row = byWord.get(word);
      if (!row || !isReadyForAudio(row)) {
        continue;
      }

      readyCount += 1;

      if (!(row.audio_uk_url && row.audio_us_url)) {
        missingWords.push(word);
      }
    }
  }

  return { readyCount, missingWords };
}

async function warmWordAudio(word: string, options: Pick<CliOptions, 'retryCount' | 'retryDelayMs'>) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.retryCount; attempt += 1) {
    try {
      await getOrCreateAudio(word, 'uk');
      await getOrCreateAudio(word, 'us');
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Audio failed for ${word} (${attempt}/${options.retryCount}): ${message}`);
      if (attempt < options.retryCount) {
        await sleep(options.retryDelayMs * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function printSummary(label: string) {
  const { readyCount, missingWords } = await collectOfficialWordsMissingAudio();
  console.log(`[${label}] ready=${readyCount} missingAudio=${missingWords.length}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await printSummary('before');

  const { missingWords } = await collectOfficialWordsMissingAudio();
  const targetWords = options.limit === null ? missingWords : missingWords.slice(0, options.limit);

  if (targetWords.length === 0) {
    console.log('当前已准备好的官方词条都已经有双音频了。');
    return;
  }

  console.log(
    `准备补齐 ${targetWords.length} 个官方词条音频，batchSize=${options.batchSize} delayMs=${options.delayMs} retry=${options.retryCount} retryDelayMs=${options.retryDelayMs}`,
  );

  const batches = chunkWords(targetWords, options.batchSize);

  for (const [index, words] of batches.entries()) {
    const batchLabel = `${index + 1}/${batches.length}`;
    console.log(`\n[${batchLabel}] warming ${words.length} words: ${words.slice(0, 3).join(', ')}${words.length > 3 ? '...' : ''}`);

    for (const [wordIndex, word] of words.entries()) {
      await warmWordAudio(word, options);
      const processedCount = index * options.batchSize + wordIndex + 1;
      console.log(`[${batchLabel}] audio ok for ${word} (${processedCount}/${targetWords.length})`);
      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }
  }

  await printSummary('after');
  console.log('官方词库音频预热完成。');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
