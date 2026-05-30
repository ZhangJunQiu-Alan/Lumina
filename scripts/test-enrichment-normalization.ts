import assert from 'node:assert/strict';
import { normalizeGeminiWordResult } from '../shared/server/gemini.ts';

const normalized = normalizeGeminiWordResult({
  word: 'Granite',
  ipa_uk: '/ˈɡræn.ɪt/',
  ipa_us: '/ˈɡræn.ɪt/',
  primary_meaning_zh: '花岗岩',
  ner_label: null,
  senses: [
    {
      pos: 'n',
      meaning_zh: '花岗岩',
      example_sentence: 'The countertop is made of granite.',
      example_translation_zh: '这个台面由花岗岩制成。',
    },
  ],
  morphology: {
    summary_zh: 'gran- 和颗粒、岩石质地有关。',
    parts: [
      { text: 'gran', kind: 'root', meaning_zh: '颗粒', note_zh: '联想到 grain' },
      { text: 'gran', kind: 'root', meaning_zh: '重复', note_zh: '这条应被去重' },
      { text: '-ite', kind: 'suffix', meaning_zh: '矿物后缀', note_zh: '常见于矿石名' },
    ],
  },
  derived_words: [
    { word: 'granite', meaning_zh: '自身', note_zh: '应过滤自身' },
    { word: 'granitic', meaning_zh: '花岗岩的', note_zh: '派生词保留' },
    { word: 'granitic', meaning_zh: '重复', note_zh: '应去重' },
  ],
  synonyms: [
    { word: 'stone', meaning_zh: '石头', note_zh: '保留' },
    { word: 'Stone', meaning_zh: '大小写重复', note_zh: '应去重' },
  ],
  antonyms: [
    { word: 'soil', meaning_zh: '土壤', note_zh: '保留' },
    { word: 'granite', meaning_zh: '自身', note_zh: '应过滤自身' },
  ],
  confusions: [
    { word: 'graphite', difference_zh: '石墨，不是花岗岩。' },
    { word: 'Graphite', difference_zh: '重复，应去重。' },
    { word: 'marble', difference_zh: '' },
    { word: 'slate', difference_zh: '板岩。' },
    { word: 'basalt', difference_zh: '玄武岩。' },
    { word: 'gneiss', difference_zh: '片麻岩，应因上限被截断。' },
  ],
  memory_tip: 'granite 像 grain 一样颗粒感强，所以想到坚硬的花岗岩。',
});

assert.equal(normalized.morphology.parts.length, 2);
assert.deepEqual(
  normalized.morphology.parts.map((part) => part.text),
  ['gran', '-ite'],
);

assert.deepEqual(
  normalized.derived_words.map((item) => item.word),
  ['granitic'],
);
assert.deepEqual(
  normalized.synonyms.map((item) => item.word),
  ['stone'],
);
assert.deepEqual(
  normalized.antonyms.map((item) => item.word),
  ['soil'],
);

assert.deepEqual(
  normalized.confusions.map((item) => item.word),
  ['graphite', 'slate'],
);
assert.equal(normalized.confused_word, 'graphite');
assert.equal(normalized.confused_diff_zh, '石墨，不是花岗岩。');

const fallback = normalizeGeminiWordResult({
  word: 'derive',
  ipa_uk: '/dɪˈraɪv/',
  ipa_us: '/dɪˈraɪv/',
  primary_meaning_zh: '源于',
  ner_label: null,
  senses: [],
  morphology: null,
  derived_words: null,
  synonyms: null,
  antonyms: null,
  confusions: null,
  memory_tip: '记住 de- + rive 的来源感。',
} as Record<string, unknown>);

assert.equal(fallback.morphology.parts.length, 0);
assert.ok(fallback.morphology.summary_zh.length > 0);
assert.deepEqual(fallback.derived_words, []);
assert.deepEqual(fallback.synonyms, []);
assert.deepEqual(fallback.antonyms, []);
assert.deepEqual(fallback.confusions, []);

console.log('enrichment normalization checks passed');
