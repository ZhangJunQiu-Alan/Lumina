import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Word } from '../types';
import { preloadRound1CardResources } from './round1Preload';
import { preloadClickableWordLookups, preloadClickableWordResources } from './wordResourcePreload';

vi.mock('./wordResourcePreload', () => ({
  preloadClickableWordResources: vi.fn(() => Promise.resolve()),
  preloadClickableWordLookups: vi.fn(() => Promise.resolve()),
}));

const buildWord = (): Word => ({
  id: 'round1-preload-routing',
  word: 'Oxygen',
  phonetic: '',
  pos_tags: [],
  ner_entities: [],
  chinese_definition: '',
  senses: [
    {
      pos: 'n.',
      meaning_zh: '',
      example_sentence: 'Atmosphere has oxygen, nitrogen, and O2 signals.',
      example_translation_zh: '',
    },
  ],
  example_sentences: [],
  morphology: {
    summaryZh: 'The oxy- and -gen fragments should be ignored.',
    parts: [],
  },
  derivedWords: [{ word: 'oxygenate', meaningZh: 'add oxygen', noteZh: 'water treatment' }],
  synonyms: [{ word: 'atmosphere', meaningZh: 'air around earth', noteZh: '' }],
  antonyms: [],
  confusingPairs: [{ word: 'ozone', difference: 'ozone has three oxygen atoms' }],
  round2ChoiceDistractors: [],
  memory_tip: 'Avoid h o n ox hydro- H2O fragments.',
  audio_uk_url: null,
  audio_us_url: null,
});

const mockedPreloadResources = vi.mocked(preloadClickableWordResources);
const mockedPreloadLookups = vi.mocked(preloadClickableWordLookups);

describe('preloadRound1CardResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preloads audio for high-value words and lookup only for lower-value context words', async () => {
    await preloadRound1CardResources(buildWord(), 'uk');

    expect(mockedPreloadResources).toHaveBeenCalledTimes(1);
    expect(mockedPreloadResources).toHaveBeenCalledWith(['oxygen', 'oxygenate', 'atmosphere', 'ozone'], 'uk');

    expect(mockedPreloadLookups).toHaveBeenCalledTimes(1);
    expect(mockedPreloadLookups).toHaveBeenCalledWith(
      expect.arrayContaining(['nitrogen', 'signals', 'fragments', 'water', 'treatment']),
      'uk',
    );
    expect(mockedPreloadLookups.mock.calls[0]?.[0]).not.toEqual(
      expect.arrayContaining(['oxygen', 'o2', 'h2o', 'oxy-', '-gen', 'hydro-', 'h', 'o', 'n', 'ox']),
    );
  });
});
