import assert from 'node:assert/strict';
import { IELTS_WORDS_FLAT } from '../src/data/ielts-vocab.js';
import { GRE_ZHENKAO_V7_WORDS } from '../src/data/gre-zhenkao-v7.js';
import {
  buildOfficialLibrarySummary,
  formatOfficialCounterGroupName,
  formatOfficialGroupName,
  getOfficialNextBatch,
  getOfficialWordPosition,
  isOfficialGroupName,
  OFFICIAL_BATCH_SIZE,
  OFFICIAL_PREFETCH_REMAINING_THRESHOLD,
  resolveOfficialStudyModeFromGroupName,
  resolveOfficialLibraryStartMode,
  sortWordsByOfficialOrder,
  resolveOfficialLibraryId,
} from '../src/lib/officialLibrary.js';
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
    sessionRound: 'round3',
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

// getOfficialNextBatch — sequential picks first unlearned in book order.
const learnedFirstFive = new Set(IELTS_WORDS_FLAT.slice(0, 5).map((w) => w.trim().toLowerCase()));
const seqBatch = getOfficialNextBatch('ielts-vocab', learnedFirstFive, 'sequential', 1, 5);
assert.ok(seqBatch);
assert.equal(seqBatch.words.length, OFFICIAL_BATCH_SIZE);
assert.equal(seqBatch.words[0], IELTS_WORDS_FLAT[5]);
assert.equal(seqBatch.words[39], IELTS_WORDS_FLAT[44]);
assert.equal(seqBatch.groupName, formatOfficialGroupName('ielts-vocab', 5, OFFICIAL_BATCH_SIZE));

// Sequential skips sparse learned-word holes and falls back to counter naming
// when the picked words are not a contiguous official range.
const learnedWithHole = new Set(['', IELTS_WORDS_FLAT[10]].map((w) => w.trim().toLowerCase()).filter(Boolean));
const seqHoleBatch = getOfficialNextBatch('ielts-vocab', learnedWithHole, 'sequential', 0, 0);
assert.ok(seqHoleBatch);
assert.equal(seqHoleBatch.words[0], IELTS_WORDS_FLAT[0]);
assert.equal(seqHoleBatch.words[9], IELTS_WORDS_FLAT[9]);
assert.equal(seqHoleBatch.words[10], IELTS_WORDS_FLAT[11]);
assert.equal(seqHoleBatch.words.includes(IELTS_WORDS_FLAT[10]), false);
assert.equal(
  seqHoleBatch.groupName,
  formatOfficialCounterGroupName('ielts-vocab', 'sequential', 1, OFFICIAL_BATCH_SIZE),
);

// Shuffle picks only from unlearned and never repeats learned words.
const learnedHalf = new Set(
  IELTS_WORDS_FLAT.slice(0, Math.floor(IELTS_WORDS_FLAT.length / 2)).map((w) => w.trim().toLowerCase()),
);
const shuffleBatch = getOfficialNextBatch('ielts-vocab', learnedHalf, 'shuffle', 5, 0);
assert.ok(shuffleBatch);
assert.equal(shuffleBatch.words.length, OFFICIAL_BATCH_SIZE);
for (const word of shuffleBatch.words) {
  assert.equal(learnedHalf.has(word.trim().toLowerCase()), false);
}
assert.equal(shuffleBatch.groupName, formatOfficialCounterGroupName('ielts-vocab', 'shuffle', 6, OFFICIAL_BATCH_SIZE));

// Exhaustion returns null.
const allLearned = new Set(IELTS_WORDS_FLAT.map((w) => w.trim().toLowerCase()));
assert.equal(getOfficialNextBatch('ielts-vocab', allLearned, 'sequential', 1, IELTS_WORDS_FLAT.length), null);
assert.equal(getOfficialNextBatch('ielts-vocab', allLearned, 'shuffle', 1, 0), null);

// Tail batch clamps to remainder.
const learnedAllButFour = new Set(
  IELTS_WORDS_FLAT.slice(0, IELTS_WORDS_FLAT.length - 4).map((w) => w.trim().toLowerCase()),
);
const tailBatch = getOfficialNextBatch('ielts-vocab', learnedAllButFour, 'sequential', 9, IELTS_WORDS_FLAT.length - 4);
assert.ok(tailBatch);
assert.equal(tailBatch.words.length, 4);
assert.equal(tailBatch.groupName, formatOfficialGroupName('ielts-vocab', IELTS_WORDS_FLAT.length - 4, 4));

console.log('official library checks passed');
