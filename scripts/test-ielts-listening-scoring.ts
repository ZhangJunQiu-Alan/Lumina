import assert from 'node:assert/strict';
import type { IeltsListeningQuestion } from '../src/types.ts';
import {
  clampIeltsElapsedSeconds,
  evaluateIeltsListeningAnswers,
  formatElapsedTime,
  isIeltsListeningQuestionCorrect,
  normalizeIeltsAnswerText,
  summarizeIeltsListeningResult,
} from '../src/lib/ieltsListeningScoring.ts';

const baseQuestion: IeltsListeningQuestion = {
  id: 'q1',
  testId: 'test',
  sectionId: 'section',
  groupId: 'group',
  number: 1,
  prompt: 'Question',
  options: [],
  answer: ['notice board'],
  answerNote: '',
  type: 'note_completion',
  sectionNumber: 1,
};

assert.equal(normalizeIeltsAnswerText('  Notice–Board. '), 'notice-board');
assert.equal(isIeltsListeningQuestionCorrect(baseQuestion, 'notice board'), true);
assert.equal(isIeltsListeningQuestionCorrect({ ...baseQuestion, answer: ['parks'] }, 'park'), true);
assert.equal(isIeltsListeningQuestionCorrect({ ...baseQuestion, answer: ['A'] }, 'a'), true);
assert.equal(isIeltsListeningQuestionCorrect({ ...baseQuestion, answer: ['Tower of London', 'the Tower of London'] }, 'the tower of london'), true);

const result = evaluateIeltsListeningAnswers(
  [
    baseQuestion,
    { ...baseQuestion, id: 'q2', number: 2, answer: ['C'], type: 'multiple_choice_single' },
    { ...baseQuestion, id: 'q3', number: 3, answer: ['13th February'] },
  ],
  {
    1: 'notice-board',
    2: 'b',
    3: '13th february',
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

const multiAnswerResult = evaluateIeltsListeningAnswers(
  [
    { ...baseQuestion, id: 'q25', groupId: 'multi', number: 25, answer: ['B', 'C'], type: 'matching' },
    { ...baseQuestion, id: 'q26', groupId: 'multi', number: 26, answer: ['B', 'C'], type: 'matching' },
  ],
  {
    25: 'B',
    26: 'B',
  },
);
assert.equal(multiAnswerResult.score, 1);
assert.deepEqual(multiAnswerResult.responses.map((response) => response.isCorrect), [true, false]);
assert.equal(
  evaluateIeltsListeningAnswers(
    [
      { ...baseQuestion, id: 'q25', groupId: 'multi', number: 25, answer: ['B', 'C'], type: 'matching' },
      { ...baseQuestion, id: 'q26', groupId: 'multi', number: 26, answer: ['B', 'C'], type: 'matching' },
    ],
    {
      25: 'C',
      26: 'B',
    },
  ).score,
  2,
);

assert.deepEqual(
  summarizeIeltsListeningResult([
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
assert.equal(clampIeltsElapsedSeconds(30 * 60 + 8, 30 * 60), 30 * 60);
assert.equal(formatElapsedTime(30 * 60), '30:00');

console.log('IELTS listening scoring tests passed.');
