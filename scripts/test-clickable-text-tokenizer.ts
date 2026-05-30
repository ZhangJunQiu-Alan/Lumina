import assert from 'node:assert/strict';
import { tokenizeClickableText } from '../src/components/shared/ClickableText.tsx';
import { coerceIeltsReadingDraft } from '../src/lib/ieltsReadingDraft.ts';
import { isStopWord } from '../src/lib/stopWords.ts';
import { extractIeltsReadingLookupWords } from '../src/lib/ieltsReadingLookupWords.ts';
import { extractRound1ClickableWords } from '../src/lib/round1ClickableWords.ts';
import type { Word } from '../src/types.ts';

const simpleTokens = tokenizeClickableText('The salt is on the table.');
assert.deepEqual(
  simpleTokens.filter((token) => token.kind === 'content').map((token) => token.normalized),
  ['salt', 'table'],
);

for (const word of ['should', 'could', 'would', 'might']) {
  assert.equal(isStopWord(word), true);
}

const mixedTokens = tokenizeClickableText('盐 salt 在 table 上。');
assert.deepEqual(
  mixedTokens.filter((token) => token.kind === 'content').map((token) => token.normalized),
  ['salt', 'table'],
);
assert.equal(
  mixedTokens.some((token) => token.kind === 'cjk' && token.text === '盐'),
  true,
);

assert.deepEqual(
  extractIeltsReadingLookupWords(
    "The well-developed acoustic sense isn't weak, and well-developed dolphins track o'clock signals.",
  ),
  ['well-developed', 'acoustic', 'sense', "isn't", 'weak', 'dolphins', 'track', "o'clock", 'signals'],
);

const legacyReadingDraft = coerceIeltsReadingDraft(
  JSON.stringify({
    startedAt: '2026-05-18T08:00:00.000Z',
    answers: {},
    selectedPassage: 2,
  }),
);
assert.equal(legacyReadingDraft?.practiceMode, false);

const practiceReadingDraft = coerceIeltsReadingDraft(
  JSON.stringify({
    startedAt: '2026-05-18T08:00:00.000Z',
    answers: {},
    selectedPassage: 2,
    practiceMode: true,
  }),
);
assert.equal(practiceReadingDraft?.practiceMode, true);

const round1Word: Word = {
  id: 'round1-test',
  word: 'Analyze',
  phonetic: '',
  pos_tags: [],
  ner_entities: [],
  chinese_definition: 'hiddenMeaning',
  senses: [
    {
      pos: 'v.',
      meaning_zh: 'hiddenSense',
      example_sentence: 'The team will **analyze** salt and table data.',
      example_translation_zh: 'hiddenTranslation',
    },
    {
      pos: 'v.',
      meaning_zh: '',
      example_sentence: 'Researchers compare method and signal.',
      example_translation_zh: 'hiddenExampleTranslation',
    },
    {
      pos: 'v.',
      meaning_zh: '',
      example_sentence: 'Ignored third sentence keyword.',
      example_translation_zh: '',
    },
  ],
  example_sentences: [],
  morphology: {
    summaryZh: 'Prefix meta helps decode structure.',
    parts: [
      {
        text: 'ana-',
        kind: 'prefix',
        meaningZh: 'hiddenPartMeaning',
        noteZh: 'hiddenPartNote',
      },
    ],
  },
  derivedWords: [
    { word: 'analysis', meaningZh: 'system review', noteZh: 'analytic method' },
    { word: '', meaningZh: 'hiddenEmptyWordDetail', noteZh: '' },
  ],
  synonyms: [
    { word: 'inspect', meaningZh: 'look closely', noteZh: '' },
    { word: 'examine', meaningZh: 'check carefully', noteZh: '' },
    { word: 'probe', meaningZh: 'third synonym hidden', noteZh: '' },
  ],
  antonyms: [
    { word: 'ignore', meaningZh: 'not notice', noteZh: '' },
    { word: 'overlook', meaningZh: 'miss signal', noteZh: '' },
    { word: 'neglect', meaningZh: 'third antonym hidden', noteZh: '' },
  ],
  confusingPairs: [{ word: 'assess', difference: 'assess rates value while analyze separates parts' }],
  memory_tip: "Don't just look; analyze the pattern and compare signals.",
  audio_uk_url: null,
  audio_us_url: null,
};

const round1ClickableWords = extractRound1ClickableWords(round1Word);
const round1ClickableWordSet = new Set(round1ClickableWords);

for (const expected of [
  'analyze',
  'pattern',
  'signals',
  'prefix',
  'decode',
  'analysis',
  'analytic',
  'inspect',
  'examine',
  'ignore',
  'overlook',
  'assess',
  'salt',
  'table',
  'researchers',
  'method',
]) {
  assert.equal(round1ClickableWordSet.has(expected), true, `${expected} should be preloaded`);
}

for (const excluded of [
  'the',
  'hiddenmeaning',
  'hiddensense',
  'hiddentranslation',
  'hiddenexampletranslation',
  'hiddenpartmeaning',
  'hiddenemptyworddetail',
  'probe',
  'neglect',
  'keyword',
]) {
  assert.equal(round1ClickableWordSet.has(excluded), false, `${excluded} should not be preloaded`);
}

assert.equal(
  round1ClickableWords.filter((word) => word === 'analyze').length,
  1,
  'duplicate clickable words should be collapsed',
);

console.log('clickable text tokenizer checks passed');
