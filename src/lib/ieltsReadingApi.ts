import type {
  IeltsReadingAttemptResult,
  IeltsReadingAttemptSummary,
  IeltsReadingBookSummary,
  IeltsReadingOption,
  IeltsReadingPassage,
  IeltsReadingQuestion,
  IeltsReadingQuestionGroup,
  IeltsReadingQuestionType,
  IeltsReadingResponseResult,
  IeltsReadingTestDetail,
  IeltsReadingTestSummary,
} from '../types';
import { supabase } from './supabase';
import {
  evaluateIeltsReadingAnswers,
  normalizeIeltsAnswerValue,
  type IeltsReadingAnswerMap,
} from './ieltsReadingScoring';
import { normalizeIeltsPassageBody } from './ieltsReadingText';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface BookRow {
  id: string;
  book_number: number | null;
  title: string | null;
  source_label: string | null;
  ielts_reading_tests?: TestRow[] | TestRow | null;
}

interface TestRow {
  id: string;
  book_id?: string | null;
  test_number: number | null;
  title: string | null;
  ielts_reading_books?: BookRow | BookRow[] | null;
  ielts_reading_passages?: PassageRow[] | PassageRow | null;
  ielts_reading_questions?: { id: string }[] | null;
}

interface PassageRow {
  id: string;
  test_id?: string | null;
  passage_number: number | null;
  title: string | null;
  body: string | null;
  word_count: number | null;
  sort_order: number | null;
  ielts_reading_question_groups?: QuestionGroupRow[] | QuestionGroupRow | null;
}

interface QuestionGroupRow {
  id: string;
  passage_id?: string | null;
  question_type: IeltsReadingQuestionType | null;
  prompt: string | null;
  instructions: string | null;
  options_json: JsonValue;
  question_range_start: number | null;
  question_range_end: number | null;
  sort_order: number | null;
  ielts_reading_questions?: QuestionRow[] | QuestionRow | null;
}

interface QuestionRow {
  id: string;
  test_id: string | null;
  group_id: string | null;
  question_number: number | null;
  prompt: string | null;
  options_json: JsonValue;
  answer_json: JsonValue;
  answer_note: string | null;
  sort_order: number | null;
}

interface AttemptRow {
  id: string;
  test_id: string | null;
  score: number | null;
  total_questions: number | null;
  elapsed_seconds: number | null;
  submitted_at: string | null;
  created_at?: string | null;
  ielts_reading_tests?: TestRow | TestRow[] | null;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function coerceOptions(value: JsonValue): IeltsReadingOption[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        return { key: String.fromCharCode(65 + index), text: item };
      }

      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item as Record<string, JsonValue>;
        const key = typeof record.key === 'string' ? record.key : String.fromCharCode(65 + index);
        const text = typeof record.text === 'string' ? record.text : '';
        return { key, text };
      }

      return null;
    })
    .filter((option): option is IeltsReadingOption => Boolean(option && option.key && option.text));
}

function coerceAnswers(value: JsonValue): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === 'string' || typeof item === 'number') return [String(item)];
        return [];
      })
      .filter(Boolean);
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return [String(value)];
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, JsonValue>;
    return coerceAnswers(record.answers ?? []);
  }

  return [];
}

function mapQuestion(
  row: QuestionRow,
  group: Pick<IeltsReadingQuestionGroup, 'id' | 'type'>,
  passageNumber: number,
): IeltsReadingQuestion {
  return {
    id: row.id,
    testId: row.test_id ?? '',
    groupId: group.id,
    number: row.question_number ?? 0,
    prompt: row.prompt?.trim() ?? '',
    options: coerceOptions(row.options_json),
    answer: coerceAnswers(row.answer_json),
    answerNote: row.answer_note?.trim() ?? '',
    type: group.type,
    passageNumber,
  };
}

function mapQuestionGroup(row: QuestionGroupRow, passageNumber: number): IeltsReadingQuestionGroup {
  const group: IeltsReadingQuestionGroup = {
    id: row.id,
    type: row.question_type ?? 'other',
    prompt: row.prompt?.trim() ?? '',
    instructions: row.instructions?.trim() ?? '',
    options: coerceOptions(row.options_json),
    rangeStart: row.question_range_start,
    rangeEnd: row.question_range_end,
    questions: [],
  };

  group.questions = asArray(row.ielts_reading_questions)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((question) => mapQuestion(question, group, passageNumber))
    .sort((left, right) => left.number - right.number);

  return group;
}

function mapPassage(row: PassageRow): IeltsReadingPassage {
  const passageNumber = row.passage_number ?? 0;
  return {
    id: row.id,
    number: passageNumber,
    title: row.title?.trim() ?? `Reading Passage ${passageNumber}`,
    body: normalizeIeltsPassageBody(row.body ?? ''),
    wordCount: row.word_count ?? 0,
    groups: asArray(row.ielts_reading_question_groups)
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((group) => mapQuestionGroup(group, passageNumber)),
  };
}

function flattenQuestions(passages: IeltsReadingPassage[]): IeltsReadingQuestion[] {
  return passages
    .flatMap((passage) => passage.groups.flatMap((group) => group.questions))
    .sort((left, right) => left.number - right.number);
}

function mapTestSummary(row: TestRow, fallbackBook?: BookRow): IeltsReadingTestSummary {
  const book = asArray(row.ielts_reading_books)[0] ?? fallbackBook;
  const passages = asArray(row.ielts_reading_passages);
  const nestedQuestionCount = passages.reduce(
    (count, passage) => count + asArray(passage.ielts_reading_question_groups)
      .reduce((groupCount, group) => groupCount + asArray(group.ielts_reading_questions).length, 0),
    0,
  );
  const directQuestionCount = Array.isArray(row.ielts_reading_questions)
    ? row.ielts_reading_questions.length
    : 0;

  return {
    id: row.id,
    bookId: row.book_id ?? book?.id ?? '',
    bookNumber: book?.book_number ?? 0,
    bookTitle: book?.title ?? 'Cambridge IELTS',
    testNumber: row.test_number ?? 0,
    title: row.title?.trim() ?? `Test ${row.test_number ?? ''}`.trim(),
    passageCount: passages.length,
    questionCount: nestedQuestionCount || directQuestionCount,
  };
}

export async function fetchIeltsReadingBooks(): Promise<IeltsReadingBookSummary[]> {
  const { data, error } = await supabase
    .from('ielts_reading_books')
    .select(`
      id,
      book_number,
      title,
      source_label,
      ielts_reading_tests (
        id,
        book_id,
        test_number,
        title,
        ielts_reading_passages ( id )
      )
    `)
    .order('book_number', { ascending: true });

  if (error) throw new Error(`ielts_reading_books lookup failed: ${error.message}`);

  return ((data ?? []) as BookRow[]).map((book) => ({
    id: book.id,
    bookNumber: book.book_number ?? 0,
    title: book.title?.trim() ?? `Cambridge IELTS ${book.book_number ?? ''}`.trim(),
    sourceLabel: book.source_label?.trim() ?? '',
    tests: asArray(book.ielts_reading_tests)
      .map((test) => mapTestSummary(test, book))
      .sort((left, right) => left.testNumber - right.testNumber),
  }));
}

export async function fetchIeltsReadingTestDetail(testId: string): Promise<IeltsReadingTestDetail | null> {
  const { data, error } = await supabase
    .from('ielts_reading_tests')
    .select(`
      id,
      book_id,
      test_number,
      title,
      ielts_reading_books (
        id,
        book_number,
        title,
        source_label
      ),
      ielts_reading_passages (
        id,
        test_id,
        passage_number,
        title,
        body,
        word_count,
        sort_order,
        ielts_reading_question_groups (
          id,
          passage_id,
          question_type,
          prompt,
          instructions,
          options_json,
          question_range_start,
          question_range_end,
          sort_order,
          ielts_reading_questions (
            id,
            test_id,
            group_id,
            question_number,
            prompt,
            options_json,
            answer_json,
            answer_note,
            sort_order
          )
        )
      )
    `)
    .eq('id', testId)
    .maybeSingle();

  if (error) throw new Error(`ielts_reading_tests lookup failed: ${error.message}`);
  if (!data) return null;

  const row = data as TestRow;
  const passages = asArray(row.ielts_reading_passages)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map(mapPassage)
    .sort((left, right) => left.number - right.number);
  const summary = mapTestSummary({ ...row, ielts_reading_passages: passages as unknown as PassageRow[] });

  return {
    ...summary,
    passageCount: passages.length,
    questionCount: flattenQuestions(passages).length,
    passages,
  };
}

export async function fetchRecentIeltsReadingAttempts(userId: string): Promise<IeltsReadingAttemptSummary[]> {
  const { data, error } = await supabase
    .from('ielts_reading_attempts')
    .select(`
      id,
      test_id,
      score,
      total_questions,
      elapsed_seconds,
      submitted_at,
      created_at,
      ielts_reading_tests (
        id,
        test_number,
        title,
        ielts_reading_books (
          id,
          book_number,
          title
        )
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) throw new Error(`ielts_reading_attempts lookup failed: ${error.message}`);

  return ((data ?? []) as AttemptRow[]).map((row) => {
    const test = asArray(row.ielts_reading_tests)[0];
    const book = asArray(test?.ielts_reading_books)[0];
    return {
      id: row.id,
      testId: row.test_id ?? test?.id ?? '',
      bookTitle: book?.title ?? 'Cambridge IELTS',
      bookNumber: book?.book_number ?? 0,
      testNumber: test?.test_number ?? 0,
      score: row.score ?? 0,
      totalQuestions: row.total_questions ?? 40,
      elapsedSeconds: row.elapsed_seconds ?? 0,
      submittedAt: row.submitted_at ?? row.created_at ?? '',
    };
  });
}

export async function submitIeltsReadingAttempt({
  userId,
  test,
  answers,
  startedAt,
  elapsedSeconds,
}: {
  userId: string;
  test: IeltsReadingTestDetail;
  answers: IeltsReadingAnswerMap;
  startedAt: string;
  elapsedSeconds: number;
}): Promise<IeltsReadingAttemptResult> {
  const questions = flattenQuestions(test.passages);
  const evaluation = evaluateIeltsReadingAnswers(questions, answers);
  const submittedAt = new Date().toISOString();

  const { data: attempt, error: attemptError } = await supabase
    .from('ielts_reading_attempts')
    .insert({
      user_id: userId,
      test_id: test.id,
      status: 'submitted',
      started_at: startedAt,
      submitted_at: submittedAt,
      elapsed_seconds: elapsedSeconds,
      score: evaluation.score,
      total_questions: evaluation.totalQuestions,
    })
    .select('id')
    .single();

  if (attemptError || !attempt) {
    throw new Error(`ielts_reading_attempts insert failed: ${attemptError?.message ?? 'missing row'}`);
  }

  const responseRows = evaluation.responses.map((response) => ({
    attempt_id: attempt.id,
    question_id: response.questionId,
    question_number: response.questionNumber,
    response_json: normalizeIeltsAnswerValue(response.response),
    is_correct: response.isCorrect,
    correct_answer_json: normalizeIeltsAnswerValue(response.correctAnswer),
  }));

  if (responseRows.length > 0) {
    const { error: responseError } = await supabase
      .from('ielts_reading_responses')
      .insert(responseRows);

    if (responseError) {
      throw new Error(`ielts_reading_responses insert failed: ${responseError.message}`);
    }
  }

  return {
    id: attempt.id,
    testId: test.id,
    bookTitle: test.bookTitle,
    bookNumber: test.bookNumber,
    testNumber: test.testNumber,
    score: evaluation.score,
    totalQuestions: evaluation.totalQuestions,
    elapsedSeconds,
    submittedAt,
    responses: evaluation.responses as IeltsReadingResponseResult[],
  };
}

export function getIeltsReadingQuestions(test: IeltsReadingTestDetail): IeltsReadingQuestion[] {
  return flattenQuestions(test.passages);
}
