import 'dotenv/config';
import { supabaseAdmin } from '../server/supabase.ts';

const READ_PAGE_SIZE = 1000;
const UPSERT_BATCH_SIZE = 500;

interface LearningGroupJoinRow {
  user_id: string | null;
  source_type: string | null;
  created_at: string | null;
}

interface LearningGroupWordJoinRow {
  vocabulary_item_id: string | null;
  learning_groups: LearningGroupJoinRow | LearningGroupJoinRow[] | null;
}

interface SavedWordCandidate {
  user_id: string;
  vocabulary_item_id: string;
  source: 'migration';
  saved_at: string;
}

interface ReviewStateRow {
  user_id: string;
  vocabulary_item_id: string;
  memory_state: string;
}

function asSingleGroup(value: LearningGroupWordJoinRow['learning_groups']) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function chunkRows<T>(rows: T[], chunkSize: number) {
  return Array.from(
    { length: Math.ceil(rows.length / chunkSize) },
    (_, index) => rows.slice(index * chunkSize, (index + 1) * chunkSize),
  );
}

function isEarlierTimestamp(candidate: string, current: string) {
  const candidateTime = Date.parse(candidate);
  const currentTime = Date.parse(current);

  if (Number.isNaN(candidateTime)) return false;
  if (Number.isNaN(currentTime)) return true;

  return candidateTime < currentTime;
}

async function collectSavedWordCandidates() {
  const candidateByKey = new Map<string, SavedWordCandidate>();
  let from = 0;
  let sourceRows = 0;
  let validSourceRows = 0;
  let skippedMissingUser = 0;
  let skippedNonCustomGroup = 0;
  let skippedMissingVocabularyItem = 0;
  let duplicateSourceRows = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('learning_group_words')
      .select(`
        id,
        vocabulary_item_id,
        learning_groups!inner (
          user_id,
          source_type,
          created_at
        )
      `)
      .order('id', { ascending: true })
      .range(from, from + READ_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`learning_group_words lookup failed: ${error.message}`);
    }

    const rows = (data ?? []) as LearningGroupWordJoinRow[];
    if (rows.length === 0) {
      break;
    }

    sourceRows += rows.length;

    for (const row of rows) {
      const group = asSingleGroup(row.learning_groups);
      const userId = group?.user_id?.trim() ?? '';
      const sourceType = group?.source_type?.trim() ?? '';
      const vocabularyItemId = row.vocabulary_item_id?.trim() ?? '';

      if (!userId) {
        skippedMissingUser += 1;
        continue;
      }

      if (sourceType !== 'custom') {
        skippedNonCustomGroup += 1;
        continue;
      }

      if (!vocabularyItemId) {
        skippedMissingVocabularyItem += 1;
        continue;
      }

      validSourceRows += 1;
      const savedAt = group?.created_at ?? new Date().toISOString();
      const key = `${userId}\u0000${vocabularyItemId}`;
      const existing = candidateByKey.get(key);

      if (!existing) {
        candidateByKey.set(key, {
          user_id: userId,
          vocabulary_item_id: vocabularyItemId,
          source: 'migration',
          saved_at: savedAt,
        });
        continue;
      }

      duplicateSourceRows += 1;
      if (isEarlierTimestamp(savedAt, existing.saved_at)) {
        existing.saved_at = savedAt;
      }
    }

    if (rows.length < READ_PAGE_SIZE) {
      break;
    }

    from += READ_PAGE_SIZE;
  }

  return {
    candidates: [...candidateByKey.values()].sort((left, right) => (
      left.user_id.localeCompare(right.user_id)
      || left.saved_at.localeCompare(right.saved_at)
      || left.vocabulary_item_id.localeCompare(right.vocabulary_item_id)
    )),
    stats: {
      sourceRows,
      validSourceRows,
      skippedMissingUser,
      skippedNonCustomGroup,
      skippedMissingVocabularyItem,
      duplicateSourceRows,
    },
  };
}

async function upsertSavedWords(candidates: SavedWordCandidate[]) {
  let insertedRows = 0;

  for (const [index, batch] of chunkRows(candidates, UPSERT_BATCH_SIZE).entries()) {
    const { data, error } = await supabaseAdmin
      .from('user_saved_words')
      .upsert(batch, {
        onConflict: 'user_id,vocabulary_item_id',
        ignoreDuplicates: true,
      })
      .select('id');

    if (error) {
      throw new Error(`user_saved_words upsert failed [batch ${index + 1}]: ${error.message}`);
    }

    insertedRows += data?.length ?? 0;
    console.log(
      `[${index + 1}/${Math.ceil(candidates.length / UPSERT_BATCH_SIZE)}] saved=${data?.length ?? 0} batchSize=${batch.length}`,
    );
  }

  return insertedRows;
}

async function prepareSavedWordCandidates(candidates: SavedWordCandidate[]) {
  const stateByKey = new Map<string, ReviewStateRow>();
  const candidatesByUser = new Map<string, SavedWordCandidate[]>();

  for (const candidate of candidates) {
    const rows = candidatesByUser.get(candidate.user_id) ?? [];
    rows.push(candidate);
    candidatesByUser.set(candidate.user_id, rows);
  }

  for (const [userId, rows] of candidatesByUser) {
    const vocabularyItemIds = Array.from(new Set(rows.map((row) => row.vocabulary_item_id)));
    for (const chunk of chunkRows(vocabularyItemIds, 100)) {
      const { data, error } = await supabaseAdmin
        .from('review_states')
        .select('user_id, vocabulary_item_id, memory_state')
        .eq('user_id', userId)
        .in('vocabulary_item_id', chunk);

      if (error) {
        throw new Error(`review_states lookup failed: ${error.message}`);
      }

      for (const row of (data ?? []) as ReviewStateRow[]) {
        stateByKey.set(`${row.user_id}\u0000${row.vocabulary_item_id}`, row);
      }
    }
  }

  const missingCandidates: SavedWordCandidate[] = [];
  const eligibleCandidates: SavedWordCandidate[] = [];
  let skippedNonNewState = 0;

  for (const candidate of candidates) {
    const state = stateByKey.get(`${candidate.user_id}\u0000${candidate.vocabulary_item_id}`);
    if (!state) {
      missingCandidates.push(candidate);
      eligibleCandidates.push(candidate);
      continue;
    }

    if (state.memory_state === 'new') {
      eligibleCandidates.push(candidate);
      continue;
    }

    skippedNonNewState += 1;
  }

  let createdReviewStates = 0;
  for (const [index, batch] of chunkRows(missingCandidates, UPSERT_BATCH_SIZE).entries()) {
    const { data, error } = await supabaseAdmin
      .from('review_states')
      .upsert(
        batch.map((candidate) => ({
          user_id: candidate.user_id,
          vocabulary_item_id: candidate.vocabulary_item_id,
          memory_state: 'new',
          interval_days: null,
          next_review_at: null,
          graduated_at: null,
        })),
        {
          onConflict: 'user_id,vocabulary_item_id',
          ignoreDuplicates: true,
        },
      )
      .select('id');

    if (error) {
      throw new Error(`review_states upsert failed [batch ${index + 1}]: ${error.message}`);
    }

    createdReviewStates += data?.length ?? 0;
  }

  return {
    candidates: eligibleCandidates,
    stats: {
      createdReviewStates,
      skippedNonNewState,
    },
  };
}

async function main() {
  console.log('Collecting historical learning group words...');
  const { candidates, stats } = await collectSavedWordCandidates();

  console.log(
    [
      `sourceRows=${stats.sourceRows}`,
      `validSourceRows=${stats.validSourceRows}`,
      `uniqueCandidates=${candidates.length}`,
      `duplicateSourceRows=${stats.duplicateSourceRows}`,
      `skippedMissingUser=${stats.skippedMissingUser}`,
      `skippedNonCustomGroup=${stats.skippedNonCustomGroup}`,
      `skippedMissingVocabularyItem=${stats.skippedMissingVocabularyItem}`,
    ].join(' '),
  );

  if (candidates.length === 0) {
    console.log('No saved words to migrate.');
    return;
  }

  const prepared = await prepareSavedWordCandidates(candidates);
  const insertedRows = await upsertSavedWords(prepared.candidates);
  const alreadyExistingRows = prepared.candidates.length - insertedRows;

  console.log(
    [
      'Migration complete.',
      `inserted=${insertedRows}`,
      `alreadyExisting=${alreadyExistingRows}`,
      `createdReviewStates=${prepared.stats.createdReviewStates}`,
      `skippedNonNewState=${prepared.stats.skippedNonNewState}`,
      `uniqueCandidates=${candidates.length}`,
      `eligibleCandidates=${prepared.candidates.length}`,
    ].join(' '),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
