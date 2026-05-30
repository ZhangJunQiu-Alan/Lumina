import type { IeltsReadingQuestion, IeltsReadingQuestionType } from '../types';

const MULTI_ANSWER_TYPES = new Set<IeltsReadingQuestionType>(['multiple_choice_multi']);

const DASH_RE = /[‐‑‒–—]/g;
const QUOTE_RE = /[‘’]/g;
const DOUBLE_QUOTE_RE = /[“”]/g;
const WHITESPACE_RE = /\s+/g;
const OUTER_PUNCT_RE = /^[\s"'.,;:!?()[\]{}]+|[\s"'.,;:!?()[\]{}]+$/g;

export type IeltsReadingAnswerValue = string | string[] | null | undefined;
export type IeltsReadingAnswerMap = Record<number, IeltsReadingAnswerValue>;

interface IeltsReadingResponseLike {
  response: string[];
  isCorrect: boolean;
}

export interface IeltsReadingResultSummary {
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  accuracyPercent: number;
}

export function normalizeIeltsAnswerText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(DASH_RE, '-')
    .replace(QUOTE_RE, "'")
    .replace(DOUBLE_QUOTE_RE, '"')
    .replace(OUTER_PUNCT_RE, '')
    .replace(WHITESPACE_RE, ' ')
    .trim()
    .toLowerCase();
}

function looseText(value: string): string {
  return normalizeIeltsAnswerText(value)
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(value: string): string {
  const normalized = looseText(value);
  if (normalized.endsWith('ies') && normalized.length > 4) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith('es') && normalized.length > 3) {
    return normalized.slice(0, -2);
  }
  if (normalized.endsWith('s') && normalized.length > 3) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function normalizeIeltsAnswerValue(value: IeltsReadingAnswerValue): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeIeltsAnswerText(String(item))).filter(Boolean);
  }

  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  return [normalizeIeltsAnswerText(trimmed)];
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

function matchesMultiAnswer(response: string[], correctAnswers: string[]): boolean {
  if (response.length !== correctAnswers.length || correctAnswers.length === 0) return false;

  const unmatched = [...correctAnswers];
  for (const responseValue of response) {
    const index = unmatched.findIndex((correct) => valuesMatch(responseValue, correct));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }

  return unmatched.length === 0;
}

function uniqueAnswers(values: string[]): string[] {
  return values.reduce<string[]>(
    (unique, value) => (unique.some((existing) => valuesMatch(existing, value)) ? unique : [...unique, value]),
    [],
  );
}

function sharedAlternativeGroupKey(question: IeltsReadingQuestion, correctAnswer: string[]): string | null {
  const uniqueCorrect = uniqueAnswers(correctAnswer);
  if (uniqueCorrect.length <= 1) return null;
  return `${question.groupId}:${uniqueCorrect
    .map((value) => normalizeIeltsAnswerText(value))
    .sort()
    .join('|')}`;
}

export function isIeltsQuestionCorrect(
  question: Pick<IeltsReadingQuestion, 'type' | 'answer'>,
  responseValue: IeltsReadingAnswerValue,
): boolean {
  const response = normalizeIeltsAnswerValue(responseValue);
  const correctAnswers = normalizeIeltsAnswerValue(question.answer);

  if (MULTI_ANSWER_TYPES.has(question.type)) {
    return matchesMultiAnswer(response, correctAnswers);
  }

  return matchesSingleAnswer(response, correctAnswers);
}

export function evaluateIeltsReadingAnswers(questions: IeltsReadingQuestion[], answers: IeltsReadingAnswerMap) {
  const responses = questions.map((question) => {
    const response = normalizeIeltsAnswerValue(answers[question.number]);
    const correctAnswer = normalizeIeltsAnswerValue(question.answer);
    const isCorrect = isIeltsQuestionCorrect(question, response);

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
    summary: summarizeIeltsReadingResult(responses, questions.length),
    responses,
  };
}

export function summarizeIeltsReadingResult(
  responses: IeltsReadingResponseLike[],
  totalQuestions = responses.length,
): IeltsReadingResultSummary {
  const safeTotal = Math.max(0, totalQuestions);
  const correctCount = responses.filter((response) => response.isCorrect).length;
  const answeredCount = responses.filter((response) => response.response.length > 0).length;
  const wrongCount = responses.filter((response) => response.response.length > 0 && !response.isCorrect).length;
  const unansweredCount = Math.max(0, safeTotal - answeredCount);
  const accuracyPercent = safeTotal > 0 ? Math.round((correctCount / safeTotal) * 100) : 0;

  return {
    answeredCount,
    correctCount,
    wrongCount,
    unansweredCount,
    accuracyPercent,
  };
}

export function clampIeltsElapsedSeconds(totalSeconds: number, maxSeconds = 60 * 60): number {
  return Math.min(Math.max(0, Math.floor(totalSeconds)), maxSeconds);
}

export function formatElapsedTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
