import assert from 'node:assert/strict';
import { IELTS_WORDS_FLAT } from '../src/data/ielts-vocab.js';
import { GRE_ZHENKAO_V7_WORDS } from '../src/data/gre-zhenkao-v7.js';
import {
  buildOfficialBatchFromRows,
  buildOfficialLibrarySummary,
  formatOfficialCounterGroupName,
  formatOfficialGroupName,
  getOfficialWordPosition,
  isOfficialGroupName,
  OFFICIAL_BATCH_SIZE,
  OFFICIAL_PREFETCH_REMAINING_THRESHOLD,
  resolveOfficialStudyModeFromGroupName,
  resolveOfficialLibraryStartMode,
  sortWordsByOfficialOrder,
  resolveOfficialLibraryId,
} from '../src/lib/officialLibrary.js';
import { reorderOfficialSessionQueue } from '../shared/officialSessionReorder.ts';
import type { LibraryGroupSummary, OfficialResumeTargets, ResumeCandidate } from '../src/types.js';

function makeGroupSummary(overrides: Partial<LibraryGroupSummary> = {}): LibraryGroupSummary {
  return {
    id: overrides.id ?? 'g',
    title: overrides.title ?? formatOfficialGroupName('ielts-vocab', 0, OFFICIAL_BATCH_SIZE),
    createdAt: overrides.createdAt ?? '2026-04-18T00:00:00.000Z',
    wordCount: overrides.wordCount ?? OFFICIAL_BATCH_SIZE,
    sourceType: overrides.sourceType ?? 'system',
    status: overrides.status ?? 'active',
    libraryId: overrides.libraryId ?? 'ielts-vocab',
    sessionRound: overrides.sessionRound ?? 'round1',
    completedAt: overrides.completedAt ?? null,
  };
}

assert.equal(new Set(IELTS_WORDS_FLAT.map((word) => word.trim().toLowerCase())).size, IELTS_WORDS_FLAT.length);
assert.equal(new Set(GRE_ZHENKAO_V7_WORDS.map((word) => word.trim().toLowerCase())).size, GRE_ZHENKAO_V7_WORDS.length);
assert.equal(OFFICIAL_BATCH_SIZE, 40);
assert.equal(OFFICIAL_PREFETCH_REMAINING_THRESHOLD, 5);

const officialGroups: LibraryGroupSummary[] = [
  makeGroupSummary({
    id: 'g1',
    title: formatOfficialGroupName('ielts-vocab', 0, OFFICIAL_BATCH_SIZE),
    status: 'completed',
    sessionRound: 'article',
    completedAt: '2026-04-18T00:20:00.000Z',
  }),
  makeGroupSummary({
    id: 'g2',
    title: formatOfficialGroupName('ielts-vocab', OFFICIAL_BATCH_SIZE, OFFICIAL_BATCH_SIZE),
    createdAt: '2026-04-19T00:00:00.000Z',
    status: 'active',
    sessionRound: 'article',
  }),
];

const lastBatchStart = Math.floor((IELTS_WORDS_FLAT.length - 1) / OFFICIAL_BATCH_SIZE) * OFFICIAL_BATCH_SIZE;
const lastBatchSize = IELTS_WORDS_FLAT.length - lastBatchStart;

const summaryWithoutResume = buildOfficialLibrarySummary('ielts-vocab', officialGroups, null);
assert.equal(summaryWithoutResume.progress, 80);
assert.equal(summaryWithoutResume.nextBatchSize, OFFICIAL_BATCH_SIZE);
assert.equal(summaryWithoutResume.unlockedWordCount, 80);
assert.equal(summaryWithoutResume.completed, false);
assert.equal(resolveOfficialLibraryStartMode(summaryWithoutResume), 'new');

const resumeCandidate: ResumeCandidate = {
  groupId: 'g-last',
  groupTitle: formatOfficialGroupName('ielts-vocab', lastBatchStart, lastBatchSize),
  createdAt: '2026-04-20T00:00:00.000Z',
  round: 'round2',
  currentIndex: 6,
  queueWordIds: ['w1', 'w2', 'w3'],
  passedQueueIndices: [0, 1],
  round1ConfirmedWordIds: ['w1', 'w2'],
  queueLength: 3,
  lastActiveAt: '2026-04-20T00:00:00.000Z',
  groupCompleted: false,
  completedAt: null,
  article: null,
  libraryId: 'ielts-vocab',
};

const completedGroups: LibraryGroupSummary[] = [
  makeGroupSummary({
    id: 'g-all',
    title: formatOfficialCounterGroupName('ielts-vocab', 'sequential', 1, IELTS_WORDS_FLAT.length),
    createdAt: '2026-04-20T00:00:00.000Z',
    wordCount: IELTS_WORDS_FLAT.length,
    status: 'completed',
    sessionRound: 'article',
    completedAt: '2026-04-20T00:30:00.000Z',
  }),
];

const summaryWithResume = buildOfficialLibrarySummary('ielts-vocab', completedGroups, {
  active: resumeCandidate,
  reinforcement: null,
} satisfies OfficialResumeTargets);
assert.equal(summaryWithResume.progress, IELTS_WORDS_FLAT.length);
assert.equal(summaryWithResume.nextBatchSize, 0);
assert.equal(summaryWithResume.unlockedWordCount, IELTS_WORDS_FLAT.length);
assert.equal(summaryWithResume.completed, true);
assert.equal(resolveOfficialLibraryStartMode(summaryWithResume), 'resume');
void lastBatchStart;
void lastBatchSize;

const summaryCompleted = buildOfficialLibrarySummary('ielts-vocab', completedGroups, null);
assert.equal(resolveOfficialLibraryStartMode(summaryCompleted), 'completed');

const orderIndexes = [20, 5, 12];
const unsortedWords = orderIndexes.map((index) => ({ word: IELTS_WORDS_FLAT[index] }));
const sortedWords = sortWordsByOfficialOrder('ielts-vocab', unsortedWords).map((item) => item.word);
assert.deepEqual(sortedWords, [IELTS_WORDS_FLAT[5], IELTS_WORDS_FLAT[12], IELTS_WORDS_FLAT[20]]);
assert.equal(getOfficialWordPosition('ielts-vocab', IELTS_WORDS_FLAT[5]), 5);

// Let's also check GRE
const greGroups: LibraryGroupSummary[] = [
  makeGroupSummary({
    id: 'g-gre',
    title: formatOfficialGroupName('gre-zhenkao-v7', 0, OFFICIAL_BATCH_SIZE),
    createdAt: '2026-04-21T00:00:00.000Z',
    sourceType: 'system',
    status: 'active',
    sessionRound: 'round2',
    libraryId: 'gre-zhenkao-v7',
  }),
];
const greSummary = buildOfficialLibrarySummary('gre-zhenkao-v7', greGroups, null);
assert.equal(greSummary.progress, 0);
assert.equal(greSummary.nextBatchSize, OFFICIAL_BATCH_SIZE);
assert.equal(greSummary.unlockedWordCount, 0);

// New counter-pattern group names are recognized as official.
assert.equal(
  isOfficialGroupName(formatOfficialCounterGroupName('ielts-vocab', 'sequential', 1, OFFICIAL_BATCH_SIZE)),
  true,
);
assert.equal(
  isOfficialGroupName(formatOfficialCounterGroupName('ielts-vocab', 'shuffle', 2, OFFICIAL_BATCH_SIZE)),
  true,
);
assert.equal(
  resolveOfficialLibraryId(
    null,
    formatOfficialCounterGroupName('gre-zhenkao-v7', 'shuffle', 1, OFFICIAL_BATCH_SIZE),
    'system',
  ),
  'gre-zhenkao-v7',
);
assert.equal(
  resolveOfficialLibraryId(
    null,
    formatOfficialCounterGroupName('gre-zhenkao-v7', 'sequential', 2, OFFICIAL_BATCH_SIZE),
    'system',
  ),
  'gre-zhenkao-v7',
);
assert.equal(
  resolveOfficialStudyModeFromGroupName(
    'ielts-vocab',
    formatOfficialCounterGroupName('ielts-vocab', 'shuffle', 2, OFFICIAL_BATCH_SIZE),
  ),
  'shuffle',
);
assert.equal(resolveOfficialStudyModeFromGroupName('ielts-vocab', '雅思词汇真经 · 0001-0030'), 'sequential');
// Legacy range-format groups still recognized.
assert.equal(isOfficialGroupName('雅思词汇真经 · 0001-0030'), true);
assert.equal(resolveOfficialLibraryId(null, '雅思词汇真经 · 0031-0060', 'system'), 'ielts-vocab');

// buildOfficialBatchFromRows — selection (anti-join/shuffle/limit) now happens in the
// official_next_batch RPC; these checks cover the group-naming logic over RPC rows.
const rowsFor = (indices: number[]) => indices.map((index) => ({ word: IELTS_WORDS_FLAT[index], position: index }));
const range = (start: number, length: number) => Array.from({ length }, (_, k) => start + k);

// Sequential + contiguous positions → "0006-0045" range name, words passed through in order.
const seqRows = rowsFor(range(5, OFFICIAL_BATCH_SIZE));
const seqBatch = buildOfficialBatchFromRows('ielts-vocab', seqRows, 'sequential', 1);
assert.ok(seqBatch);
assert.equal(seqBatch.words.length, OFFICIAL_BATCH_SIZE);
assert.equal(seqBatch.words[0], IELTS_WORDS_FLAT[5]);
assert.equal(seqBatch.words[39], IELTS_WORDS_FLAT[44]);
assert.equal(seqBatch.groupName, formatOfficialGroupName('ielts-vocab', 5, OFFICIAL_BATCH_SIZE));

// Sequential with a positional hole (learned word at index 10 skipped) → non-contiguous
// → counter naming.
const seqHoleRows = rowsFor([...range(0, 10), ...range(11, OFFICIAL_BATCH_SIZE - 10)]);
const seqHoleBatch = buildOfficialBatchFromRows('ielts-vocab', seqHoleRows, 'sequential', 0);
assert.ok(seqHoleBatch);
assert.equal(seqHoleBatch.words[0], IELTS_WORDS_FLAT[0]);
assert.equal(seqHoleBatch.words[9], IELTS_WORDS_FLAT[9]);
assert.equal(seqHoleBatch.words[10], IELTS_WORDS_FLAT[11]);
assert.equal(seqHoleBatch.words.includes(IELTS_WORDS_FLAT[10]), false);
assert.equal(
  seqHoleBatch.groupName,
  formatOfficialCounterGroupName('ielts-vocab', 'sequential', 1, OFFICIAL_BATCH_SIZE),
);

// Shuffle → always counter naming regardless of positions; words passed through as-is.
const shuffleRows = rowsFor(range(Math.floor(IELTS_WORDS_FLAT.length / 2), OFFICIAL_BATCH_SIZE));
const shuffleBatch = buildOfficialBatchFromRows('ielts-vocab', shuffleRows, 'shuffle', 5);
assert.ok(shuffleBatch);
assert.equal(shuffleBatch.words.length, OFFICIAL_BATCH_SIZE);
assert.equal(shuffleBatch.groupName, formatOfficialCounterGroupName('ielts-vocab', 'shuffle', 6, OFFICIAL_BATCH_SIZE));

// No remaining rows → null.
assert.equal(buildOfficialBatchFromRows('ielts-vocab', [], 'sequential', 1), null);
assert.equal(buildOfficialBatchFromRows('ielts-vocab', [], 'shuffle', 1), null);

// Tail batch (contiguous remainder shorter than a full batch) → range name with actual length.
const tailStart = IELTS_WORDS_FLAT.length - 4;
const tailBatch = buildOfficialBatchFromRows('ielts-vocab', rowsFor(range(tailStart, 4)), 'sequential', 9);
assert.ok(tailBatch);
assert.equal(tailBatch.words.length, 4);
assert.equal(tailBatch.groupName, formatOfficialGroupName('ielts-vocab', tailStart, 4));

const positions = new Map([
  ['w1', 1],
  ['w2', 2],
  ['w3', 3],
  ['w4', 4],
  ['w5', 5],
]);
const round1Reorder = reorderOfficialSessionQueue({
  round: 'round1',
  currentIndex: 2,
  queueWordIds: ['w1', 'w2', 'w5', 'w4', 'w3'],
  fallbackWordIds: ['w1', 'w2', 'w3', 'w4', 'w5'],
  round1ConfirmedWordIds: ['w1', 'w2'],
  passedQueueIndices: [0, 1],
  targetMode: 'sequential',
  officialPositions: positions,
});
assert.deepEqual(round1Reorder.queueWordIds, ['w1', 'w2', 'w3', 'w4', 'w5']);
assert.equal(round1Reorder.currentIndex, 2);
assert.deepEqual(round1Reorder.passedQueueIndices, [0, 1]);

const round2Reorder = reorderOfficialSessionQueue({
  round: 'round2',
  currentIndex: 2,
  queueWordIds: ['w1', 'w2', 'w5', 'w3', 'w4', 'w3'],
  fallbackWordIds: ['w1', 'w2', 'w3', 'w4', 'w5'],
  passedQueueIndices: [0, 1],
  targetMode: 'shuffle',
  officialPositions: positions,
  random: () => 0,
});
assert.deepEqual(round2Reorder.queueWordIds, ['w1', 'w2', 'w3', 'w4', 'w3', 'w5']);
assert.equal(round2Reorder.currentIndex, 2);
assert.deepEqual(round2Reorder.passedQueueIndices, [0, 1]);

console.log('official library checks passed');
