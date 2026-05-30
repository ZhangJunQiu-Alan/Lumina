import { describe, expect, it } from 'vitest';
import { resolveActuallyLearnedWordIds } from '../../shared/officialDiscard';
import type { Word } from '../types';
import {
  clampSessionIndex,
  createInitialLearningSession,
  createResumeCandidate,
  filterMasteredSessionWords,
  isCoreLearningComplete,
  normalizePersistedLearningSession,
  normalizeSessionQueueWordIds,
  normalizeSessionRound1ConfirmedWordIds,
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
} satisfies Pick<Word, 'morphology' | 'derivedWords' | 'synonyms' | 'antonyms' | 'confusingPairs'>;

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

    expect(fallback.currentIndex).toBe(2);
    expect(fallback.queueWordIds).toEqual(['w1', 'w2', 'w3']);
    expect(fallback.passedQueueIndices).toEqual([0, 1]);
    expect(fallback.round1ConfirmedWordIds).toEqual(['w3']);
  });

  it('creates a resume candidate and reconciles stale round 2 progress from history', () => {
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

  it('moves a stale session to the first unfinished round 2 word or completes it', () => {
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
        correctWordIds: ['w1', 'w2'],
        lastAttemptAt: '2026-04-18T00:05:00.000Z',
      },
    );

    expect(reconciledRound2.round).toBe('round2');
    expect(reconciledRound2.currentIndex).toBe(2);
    expect(reconciledRound2.queueWordIds).toEqual(['w1', 'w2', 'w3']);
    expect(reconciledRound2.passedQueueIndices).toEqual([0, 1]);
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

    expect(reconciledComplete.round).toBe('round3');
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
        round: 'round2',
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

  it('treats reinforcement rounds and completed groups as core learning complete', () => {
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
    ).toBe(true);
  });
});
