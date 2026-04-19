import assert from 'node:assert/strict';
import { IELTS_WORDS_FLAT } from '../src/data/ielts-vocab.js';
import { GRE_ZHENKAO_V7_WORDS } from '../src/data/gre-zhenkao-v7.js';
import {
  buildOfficialLibrarySummary,
  formatOfficialGroupName,
  getOfficialWordPosition,
  resolveOfficialLibraryStartMode,
  sortWordsByOfficialOrder,
  resolveOfficialLibraryId,
} from '../src/lib/officialLibrary.js';
import type { LibraryGroupSummary, ResumeCandidate } from '../src/types.js';

assert.equal(new Set(IELTS_WORDS_FLAT.map((word) => word.trim().toLowerCase())).size, IELTS_WORDS_FLAT.length);
assert.equal(new Set(GRE_ZHENKAO_V7_WORDS.map((word) => word.trim().toLowerCase())).size, GRE_ZHENKAO_V7_WORDS.length);

const officialGroups: LibraryGroupSummary[] = [
  {
    id: 'g1',
    title: formatOfficialGroupName('ielts-vocab', 0, 30),
    createdAt: '2026-04-18T00:00:00.000Z',
    wordCount: 30,
    sourceType: 'system',
    status: 'completed',
    libraryId: 'ielts-vocab',
  },
  {
    id: 'g2',
    // legacy title, no library_id directly, but mapGroupSummary uses resolveOfficialLibraryId
    title: '雅思词汇真经 · 0031-0060',
    createdAt: '2026-04-19T00:00:00.000Z',
    wordCount: 30,
    sourceType: 'system',
    status: 'active',
    libraryId: resolveOfficialLibraryId(null, '雅思词汇真经 · 0031-0060', 'system'),
  },
];

const lastBatchStart = Math.floor((IELTS_WORDS_FLAT.length - 1) / 30) * 30;
const lastBatchSize = IELTS_WORDS_FLAT.length - lastBatchStart;

const summaryWithoutResume = buildOfficialLibrarySummary('ielts-vocab', officialGroups, null);
assert.equal(summaryWithoutResume.progress, 60);
assert.equal(summaryWithoutResume.nextBatchSize, 30);
assert.equal(summaryWithoutResume.unlockedWordCount, 60);
assert.equal(summaryWithoutResume.completed, false);
assert.equal(resolveOfficialLibraryStartMode(summaryWithoutResume), 'new');

const resumeCandidate: ResumeCandidate = {
  groupId: 'g-last',
  groupTitle: formatOfficialGroupName('ielts-vocab', lastBatchStart, lastBatchSize),
  createdAt: '2026-04-20T00:00:00.000Z',
  round: 'round2',
  currentIndex: 6,
  queueWordIds: ['w1', 'w2', 'w3'],
  queueLength: 3,
  lastActiveAt: '2026-04-20T00:00:00.000Z',
  article: null,
  libraryId: 'ielts-vocab',
};

const completedGroups: LibraryGroupSummary[] = [
  {
    id: 'g-last',
    title: formatOfficialGroupName('ielts-vocab', lastBatchStart, lastBatchSize),
    createdAt: '2026-04-20T00:00:00.000Z',
    wordCount: lastBatchSize,
    sourceType: 'system',
    status: 'active',
    libraryId: 'ielts-vocab',
  },
];

const summaryWithResume = buildOfficialLibrarySummary('ielts-vocab', completedGroups, resumeCandidate);
assert.equal(summaryWithResume.progress, IELTS_WORDS_FLAT.length);
assert.equal(summaryWithResume.nextBatchSize, 0);
assert.equal(summaryWithResume.unlockedWordCount, lastBatchSize);
assert.equal(summaryWithResume.completed, true);
assert.equal(resolveOfficialLibraryStartMode(summaryWithResume), 'resume');

const summaryCompleted = buildOfficialLibrarySummary('ielts-vocab', completedGroups, null);
assert.equal(resolveOfficialLibraryStartMode(summaryCompleted), 'completed');

const orderIndexes = [20, 5, 12];
const unsortedWords = orderIndexes.map((index) => ({ word: IELTS_WORDS_FLAT[index] }));
const sortedWords = sortWordsByOfficialOrder('ielts-vocab', unsortedWords).map((item) => item.word);
assert.deepEqual(sortedWords, [IELTS_WORDS_FLAT[5], IELTS_WORDS_FLAT[12], IELTS_WORDS_FLAT[20]]);
assert.equal(getOfficialWordPosition('ielts-vocab', IELTS_WORDS_FLAT[5]), 5);

// Let's also check GRE
const greGroups: LibraryGroupSummary[] = [
  {
    id: 'g-gre',
    title: formatOfficialGroupName('gre-zhenkao-v7', 0, 30),
    createdAt: '2026-04-21T00:00:00.000Z',
    wordCount: 30,
    sourceType: 'system',
    status: 'active',
    libraryId: 'gre-zhenkao-v7',
  },
];
const greSummary = buildOfficialLibrarySummary('gre-zhenkao-v7', greGroups, null);
assert.equal(greSummary.progress, 30);
assert.equal(greSummary.nextBatchSize, 30);
assert.equal(greSummary.unlockedWordCount, 30);

console.log('official library checks passed');
