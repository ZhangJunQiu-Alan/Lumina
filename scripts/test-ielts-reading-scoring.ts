import assert from 'node:assert/strict';
import type { IeltsReadingQuestion } from '../src/types.ts';
import {
  clampIeltsElapsedSeconds,
  evaluateIeltsReadingAnswers,
  formatElapsedTime,
  isIeltsQuestionCorrect,
  normalizeIeltsAnswerText,
  summarizeIeltsReadingResult,
} from '../src/lib/ieltsReadingScoring.ts';

const baseQuestion: IeltsReadingQuestion = {
  id: 'q1',
  testId: 'test',
  groupId: 'group',
  number: 1,
  prompt: 'Question',
  options: [],
  answer: ['eco-tourism'],
  answerNote: '',
  type: 'sentence_completion',
  passageNumber: 1,
};

assert.equal(normalizeIeltsAnswerText('  Eco–Tourism. '), 'eco-tourism');
assert.equal(isIeltsQuestionCorrect(baseQuestion, 'eco tourism'), true);
assert.equal(isIeltsQuestionCorrect({ ...baseQuestion, answer: ['lower frequencies'] }, 'lower frequencies'), true);
assert.equal(isIeltsQuestionCorrect({ ...baseQuestion, answer: ['parks'] }, 'park'), true);
assert.equal(isIeltsQuestionCorrect({ ...baseQuestion, answer: ['TRUE'], type: 'true_false_not_given' }, 'true'), true);
assert.equal(isIeltsQuestionCorrect({ ...baseQuestion, answer: ['A', 'C'], type: 'multiple_choice_multi' }, ['C', 'A']), true);
assert.equal(isIeltsQuestionCorrect({ ...baseQuestion, answer: ['A', 'C'], type: 'multiple_choice_multi' }, ['A']), false);

const result = evaluateIeltsReadingAnswers(
  [
    baseQuestion,
    { ...baseQuestion, id: 'q2', number: 2, answer: ['FALSE'], type: 'true_false_not_given' },
    { ...baseQuestion, id: 'q3', number: 3, answer: ['A', 'D'], type: 'multiple_choice_multi' },
  ],
  {
    1: 'eco tourism',
    2: 'not given',
    3: ['D', 'A'],
  },
);

assert.equal(result.score, 2);
assert.equal(result.totalQuestions, 3);
assert.deepEqual(result.responses.map((response) => response.isCorrect), [true, false, true]);
assert.deepEqual(result.summary, {
  answeredCount: 3,
  correctCount: 2,
  wrongCount: 1,
  unansweredCount: 0,
  accuracyPercent: 67,
});

const incompleteResult = evaluateIeltsReadingAnswers(
  [
    baseQuestion,
    { ...baseQuestion, id: 'q2', number: 2, answer: ['FALSE'], type: 'true_false_not_given' },
    { ...baseQuestion, id: 'q3', number: 3, answer: ['A'], type: 'multiple_choice_single' },
  ],
  {
    1: 'eco tourism',
    2: '',
  },
);

assert.deepEqual(incompleteResult.summary, {
  answeredCount: 1,
  correctCount: 1,
  wrongCount: 0,
  unansweredCount: 2,
  accuracyPercent: 33,
});
assert.deepEqual(
  summarizeIeltsReadingResult([
    { response: ['a'], isCorrect: true },
    { response: ['b'], isCorrect: false },
    { response: [], isCorrect: false },
  ], 4),
  {
    answeredCount: 2,
    correctCount: 1,
    wrongCount: 1,
    unansweredCount: 2,
    accuracyPercent: 25,
  },
);
assert.equal(clampIeltsElapsedSeconds(60 * 60 + 14), 60 * 60);
assert.equal(clampIeltsElapsedSeconds(-5), 0);
assert.equal(formatElapsedTime(clampIeltsElapsedSeconds(60 * 60 + 14)), '60:00');

console.log('IELTS reading scoring tests passed.');
