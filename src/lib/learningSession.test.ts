import { ROUND1_REINFORCEMENT_WORD_LIMIT } from '../../shared/learningProgress';
import { describe, expect, it } from 'vitest';
import { resolveActuallyLearnedWordIds } from '../../shared/officialDiscard';
import type { Word } from '../types';
import {
  clampSessionIndex,
  createInitialLearningSession,
  createResumeCandidate,
  filterMasteredSessionWords,
  filterWordsToRound1Confirmed,
  getNewRound1ConfirmedWordIds,
  isCoreLearningComplete,
  normalizePersistedLearningSession,
  normalizeSessionQueueWordIds,
  normalizeSessionRound1ConfirmedWordIds,
  repairRound1ConfirmedSessionQueue,
  rebuildSessionQueue,
  reconcileSessionWithRound2History,
} from './learningSession';

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

describe('learning session domain', () => {
  it('normalizes persisted queues so resume starts on a valid word', () => {
    expect(normalizeSessionQueueWordIds(['w2', null, 'w1', 42, '', 'w2'])).toEqual(['w2', 'w1', 'w2']);
    expect(normalizeSessionRound1ConfirmedWordIds(['w2', null, 'w1', 42, '', 'w2', ' w3 '])).toEqual([
      'w2',
      'w1',
      'w3',
    ]);

    expect(clampSessionIndex(-3, 4)).toBe(0);
    expect(clampSessionIndex(99, 3)).toBe(2);
    expect(clampSessionIndex(2.7, 3)).toBe(2);
    expect(clampSessionIndex(5, 0)).toBe(0);

    expect(rebuildSessionQueue(words, ['w2', 'missing', 'w1', 'w2']).map((word) => word.id)).toEqual([
      'w2',
      'w1',
      'w2',
    ]);
    expect(filterMasteredSessionWords(words, ['w2']).map((word) => word.id)).toEqual(['w1', 'w3']);
  });

  it('detects newly confirmed round 1 words from normalized session snapshots', () => {
    expect(getNewRound1ConfirmedWordIds(['w1', 'w2'], ['w1', 'w2', 'w3', 'w3', '', null])).toEqual(['w3']);
    expect(getNewRound1ConfirmedWordIds([], [' w1 ', 'w2'])).toEqual(['w1', 'w2']);

    const manyWordIds = Array.from({ length: 45 }, (_, index) => `w${index + 1}`);
    expect(getNewRound1ConfirmedWordIds(manyWordIds.slice(0, 29), manyWordIds)).toEqual(manyWordIds.slice(29));
  });

  it('repairs stale reinforcement queues from round 1 confirmed words', () => {
    expect(repairRound1ConfirmedSessionQueue(['w1', 'w2'], ['w1', 'w2', 'w3'])).toEqual(['w1', 'w2', 'w3']);
    expect(repairRound1ConfirmedSessionQueue(['w1', 'w2', 'w2'], ['w1', 'w2', 'w3'])).toEqual(['w1', 'w2', 'w2', 'w3']);
    expect(repairRound1ConfirmedSessionQueue(['w1', 'custom'], ['w1', 'w2'])).toEqual(['w1', 'custom', 'w2']);
  });

  it('falls back to the live word list when a saved session queue is stale', () => {
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

    expect(normalized.currentIndex).toBe(1);
    expect(normalized.queueWordIds).toEqual(['w2', 'w2']);
    expect(normalized.passedQueueIndices).toEqual([0]);
    expect(normalized.round1ConfirmedWordIds).toEqual(['w2', 'w1']);

    const constrainedRound2 = normalizePersistedLearningSession(
      {
        groupId: 'g1',
        round: 'round2',
        currentIndex: 1,
        queueWordIds: ['w1', 'w2', 'w3'],
        passedQueueIndices: [0],
        round1ConfirmedWordIds: ['w1', 'w2'],
        lastActiveAt: '2026-04-18T00:00:00.000Z',
        groupCompleted: false,
        completedAt: null,
      },
      words,
    );

    expect(constrainedRound2.queueWordIds).toEqual(['w1', 'w2']);
    expect(constrainedRound2.currentIndex).toBe(1);
    expect(constrainedRound2.round1ConfirmedWordIds).toEqual(['w1', 'w2']);

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

    expect(fallback.currentIndex).toBe(0);
    expect(fallback.queueWordIds).toEqual(['w3']);
    expect(fallback.passedQueueIndices).toEqual([]);
    expect(fallback.round1ConfirmedWordIds).toEqual(['w3']);
  });

  it('preserves all confirmed words across restore paths, including groups over 30 words', () => {
    const manyWords = makeNumberedWords(45);
    const confirmedWordIds = manyWords.map((word) => word.id);
    const expectedWordIds = confirmedWordIds;

    expect(filterWordsToRound1Confirmed(manyWords, confirmedWordIds).map((word) => word.id)).toEqual(expectedWordIds);

    const normalized = normalizePersistedLearningSession(
      {
        groupId: 'g-many',
        round: 'round2',
        currentIndex: 44,
        queueWordIds: confirmedWordIds,
        passedQueueIndices: confirmedWordIds.map((_, index) => index),
        round1ConfirmedWordIds: confirmedWordIds,
        lastActiveAt: '2026-04-18T00:00:00.000Z',
        groupCompleted: false,
        completedAt: null,
      },
      manyWords,
    );

    expect(normalized.queueWordIds).toEqual(expectedWordIds);
    expect(normalized.round1ConfirmedWordIds).toEqual(expectedWordIds);

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
    expect(normalizedStaleRound2Queue.queueWordIds).toEqual(staleRound2ConfirmedWordIds);
    expect(normalizedStaleRound2Queue.currentIndex).toBe(29);
    expect(normalizedStaleRound2Queue.passedQueueIndices).toEqual(Array.from({ length: 29 }, (_, index) => index));

    const reconciled = reconcileSessionWithRound2History(
      {
        groupId: 'g-many-stale',
        round: 'round1',
        currentIndex: 29,
        queueWordIds: confirmedWordIds,
        passedQueueIndices: confirmedWordIds.slice(0, 29).map((_, index) => index),
        round1ConfirmedWordIds: confirmedWordIds,
        lastActiveAt: '2026-04-18T00:00:00.000Z',
        groupCompleted: false,
        completedAt: null,
      },
      manyWords,
      {
        correctWordIds: expectedWordIds.slice(0, 29),
        lastAttemptAt: '2026-04-18T00:05:00.000Z',
      },
    );

    expect(reconciled.round).toBe('round3');
    expect(reconciled.queueWordIds).toEqual(expectedWordIds);
    expect(reconciled.currentIndex).toBe(29);
  });

  it('creates a resume candidate and reconciles stale dictation progress from history', () => {
    const initial = createInitialLearningSession('g2', words);
    expect(initial).toMatchObject({
      groupId: 'g2',
      round: 'round1',
      currentIndex: 0,
      queueWordIds: ['w1', 'w2', 'w3'],
      passedQueueIndices: [],
      groupCompleted: false,
      completedAt: null,
    });

    const completedSeed = createInitialLearningSession('g2', words, 'round3', {
      groupCompleted: true,
      completedAt: '2026-04-18T00:10:00.000Z',
    });
    expect(completedSeed.groupCompleted).toBe(true);
    expect(completedSeed.completedAt).toBe('2026-04-18T00:10:00.000Z');

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
    expect(candidate.currentIndex).toBe(0);
    expect(candidate.queueLength).toBe(2);
  });

  it('moves a stale session to the first unfinished round 3 dictation word or completes it', () => {
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

    expect(reconciledRound2.round).toBe('round3');
    expect(reconciledRound2.currentIndex).toBe(1);
    expect(reconciledRound2.queueWordIds).toEqual(['w1', 'w2']);
    expect(reconciledRound2.passedQueueIndices).toEqual([0]);
    expect(reconciledRound2.lastActiveAt).toBe('2026-04-18T00:05:00.000Z');

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

    expect(reconciledComplete.round).toBe('article');
    expect(reconciledComplete.groupCompleted).toBe(true);
    expect(reconciledComplete.completedAt).toBe('2026-04-18T00:10:00.000Z');
  });

  it('only discards words the user actually reached in an official learning group', () => {
    expect(
      resolveActuallyLearnedWordIds({
        round: 'round1',
        currentIndex: 2,
        queueWordIds: ['w1', 'w2', 'w3'],
        fallbackWordIds: ['w1', 'w2', 'w3'],
      }),
    ).toEqual(['w1', 'w2']);

    expect(
      resolveActuallyLearnedWordIds({
        round: 'round1',
        currentIndex: 35,
        queueWordIds: Array.from({ length: 40 }, (_, index) => `w${index + 1}`),
        fallbackWordIds: Array.from({ length: 40 }, (_, index) => `w${index + 1}`),
        round1ConfirmedWordIds: Array.from({ length: 30 }, (_, index) => `w${index + 1}`),
      }),
    ).toEqual(Array.from({ length: 30 }, (_, index) => `w${index + 1}`));

    expect(
      resolveActuallyLearnedWordIds({
        round: 'round1',
        currentIndex: 40,
        queueWordIds: Array.from({ length: 45 }, (_, index) => `w${index + 1}`),
        fallbackWordIds: Array.from({ length: 45 }, (_, index) => `w${index + 1}`),
        round1ConfirmedWordIds: Array.from({ length: 45 }, (_, index) => `w${index + 1}`),
      }),
    ).toEqual(Array.from({ length: ROUND1_REINFORCEMENT_WORD_LIMIT }, (_, index) => `w${index + 1}`));

    expect(
      resolveActuallyLearnedWordIds({
        round: 'round3',
        currentIndex: 1,
        queueWordIds: ['w2', 'w3', 'w2'],
        fallbackWordIds: ['w1', 'w2', 'w3'],
        round2AttemptWordIds: ['w1', 'w3'],
      }),
    ).toEqual(['w1', 'w2', 'w3']);

    expect(
      resolveActuallyLearnedWordIds({
        round: 'article',
        currentIndex: 3,
        queueWordIds: ['w1', 'w2', 'w3'],
        fallbackWordIds: ['w1', 'w2', 'w3'],
        round2AttemptWordIds: ['w1'],
      }),
    ).toEqual([]);
  });

  it('treats final reinforcement and completed groups as core learning complete', () => {
    expect(
      isCoreLearningComplete({
        status: 'active',
        completedAt: null,
        sessionRound: 'round2',
      }),
    ).toBe(false);
    expect(
      isCoreLearningComplete({
        status: 'completed',
        completedAt: null,
        sessionRound: 'round2',
      }),
    ).toBe(true);
    expect(
      isCoreLearningComplete({
        status: 'active',
        completedAt: null,
        sessionRound: 'round3',
      }),
    ).toBe(false);
    expect(
      isCoreLearningComplete({
        status: 'active',
        completedAt: null,
        sessionRound: 'article',
      }),
    ).toBe(true);
  });
});
