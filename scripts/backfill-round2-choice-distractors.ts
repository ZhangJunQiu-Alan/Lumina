import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_LIBRARY_DEFINITIONS, isOfficialLibraryId } from '../src/lib/officialLibrary.ts';
import {
  hasCompleteRound2ChoiceDistractors,
  validateRound2ChoiceDistractors,
} from '../shared/round2ChoiceDistractors.ts';
import { supabaseAdmin } from '../shared/server/supabase.ts';
import type { OfficialLibraryId, Round2ChoiceDistractor } from '../shared/types.ts';
import { normalizeWordKey } from '../shared/wordBatch.ts';

interface CliOptions {
  dataDir: string;
  dryRun: boolean;
  libraryId: OfficialLibraryId | null;
  limit: number | null;
  offset: number;
  cursor: string | null;
  write: boolean;
}

interface DataRecord {
  word: string;
  distractors: Round2ChoiceDistractor[];
}

interface VocabularyItemBackfillRow {
  id: string;
  word: string;
  source_type: string | null;
  round2_choice_distractors: unknown;
}

interface PendingUpdate {
  id: string;
  word: string;
  distractors: Round2ChoiceDistractor[];
}

const DEFAULT_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data/round2-choice-distractors');
const QUERY_CHUNK_SIZE = 200;
const UPDATE_CONCURRENCY = 10;

function parsePositiveInt(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dataDir: DEFAULT_DATA_DIR,
    dryRun: false,
    libraryId: null,
    limit: null,
    offset: 0,
    cursor: null,
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--data-dir' && next) {
      options.dataDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--library-id' && next) {
      if (!isOfficialLibraryId(next)) {
        throw new Error(`Unknown official library id: ${next}`);
      }
      options.libraryId = next;
      index += 1;
      continue;
    }
    if (arg === '--limit' && next) {
      options.limit = parsePositiveInt(next, '--limit');
      index += 1;
      continue;
    }
    if (arg === '--offset' && next) {
      options.offset = parseNonNegativeInt(next, '--offset');
      index += 1;
      continue;
    }
    if (arg === '--cursor' && next) {
      options.cursor = normalizeWordKey(next);
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--write') {
      options.write = true;
      continue;
    }
  }

  if (options.cursor && options.offset > 0) {
    throw new Error('--cursor and --offset cannot be combined');
  }
  if (options.dryRun && options.write) {
    throw new Error('--dry-run and --write cannot be combined');
  }

  return options;
}

function resolveTargetWords(options: CliOptions) {
  const definitions = options.libraryId
    ? OFFICIAL_LIBRARY_DEFINITIONS.filter((definition) => definition.id === options.libraryId)
    : OFFICIAL_LIBRARY_DEFINITIONS;
  const words = Array.from(new Set(definitions.flatMap((definition) => definition.words.map(normalizeWordKey)))).filter(
    Boolean,
  );

  let startIndex = options.offset;
  if (options.cursor) {
    const cursorIndex = words.indexOf(options.cursor);
    if (cursorIndex === -1) {
      throw new Error(`--cursor word is not in the selected official library scope: ${options.cursor}`);
    }
    startIndex = cursorIndex + 1;
  }

  const selected =
    options.limit === null ? words.slice(startIndex) : words.slice(startIndex, startIndex + options.limit);
  return {
    total: words.length,
    selected,
    startIndex,
  };
}

async function loadDistractorData(dataDir: string) {
  const files = (await readdir(dataDir))
    .filter((file) => file.endsWith('.jsonl'))
    .sort((left, right) => left.localeCompare(right));
  const records = new Map<string, Round2ChoiceDistractor[]>();

  for (const file of files) {
    const filePath = path.join(dataDir, file);
    const content = await readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const parsed = JSON.parse(trimmed) as DataRecord;
      const word = normalizeWordKey(parsed.word);
      if (!word) {
        throw new Error(`${file}:${lineIndex + 1} word is required`);
      }
      if (records.has(word)) {
        throw new Error(`${file}:${lineIndex + 1} duplicate data record for ${word}`);
      }

      const validation = validateRound2ChoiceDistractors(word, parsed.distractors);
      if (!validation.valid) {
        throw new Error(`${file}:${lineIndex + 1} invalid distractors for ${word}: ${validation.errors.join('; ')}`);
      }

      records.set(word, validation.distractors);
    });
  }

  return {
    files,
    records,
  };
}

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

async function fetchVocabularyRows(words: string[]) {
  const rows: VocabularyItemBackfillRow[] = [];

  for (const wordChunk of chunk(words, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin
      .from('vocabulary_items')
      .select('id, word, source_type, round2_choice_distractors')
      .in('word', wordChunk);

    if (error) {
      throw new Error(`vocabulary_items lookup failed: ${error.message}`);
    }

    rows.push(...((data ?? []) as VocabularyItemBackfillRow[]));
  }

  return new Map(rows.map((row) => [normalizeWordKey(row.word), row]));
}

function buildPendingUpdates(
  targetWords: string[],
  rowsByWord: Map<string, VocabularyItemBackfillRow>,
  dataByWord: Map<string, Round2ChoiceDistractor[]>,
) {
  const pendingUpdates: PendingUpdate[] = [];
  const missingData: string[] = [];
  const missingRows: string[] = [];
  const skippedComplete: string[] = [];

  for (const word of targetWords) {
    const distractors = dataByWord.get(word);
    if (!distractors) {
      missingData.push(word);
      continue;
    }

    const row = rowsByWord.get(word);
    if (!row) {
      missingRows.push(word);
      continue;
    }
    if (hasCompleteRound2ChoiceDistractors(row.round2_choice_distractors)) {
      skippedComplete.push(word);
      continue;
    }

    pendingUpdates.push({
      id: row.id,
      word,
      distractors,
    });
  }

  return {
    pendingUpdates,
    missingData,
    missingRows,
    skippedComplete,
  };
}

async function writeUpdates(updates: PendingUpdate[]) {
  let written = 0;

  for (const updateChunk of chunk(updates, UPDATE_CONCURRENCY)) {
    await Promise.all(
      updateChunk.map(async (update) => {
        const { error } = await supabaseAdmin
          .from('vocabulary_items')
          .update({ round2_choice_distractors: update.distractors })
          .eq('id', update.id);

        if (error) {
          throw new Error(`round2 distractor update failed [${update.word}]: ${error.message}`);
        }
      }),
    );
    written += updateChunk.length;
  }

  return written;
}

function summarizeList(items: string[], limit = 10) {
  return items.slice(0, limit);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = options.write ? 'write' : 'dry-run';
  const target = resolveTargetWords(options);
  const data = await loadDistractorData(options.dataDir);
  const rowsByWord = await fetchVocabularyRows(target.selected);
  const result = buildPendingUpdates(target.selected, rowsByWord, data.records);
  const written = options.write ? await writeUpdates(result.pendingUpdates) : 0;

  console.log(
    JSON.stringify(
      {
        mode,
        dataFiles: data.files,
        libraryId: options.libraryId ?? 'all',
        targetTotal: target.total,
        selectedCount: target.selected.length,
        startIndex: target.startIndex,
        pendingUpdateCount: result.pendingUpdates.length,
        written,
        skippedCompleteCount: result.skippedComplete.length,
        missingRowCount: result.missingRows.length,
        missingDataCount: result.missingData.length,
        samplePendingUpdates: result.pendingUpdates.slice(0, 5).map((update) => ({
          word: update.word,
          distractors: update.distractors,
        })),
        sampleMissingData: summarizeList(result.missingData),
        sampleMissingRows: summarizeList(result.missingRows),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
