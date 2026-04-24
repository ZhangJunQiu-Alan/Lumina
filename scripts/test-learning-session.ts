import assert from 'node:assert/strict';
import {
  clampSessionIndex,
  createInitialLearningSession,
  createResumeCandidate,
  isCoreLearningComplete,
  normalizePersistedLearningSession,
  normalizeSessionQueueWordIds,
  rebuildSessionQueue,
} from '../src/lib/learningSession.js';
import {
  buildOfficialLibrarySummary,
  getOfficialNextBatch,
  resolveOfficialLibraryStartMode,
} from '../src/lib/officialLibrary.js';
import { IELTS_WORDS_FLAT } from '../src/data/ielts-vocab.js';
import { resolveActuallyLearnedWordIds } from '../shared/officialDiscard.js';
import type { Word } from '../src/types.js';

const emptyWordExtras = {
  morphology: {
    summaryZh: '',
    parts: [],
  },
  derivedWords: [],
  synonyms: [],
  antonyms: [],
  confusingPairs: [],
} satisfies Pick<Word, 'morphology' | 'derivedWords' | 'synonyms' | 'antonyms' | 'confusingPairs'>;

const words: Word[] = [
  {
    id: 'w1',
    word: 'allocate',
    phonetic: '/allocate/',
    pos_tags: ['v'],
    ner_entities: [],
    chinese_definition: '分配',
    senses: [{ pos: 'v', meaning_zh: '分配', example_sentence: 'Allocate the budget wisely.', example_translation_zh: '' }],
    example_sentences: ['Allocate the budget wisely.'],
    ...emptyWordExtras,
  },
  {
    id: 'w2',
    word: 'sustainable',
    phonetic: '/sustainable/',
    pos_tags: ['adj'],
    ner_entities: [],
    chinese_definition: '可持续的',
    senses: [{ pos: 'adj', meaning_zh: '可持续的', example_sentence: 'A sustainable plan matters.', example_translation_zh: '' }],
    example_sentences: ['A sustainable plan matters.'],
    ...emptyWordExtras,
  },
  {
    id: 'w3',
    word: 'infrastructure',
    phonetic: '/infrastructure/',
    pos_tags: ['n'],
    ner_entities: [],
    chinese_definition: '基础设施',
    senses: [{ pos: 'n', meaning_zh: '基础设施', example_sentence: 'Infrastructure needs investment.', example_translation_zh: '' }],
    example_sentences: ['Infrastructure needs investment.'],
    ...emptyWordExtras,
  },
];

assert.deepEqual(
  normalizeSessionQueueWordIds(['w2', null, 'w1', 42, '', 'w2']),
  ['w2', 'w1', 'w2'],
);

assert.equal(clampSessionIndex(-3, 4), 0);
assert.equal(clampSessionIndex(99, 3), 2);
assert.equal(clampSessionIndex(2.7, 3), 2);
assert.equal(clampSessionIndex(5, 0), 0);

assert.deepEqual(
  rebuildSessionQueue(words, ['w2', 'missing', 'w1', 'w2']).map((word) => word.id),
  ['w2', 'w1', 'w2'],
);

const normalized = normalizePersistedLearningSession({
  groupId: 'g1',
  round: 'round2',
  currentIndex: 8,
  queueWordIds: ['w2', 'missing', 'w2'],
  lastActiveAt: '2026-04-18T00:00:00.000Z',
  groupCompleted: false,
  completedAt: null,
}, words);
assert.equal(normalized.currentIndex, 1);
assert.deepEqual(normalized.queueWordIds, ['w2', 'w2']);

const fallback = normalizePersistedLearningSession({
  groupId: 'g1',
  round: 'round3',
  currentIndex: 99,
  queueWordIds: ['missing-only'],
  lastActiveAt: '2026-04-18T00:00:00.000Z',
  groupCompleted: true,
  completedAt: '2026-04-18T00:10:00.000Z',
}, words);
assert.equal(fallback.currentIndex, 2);
assert.deepEqual(fallback.queueWordIds, ['w1', 'w2', 'w3']);

const initial = createInitialLearningSession('g2', words);
assert.equal(initial.groupId, 'g2');
assert.equal(initial.round, 'round1');
assert.equal(initial.currentIndex, 0);
assert.deepEqual(initial.queueWordIds, ['w1', 'w2', 'w3']);
assert.equal(initial.groupCompleted, false);
assert.equal(initial.completedAt, null);

const completedSeed = createInitialLearningSession('g2', words, 'round3', {
  groupCompleted: true,
  completedAt: '2026-04-18T00:10:00.000Z',
});
assert.equal(completedSeed.groupCompleted, true);
assert.equal(completedSeed.completedAt, '2026-04-18T00:10:00.000Z');

const candidate = createResumeCandidate({
  groupId: 'g3',
  groupTitle: '这组词',
  createdAt: '2026-04-18T00:00:00.000Z',
  round: 'round2',
  currentIndex: -2,
  queueWordIds: ['w1', 'w2'],
  lastActiveAt: '2026-04-18T00:00:00.000Z',
  groupCompleted: false,
  completedAt: null,
  article: null,
});
assert.equal(candidate.currentIndex, 0);
assert.equal(candidate.queueLength, 2);

assert.deepEqual(
  resolveActuallyLearnedWordIds({
    round: 'round1',
    currentIndex: 2,
    queueWordIds: ['w1', 'w2', 'w3'],
    fallbackWordIds: ['w1', 'w2', 'w3'],
  }),
  ['w1', 'w2'],
);

assert.deepEqual(
  resolveActuallyLearnedWordIds({
    round: 'round2',
    currentIndex: 1,
    queueWordIds: ['w2', 'w3', 'w2'],
    fallbackWordIds: ['w1', 'w2', 'w3'],
    round2AttemptWordIds: ['w1', 'w3'],
  }),
  ['w1', 'w2', 'w3'],
);

assert.deepEqual(
  resolveActuallyLearnedWordIds({
    round: 'article',
    currentIndex: 3,
    queueWordIds: ['w1', 'w2', 'w3'],
    fallbackWordIds: ['w1', 'w2', 'w3'],
    round2AttemptWordIds: ['w1'],
  }),
  [],
);

assert.equal(isCoreLearningComplete({
  status: 'active',
  completedAt: null,
  sessionRound: 'round2',
}), false);
assert.equal(isCoreLearningComplete({
  status: 'completed',
  completedAt: null,
  sessionRound: 'round2',
}), true);
assert.equal(isCoreLearningComplete({
  status: 'active',
  completedAt: null,
  sessionRound: 'round3',
}), true);

const officialGroups = [
  {
    id: 'g-active',
    title: '雅思词汇真经 · 0061-0090',
    createdAt: '2026-04-18T00:00:00.000Z',
    wordCount: 30,
    sourceType: 'system' as const,
    libraryId: 'ielts-vocab' as const,
    status: 'active' as const,
    sessionRound: 'round2' as const,
    completedAt: null,
  },
  {
    id: 'g-completed',
    title: '雅思词汇真经 · 0001-0030',
    createdAt: '2026-04-19T00:00:00.000Z',
    wordCount: 30,
    sourceType: 'system' as const,
    libraryId: 'ielts-vocab' as const,
    status: 'completed' as const,
    sessionRound: 'round3' as const,
    completedAt: '2026-04-19T00:20:00.000Z',
  },
  {
    id: 'g-legacy',
    title: '雅思词汇真经 · 0031-0060',
    createdAt: '2026-04-20T00:00:00.000Z',
    wordCount: 30,
    sourceType: 'system' as const,
    libraryId: 'ielts-vocab' as const,
    status: 'active' as const,
    sessionRound: 'article' as const,
    completedAt: null,
  },
];

const officialSummary = buildOfficialLibrarySummary('ielts-vocab', officialGroups, {
  active: candidate,
  reinforcement: createResumeCandidate({
    groupId: 'g4',
    groupTitle: '雅思词汇真经 · 0061-0090',
    createdAt: '2026-04-19T00:00:00.000Z',
    round: 'article',
    currentIndex: 3,
    queueWordIds: ['w1', 'w2'],
    lastActiveAt: '2026-04-19T00:30:00.000Z',
    groupCompleted: true,
    completedAt: '2026-04-19T00:20:00.000Z',
    article: null,
  }),
});
assert.equal(officialSummary.progress, 60);
assert.equal(officialSummary.activeResumeCandidate?.groupId, 'g3');
assert.equal(officialSummary.reinforcementCandidate?.groupId, 'g4');
assert.equal(resolveOfficialLibraryStartMode(officialSummary), 'resume');

const nextSequentialBatch = getOfficialNextBatch(
  'ielts-vocab',
  new Set(IELTS_WORDS_FLAT.slice(0, officialSummary.progress).map((word) => word.trim().toLowerCase())),
  'sequential',
  3,
  officialSummary.progress,
);
assert.equal(nextSequentialBatch?.groupName, '雅思词汇真经 · 0061-0090');

console.log('learning session checks passed');
