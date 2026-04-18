import assert from 'node:assert/strict';
import { IELTS_WORDS_FLAT } from '../src/data/ielts-vocab.js';
import {
  buildOfficialLibrarySummary,
  formatOfficialGroupName,
  getOfficialWordPosition,
  resolveOfficialLibraryStartMode,
  sortWordsByOfficialOrder,
} from '../src/lib/officialLibrary.js';
import type { LibraryGroupSummary, ResumeCandidate } from '../src/types.js';

const officialGroups: LibraryGroupSummary[] = [
  {
    id: 'g1',
    title: formatOfficialGroupName(0, 30),
    createdAt: '2026-04-18T00:00:00.000Z',
    wordCount: 30,
    sourceType: 'system',
    status: 'completed',
  },
  {
    id: 'g2',
    title: formatOfficialGroupName(30, 30),
    createdAt: '2026-04-19T00:00:00.000Z',
    wordCount: 30,
    sourceType: 'system',
    status: 'active',
  },
];

const summaryWithoutResume = buildOfficialLibrarySummary(officialGroups, null);
assert.equal(summaryWithoutResume.progress, 60);
assert.equal(summaryWithoutResume.nextBatchSize, 30);
assert.equal(summaryWithoutResume.unlockedWordCount, 60);
assert.equal(summaryWithoutResume.completed, false);
assert.equal(resolveOfficialLibraryStartMode(summaryWithoutResume), 'new');

const resumeCandidate: ResumeCandidate = {
  groupId: 'g-last',
  groupTitle: '雅思词汇真经 · 3645-3674',
  createdAt: '2026-04-20T00:00:00.000Z',
  round: 'round2',
  currentIndex: 6,
  queueWordIds: ['w1', 'w2', 'w3'],
  queueLength: 3,
  lastActiveAt: '2026-04-20T00:00:00.000Z',
  article: null,
};

const completedGroups: LibraryGroupSummary[] = [
  {
    id: 'g-last',
    title: formatOfficialGroupName(3644, 30),
    createdAt: '2026-04-20T00:00:00.000Z',
    wordCount: 30,
    sourceType: 'system',
    status: 'active',
  },
];

const summaryWithResume = buildOfficialLibrarySummary(completedGroups, resumeCandidate);
assert.equal(summaryWithResume.progress, 3674);
assert.equal(summaryWithResume.nextBatchSize, 0);
assert.equal(summaryWithResume.unlockedWordCount, 30);
assert.equal(summaryWithResume.completed, true);
assert.equal(resolveOfficialLibraryStartMode(summaryWithResume), 'resume');

const summaryCompleted = buildOfficialLibrarySummary(completedGroups, null);
assert.equal(resolveOfficialLibraryStartMode(summaryCompleted), 'completed');

const orderIndexes = [20, 5, 12];
const unsortedWords = orderIndexes.map((index) => ({ word: IELTS_WORDS_FLAT[index] }));
const sortedWords = sortWordsByOfficialOrder(unsortedWords).map((item) => item.word);
assert.deepEqual(sortedWords, [IELTS_WORDS_FLAT[5], IELTS_WORDS_FLAT[12], IELTS_WORDS_FLAT[20]]);
assert.equal(getOfficialWordPosition(IELTS_WORDS_FLAT[5]), 5);

console.log('official library checks passed');
