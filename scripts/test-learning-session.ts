import assert from 'node:assert/strict';
import {
  clampSessionIndex,
  createInitialLearningSession,
  createResumeCandidate,
  normalizePersistedLearningSession,
  normalizeSessionQueueWordIds,
  rebuildSessionQueue,
} from '../src/lib/learningSession.js';
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
}, words);
assert.equal(normalized.currentIndex, 1);
assert.deepEqual(normalized.queueWordIds, ['w2', 'w2']);

const fallback = normalizePersistedLearningSession({
  groupId: 'g1',
  round: 'round3',
  currentIndex: 99,
  queueWordIds: ['missing-only'],
  lastActiveAt: '2026-04-18T00:00:00.000Z',
}, words);
assert.equal(fallback.currentIndex, 2);
assert.deepEqual(fallback.queueWordIds, ['w1', 'w2', 'w3']);

const initial = createInitialLearningSession('g2', words);
assert.equal(initial.groupId, 'g2');
assert.equal(initial.round, 'round1');
assert.equal(initial.currentIndex, 0);
assert.deepEqual(initial.queueWordIds, ['w1', 'w2', 'w3']);

const candidate = createResumeCandidate({
  groupId: 'g3',
  groupTitle: '这组词',
  createdAt: '2026-04-18T00:00:00.000Z',
  round: 'round2',
  currentIndex: -2,
  queueWordIds: ['w1', 'w2'],
  lastActiveAt: '2026-04-18T00:00:00.000Z',
  article: null,
});
assert.equal(candidate.currentIndex, 0);
assert.equal(candidate.queueLength, 2);

console.log('learning session checks passed');
