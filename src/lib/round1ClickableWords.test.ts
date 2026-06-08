import { describe, expect, it } from 'vitest';
import type { Word } from '../types';
import { extractRound1ClickableWords, extractRound1PreloadTargets } from './round1ClickableWords';

const buildWord = (): Word => ({
  id: 'round1-preload-test',
  word: 'Oxygen',
  phonetic: '',
  pos_tags: [],
  ner_entities: [],
  chinese_definition: '',
  senses: [
    {
      pos: 'n.',
      meaning_zh: '',
      example_sentence: "Earth's atmosphere contains oxygen and nitrogen signals.",
      example_translation_zh: '',
    },
  ],
  example_sentences: [],
  morphology: {
    summaryZh: 'The oxy- fragment and O2 label should not be lookup targets.',
    parts: [],
  },
  derivedWords: [{ word: 'oxygenate', meaningZh: 'add oxygen', noteZh: 'used in water treatment' }],
  synonyms: [
    { word: 'atmosphere', meaningZh: 'air around earth', noteZh: '' },
    { word: 'air', meaningZh: 'short synonym still filtered by tokenizer length', noteZh: '' },
    { word: 'gas', meaningZh: 'third synonym hidden', noteZh: '' },
  ],
  antonyms: [{ word: 'vacuum', meaningZh: 'space without air', noteZh: '' }],
  confusingPairs: [{ word: 'ozone', difference: 'ozone has three oxygen atoms' }],
  round2ChoiceDistractors: [],
  memory_tip: 'Avoid h o n ox -gen hydro- H2O; focus on oxygen in atmosphere.',
  audio_uk_url: null,
  audio_us_url: null,
});

describe('extractRound1PreloadTargets', () => {
  it('separates high-value audio targets from low-value lookup-only words', () => {
    const targets = extractRound1PreloadTargets(buildWord());

    expect(targets.highValueWords).toEqual(['oxygen', 'oxygenate', 'atmosphere', 'air', 'vacuum', 'ozone']);
    expect(targets.lowValueWords).toContain('contains');
    expect(targets.lowValueWords).toContain('nitrogen');
    expect(targets.lowValueWords).toContain('signals');
    expect(targets.lowValueWords).not.toContain('oxygen');
    expect(targets.lowValueWords).not.toContain('atmosphere');
    expect(targets.lowValueWords).not.toContain('air');
  });

  it('does not emit invalid lookup fragments as clickable words', () => {
    const clickableWords = extractRound1ClickableWords(buildWord());

    for (const invalidWord of ["earth's", 'o2', 'h2o', 'oxy-', '-gen', 'hydro-', 'h', 'o', 'n', 'ox', 'dna']) {
      expect(clickableWords).not.toContain(invalidWord);
    }
  });
});
