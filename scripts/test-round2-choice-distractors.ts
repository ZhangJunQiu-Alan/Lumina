import assert from 'node:assert/strict';
import {
  normalizeRound2ChoiceDistractors,
  validateRound2ChoiceDistractors,
} from '../shared/round2ChoiceDistractors.ts';

const validDistractors = [
  { word: 'ambivalent', pos: 'adj', meaning_zh: '矛盾的；态度摇摆的', relation: 'confusable' },
  { word: 'vague', pos: 'adj', meaning_zh: '模糊的；不清楚的', relation: 'semantic_near' },
  { word: 'obscure', pos: 'adj', meaning_zh: '难以理解的；晦涩的', relation: 'semantic_near' },
];

assert.deepEqual(normalizeRound2ChoiceDistractors([{ word: '  vague ', pos: ' adj ', meaning_zh: ' 模糊的 ' }]), [
  { word: 'vague', pos: 'adj', meaning_zh: '模糊的' },
]);

assert.equal(validateRound2ChoiceDistractors('ambiguous', validDistractors).valid, true);
assert.equal(validateRound2ChoiceDistractors('ambiguous', validDistractors.slice(0, 2)).valid, false);
assert.equal(
  validateRound2ChoiceDistractors('ambiguous', [
    { word: 'ambiguous', pos: 'adj', meaning_zh: '含糊的；有歧义的' },
    { word: 'vague', pos: 'adj', meaning_zh: '模糊的；不清楚的' },
    { word: 'obscure', pos: 'adj', meaning_zh: '难以理解的；晦涩的' },
  ]).valid,
  false,
);
assert.equal(
  validateRound2ChoiceDistractors('ambiguous', [
    { word: 'vague', pos: 'adj', meaning_zh: '模糊的；不清楚的' },
    { word: 'vague', pos: 'adj', meaning_zh: '含糊的；有歧义的' },
    { word: 'obscure', pos: 'adj', meaning_zh: '难以理解的；晦涩的' },
  ]).valid,
  false,
);
assert.equal(
  validateRound2ChoiceDistractors('ambiguous', [
    { word: 'ambivalent', pos: 'adj', meaning_zh: '模糊的；不清楚的' },
    { word: 'vague', pos: 'adj', meaning_zh: '模糊的；不清楚的' },
    { word: 'obscure', pos: 'adj', meaning_zh: '难以理解的；晦涩的' },
  ]).valid,
  false,
);

console.log('round2 choice distractor validation tests passed');
