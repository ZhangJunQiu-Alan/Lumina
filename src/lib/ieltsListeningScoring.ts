import type { IeltsListeningQuestion } from '../types';
import {
  clampIeltsElapsedSeconds,
  formatElapsedTime,
  normalizeIeltsAnswerText,
  normalizeIeltsAnswerValue,
  summarizeIeltsReadingResult,
  type IeltsReadingAnswerMap,
  type IeltsReadingAnswerValue,
  type IeltsReadingResultSummary,
} from './ieltsReadingScoring';

export type IeltsListeningAnswerValue = IeltsReadingAnswerValue;
export type IeltsListeningAnswerMap = IeltsReadingAnswerMap;
export type IeltsListeningResultSummary = IeltsReadingResultSummary;

function looseText(value: string): string {
  return normalizeIeltsAnswerText(value)
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(value: string): string {
  const normalized = looseText(value);
  if (normalized.endsWith('ies') && normalized.length > 4) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('es') && normalized.length > 3) return normalized.slice(0, -2);
  if (normalized.endsWith('s') && normalized.length > 3) return normalized.slice(0, -1);
  return normalized;
}

function valuesMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeIeltsAnswerText(left);
  const normalizedRight = normalizeIeltsAnswerText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (looseText(normalizedLeft) === looseText(normalizedRight)) return true;
  return singularize(normalizedLeft) === singularize(normalizedRight);
}

function matchesSingleAnswer(response: string[], correctAnswers: string[]): boolean {
  if (response.length !== 1 || correctAnswers.length === 0) return false;
  return correctAnswers.some((correct) => valuesMatch(response[0], correct));
}

function uniqueAnswers(values: string[]): string[] {
  return values.reduce<string[]>(
    (unique, value) => (unique.some((existing) => valuesMatch(existing, value)) ? unique : [...unique, value]),
    [],
  );
}

function sharedAlternativeGroupKey(question: IeltsListeningQuestion, correctAnswer: string[]): string | null {
  const uniqueCorrect = uniqueAnswers(correctAnswer);
  if (uniqueCorrect.length <= 1) return null;
  return `${question.groupId}:${uniqueCorrect
    .map((value) => normalizeIeltsAnswerText(value))
    .sort()
    .join('|')}`;
}

export function isIeltsListeningQuestionCorrect(
  question: Pick<IeltsListeningQuestion, 'answer'>,
  responseValue: IeltsListeningAnswerValue,
): boolean {
  const response = normalizeIeltsAnswerValue(responseValue);
  const correctAnswers = normalizeIeltsAnswerValue(question.answer);
  return matchesSingleAnswer(response, correctAnswers);
}

export function evaluateIeltsListeningAnswers(questions: IeltsListeningQuestion[], answers: IeltsListeningAnswerMap) {
  const responses = questions.map((question) => {
    const response = normalizeIeltsAnswerValue(answers[question.number]);
    const correctAnswer = normalizeIeltsAnswerValue(question.answer);
    const isCorrect = isIeltsListeningQuestionCorrect(question, response);

    return {
      questionId: question.id,
      questionNumber: question.number,
      response,
      correctAnswer,
      isCorrect,
    };
  });
  const sharedAlternativeGroups = new Map<string, number[]>();
  responses.forEach((response, index) => {
    const key = sharedAlternativeGroupKey(questions[index], response.correctAnswer);
    if (!key) return;
    sharedAlternativeGroups.set(key, [...(sharedAlternativeGroups.get(key) ?? []), index]);
  });

  for (const indexes of sharedAlternativeGroups.values()) {
    if (indexes.length < 2) continue;
    const correctOptions = uniqueAnswers(responses[indexes[0]].correctAnswer);
    if (correctOptions.length !== indexes.length) continue;

    const remaining = [...correctOptions];
    for (const index of indexes) responses[index].isCorrect = false;
    for (const index of indexes.sort((left, right) => questions[left].number - questions[right].number)) {
      const response = responses[index].response;
      if (response.length !== 1) continue;
      const matchedIndex = remaining.findIndex((correct) => valuesMatch(response[0], correct));
      if (matchedIndex < 0) continue;
      responses[index].isCorrect = true;
      remaining.splice(matchedIndex, 1);
    }
  }

  return {
    score: responses.filter((response) => response.isCorrect).length,
    totalQuestions: questions.length,
    summary: summarizeIeltsListeningResult(responses, questions.length),
    responses,
  };
}

export function summarizeIeltsListeningResult(
  responses: Parameters<typeof summarizeIeltsReadingResult>[0],
  totalQuestions = responses.length,
): IeltsListeningResultSummary {
  return summarizeIeltsReadingResult(responses, totalQuestions);
}

export { clampIeltsElapsedSeconds, formatElapsedTime, normalizeIeltsAnswerText, normalizeIeltsAnswerValue };
