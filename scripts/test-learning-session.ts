import assert from 'node:assert/strict';
import {
  clampSessionIndex,
  createInitialLearningSession,
  createResumeCandidate,
  filterMasteredSessionWords,
  filterWordsToRound1Confirmed,
  isCoreLearningComplete,
  normalizePersistedLearningSession,
  normalizeSessionRound1ConfirmedWordIds,
  normalizeSessionQueueWordIds,
  reconcileSessionWithRound2History,
  rebuildSessionQueue,
} from '../src/lib/learningSession.js';
import {
  buildOfficialBatchFromRows,
  buildOfficialLibrarySummary,
  resolveOfficialLibraryStartMode,
} from '../src/lib/officialLibrary.js';
import { IELTS_WORDS_FLAT } from '../src/data/ielts-vocab.js';
import { resolveActuallyLearnedWordIds } from '../shared/officialDiscard.js';
import { ROUND1_REINFORCEMENT_WORD_LIMIT } from '../shared/learningProgress.js';
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
  round2ChoiceDistractors: [],
} satisfies Pick<
  Word,
  'morphology' | 'derivedWords' | 'synonyms' | 'antonyms' | 'confusingPairs' | 'round2ChoiceDistractors'
>;

const words: Word[] = [
  {
    id: 'w1',
    word: 'allocate',
    phonetic: '/allocate/',
    pos_tags: ['v'],
    ner_entities: [],
    chinese_definition: '分配',
    senses: [
      { pos: 'v', meaning_zh: '分配', example_sentence: 'Allocate the budget wisely.', example_translation_zh: '' },
    ],
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
    senses: [
      {
        pos: 'adj',
        meaning_zh: '可持续的',
        example_sentence: 'A sustainable plan matters.',
        example_translation_zh: '',
      },
    ],
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
    senses: [
      {
        pos: 'n',
        meaning_zh: '基础设施',
        example_sentence: 'Infrastructure needs investment.',
        example_translation_zh: '',
      },
    ],
    example_sentences: ['Infrastructure needs investment.'],
    ...emptyWordExtras,
  },
];

function makeNumberedWords(count: number): Word[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `w${index + 1}`,
    word: `word${index + 1}`,
    phonetic: `/word${index + 1}/`,
    pos_tags: ['n'],
    ner_entities: [],
    chinese_definition: `释义 ${index + 1}`,
    senses: [
      {
        pos: 'n',
        meaning_zh: `释义 ${index + 1}`,
        example_sentence: `This is word${index + 1}.`,
        example_translation_zh: '',
      },
    ],
    example_sentences: [`This is word${index + 1}.`],
    ...emptyWordExtras,
  }));
}

assert.deepEqual(normalizeSessionQueueWordIds(['w2', null, 'w1', 42, '', 'w2']), ['w2', 'w1', 'w2']);

assert.deepEqual(normalizeSessionRound1ConfirmedWordIds(['w2', null, 'w1', 42, '', 'w2', ' w3 ']), ['w2', 'w1', 'w3']);

assert.equal(clampSessionIndex(-3, 4), 0);
assert.equal(clampSessionIndex(99, 3), 2);
assert.equal(clampSessionIndex(2.7, 3), 2);
assert.equal(clampSessionIndex(5, 0), 0);

assert.deepEqual(
  rebuildSessionQueue(words, ['w2', 'missing', 'w1', 'w2']).map((word) => word.id),
  ['w2', 'w1', 'w2'],
);

assert.deepEqual(
  filterMasteredSessionWords(words, ['w2']).map((word) => word.id),
  ['w1', 'w3'],
);

const normalized = normalizePersistedLearningSession(
  {
    groupId: 'g1',
    round: 'round2',
    currentIndex: 8,
    queueWordIds: ['w2', 'missing', 'w2'],
    passedQueueIndices: [0, 99],
    round1ConfirmedWordIds: ['w2', 'missing', 'w1', 'w2'],
    lastActiveAt: '2026-04-18T00:00:00.000Z',
    groupCompleted: false,
    completedAt: null,
  },
  words,
);
assert.equal(normalized.currentIndex, 1);
assert.deepEqual(normalized.queueWordIds, ['w2', 'w2']);
assert.deepEqual(normalized.passedQueueIndices, [0]);
assert.deepEqual(normalized.round1ConfirmedWordIds, ['w2', 'w1']);

const fallback = normalizePersistedLearningSession(
  {
    groupId: 'g1',
    round: 'round3',
    currentIndex: 99,
    queueWordIds: ['missing-only'],
    passedQueueIndices: [0, 1, 3],
    round1ConfirmedWordIds: ['w3'],
    lastActiveAt: '2026-04-18T00:00:00.000Z',
    groupCompleted: true,
    completedAt: '2026-04-18T00:10:00.000Z',
  },
  words,
);
assert.equal(fallback.currentIndex, 0);
assert.deepEqual(fallback.queueWordIds, ['w3']);
assert.deepEqual(fallback.passedQueueIndices, []);
assert.deepEqual(fallback.round1ConfirmedWordIds, ['w3']);

const manyWords = makeNumberedWords(45);
const manyWordIds = manyWords.map((word) => word.id);
const expectedRound1ConfirmedWordIds = manyWordIds.slice(0, ROUND1_REINFORCEMENT_WORD_LIMIT);
assert.deepEqual(
  filterWordsToRound1Confirmed(manyWords, manyWordIds).map((word) => word.id),
  expectedRound1ConfirmedWordIds,
);

const normalizedMany = normalizePersistedLearningSession(
  {
    groupId: 'g-many',
    round: 'round2',
    currentIndex: 44,
    queueWordIds: manyWordIds,
    passedQueueIndices: manyWordIds.map((_, index) => index),
    round1ConfirmedWordIds: manyWordIds,
    lastActiveAt: '2026-04-18T00:00:00.000Z',
    groupCompleted: false,
    completedAt: null,
  },
  manyWords,
);
assert.deepEqual(normalizedMany.queueWordIds, expectedRound1ConfirmedWordIds);
assert.deepEqual(normalizedMany.round1ConfirmedWordIds, expectedRound1ConfirmedWordIds);

const staleRound2QueueWords = makeNumberedWords(70);
const staleRound2ConfirmedWordIds = staleRound2QueueWords.slice(0, 30).map((word) => word.id);
const normalizedStaleRound2Queue = normalizePersistedLearningSession(
  {
    groupId: 'g-stale-round2-queue',
    round: 'round2',
    currentIndex: 69,
    queueWordIds: staleRound2QueueWords.map((word) => word.id),
    passedQueueIndices: Array.from({ length: 69 }, (_, index) => index),
    round1ConfirmedWordIds: staleRound2ConfirmedWordIds,
    lastActiveAt: '2026-04-18T00:00:00.000Z',
    groupCompleted: false,
    completedAt: null,
  },
  staleRound2QueueWords,
);
assert.deepEqual(normalizedStaleRound2Queue.queueWordIds, staleRound2ConfirmedWordIds);
assert.equal(normalizedStaleRound2Queue.currentIndex, 29);
assert.deepEqual(
  normalizedStaleRound2Queue.passedQueueIndices,
  Array.from({ length: 29 }, (_, index) => index),
);

const initial = createInitialLearningSession('g2', words);
assert.equal(initial.groupId, 'g2');
assert.equal(initial.round, 'round1');
assert.equal(initial.currentIndex, 0);
assert.deepEqual(initial.queueWordIds, ['w1', 'w2', 'w3']);
assert.deepEqual(initial.passedQueueIndices, []);
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
  passedQueueIndices: [],
  round1ConfirmedWordIds: ['w1'],
  lastActiveAt: '2026-04-18T00:00:00.000Z',
  groupCompleted: false,
  completedAt: null,
  article: null,
});
assert.equal(candidate.currentIndex, 0);
assert.equal(candidate.queueLength, 2);

const reconciledRound2 = reconcileSessionWithRound2History(
  {
    groupId: 'g-stale',
    round: 'round1',
    currentIndex: 1,
    queueWordIds: ['w1', 'w2', 'w3'],
    passedQueueIndices: [0],
    round1ConfirmedWordIds: ['w1', 'w2'],
    lastActiveAt: '2026-04-18T00:00:00.000Z',
    groupCompleted: false,
    completedAt: null,
  },
  words,
  {
    correctWordIds: ['w1'],
    lastAttemptAt: '2026-04-18T00:05:00.000Z',
  },
);
assert.equal(reconciledRound2.round, 'round3');
assert.equal(reconciledRound2.currentIndex, 1);
assert.deepEqual(reconciledRound2.queueWordIds, ['w1', 'w2']);
assert.deepEqual(reconciledRound2.passedQueueIndices, [0]);
assert.equal(reconciledRound2.lastActiveAt, '2026-04-18T00:05:00.000Z');

const reconciledComplete = reconcileSessionWithRound2History(
  {
    groupId: 'g-complete-stale',
    round: 'round1',
    currentIndex: 2,
    queueWordIds: ['w1', 'w2', 'w3'],
    passedQueueIndices: [0, 1],
    round1ConfirmedWordIds: ['w1', 'w2', 'w3'],
    lastActiveAt: '2026-04-18T00:00:00.000Z',
    groupCompleted: false,
    completedAt: null,
  },
  words,
  {
    correctWordIds: ['w1', 'w2', 'w3'],
    lastAttemptAt: '2026-04-18T00:10:00.000Z',
  },
);
assert.equal(reconciledComplete.round, 'article');
assert.equal(reconciledComplete.groupCompleted, true);
assert.equal(reconciledComplete.completedAt, '2026-04-18T00:10:00.000Z');

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
    round: 'round1',
    currentIndex: 35,
    queueWordIds: Array.from({ length: 40 }, (_, index) => `w${index + 1}`),
    fallbackWordIds: Array.from({ length: 40 }, (_, index) => `w${index + 1}`),
    round1ConfirmedWordIds: Array.from({ length: 30 }, (_, index) => `w${index + 1}`),
  }),
  Array.from({ length: 30 }, (_, index) => `w${index + 1}`),
);

assert.deepEqual(
  resolveActuallyLearnedWordIds({
    round: 'round1',
    currentIndex: 40,
    queueWordIds: Array.from({ length: 45 }, (_, index) => `w${index + 1}`),
    fallbackWordIds: Array.from({ length: 45 }, (_, index) => `w${index + 1}`),
    round1ConfirmedWordIds: Array.from({ length: 45 }, (_, index) => `w${index + 1}`),
  }),
  Array.from({ length: ROUND1_REINFORCEMENT_WORD_LIMIT }, (_, index) => `w${index + 1}`),
);

assert.deepEqual(
  resolveActuallyLearnedWordIds({
    round: 'round3',
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

assert.equal(
  isCoreLearningComplete({
    status: 'active',
    completedAt: null,
    sessionRound: 'round2',
  }),
  false,
);
assert.equal(
  isCoreLearningComplete({
    status: 'completed',
    completedAt: null,
    sessionRound: 'round2',
  }),
  true,
);
assert.equal(
  isCoreLearningComplete({
    status: 'active',
    completedAt: null,
    sessionRound: 'round3',
  }),
  false,
);
assert.equal(
  isCoreLearningComplete({
    status: 'active',
    completedAt: null,
    sessionRound: 'article',
  }),
  true,
);

const officialGroups = [
  {
    id: 'g-active',
    title: '雅思词汇真经 · 0041-0080',
    createdAt: '2026-04-18T00:00:00.000Z',
    wordCount: 40,
    sourceType: 'system' as const,
    libraryId: 'ielts-vocab' as const,
    status: 'active' as const,
    sessionRound: 'round2' as const,
    completedAt: null,
  },
  {
    id: 'g-completed',
    title: '雅思词汇真经 · 0001-0040',
    createdAt: '2026-04-19T00:00:00.000Z',
    wordCount: 40,
    sourceType: 'system' as const,
    libraryId: 'ielts-vocab' as const,
    status: 'completed' as const,
    sessionRound: 'article' as const,
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
    groupTitle: '雅思词汇真经 · 0041-0080',
    createdAt: '2026-04-19T00:00:00.000Z',
    round: 'article',
    currentIndex: 3,
    queueWordIds: ['w1', 'w2'],
    passedQueueIndices: [0],
    round1ConfirmedWordIds: ['w1', 'w2'],
    lastActiveAt: '2026-04-19T00:30:00.000Z',
    groupCompleted: true,
    completedAt: '2026-04-19T00:20:00.000Z',
    article: null,
  }),
});
assert.equal(officialSummary.progress, 70);
assert.equal(officialSummary.activeResumeCandidate?.groupId, 'g3');
assert.equal(officialSummary.reinforcementCandidate?.groupId, 'g4');
assert.equal(resolveOfficialLibraryStartMode(officialSummary), 'resume');

const nextSequentialBatch = buildOfficialBatchFromRows(
  'ielts-vocab',
  Array.from({ length: 40 }, (_, k) => ({
    word: IELTS_WORDS_FLAT[officialSummary.progress + k],
    position: officialSummary.progress + k,
  })),
  'sequential',
  3,
);
assert.equal(nextSequentialBatch?.groupName, '雅思词汇真经 · 0071-0110');

console.log('learning session checks passed');
