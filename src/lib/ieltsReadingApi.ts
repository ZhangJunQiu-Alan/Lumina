import type {
  IeltsReadingAttemptResult,
  IeltsReadingAttemptSummary,
  IeltsReadingBookSummary,
  IeltsReadingOption,
  IeltsReadingPassage,
  IeltsReadingPassageFigure,
  IeltsReadingQuestion,
  IeltsReadingQuestionGroup,
  IeltsReadingQuestionType,
  IeltsReadingResponseResult,
  IeltsReadingTestDetail,
  IeltsReadingTestSummary,
} from '../types';
import { supabase } from './supabase';
import { submitDurableIeltsAttempt } from './ieltsSubmission';
import { withOfflineTest } from './offlineTestCache';
import {
  evaluateIeltsReadingAnswers,
  normalizeIeltsAnswerValue,
  type IeltsReadingAnswerMap,
} from './ieltsReadingScoring';
import { normalizeIeltsPassageBody } from './ieltsReadingText';

const IELTS_READING_FIGURE_BUCKET = 'ielts-reading-figures';

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
  ielts_reading_passage_figures?: PassageFigureRow[] | PassageFigureRow | null;
  ielts_reading_question_groups?: QuestionGroupRow[] | QuestionGroupRow | null;
}

interface PassageFigureRow {
  id: string;
  passage_id?: string | null;
  figure_key: string | null;
  title: string | null;
  caption: string | null;
  image_url: string | null;
  storage_path: string | null;
  pdf_page: number | null;
  anchor_text: string | null;
  fallback_json: JsonValue;
  sort_order: number | null;
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

function coercePairTable(value: JsonValue): Pick<IeltsReadingPassageFigure['fallback'], 'headers' | 'rows'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, JsonValue>;
  const headers = Array.isArray(record.headers)
    ? record.headers.filter((item): item is string => typeof item === 'string').slice(0, 2)
    : [];
  const rows = Array.isArray(record.rows)
    ? record.rows.flatMap((row) => {
        if (!Array.isArray(row)) return [];
        const cells = row.filter((item): item is string => typeof item === 'string').slice(0, 2);
        return cells.length === 2 ? [[cells[0], cells[1]] as [string, string]] : [];
      })
    : [];

  return {
    ...(headers.length === 2 ? { headers: [headers[0], headers[1]] as [string, string] } : {}),
    ...(rows.length > 0 ? { rows } : {}),
  };
}

function mapPassageFigure(row: PassageFigureRow): IeltsReadingPassageFigure {
  return {
    id: row.id,
    figureKey: row.figure_key?.trim() ?? '',
    title: row.title?.trim() ?? '',
    caption: row.caption?.trim() ?? '',
    imageUrl: row.image_url?.trim() ?? '',
    storagePath: row.storage_path?.trim() ?? '',
    pdfPage: row.pdf_page,
    anchorText: row.anchor_text?.trim() ?? '',
    sortOrder: row.sort_order ?? 0,
    fallback: coercePairTable(row.fallback_json),
  };
}

function mapPassage(row: PassageRow): IeltsReadingPassage {
  const passageNumber = row.passage_number ?? 0;
  return {
    id: row.id,
    number: passageNumber,
    title: row.title?.trim() ?? `Reading Passage ${passageNumber}`,
    body: normalizeIeltsPassageBody(row.body ?? ''),
    wordCount: row.word_count ?? 0,
    figures: asArray(row.ielts_reading_passage_figures)
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map(mapPassageFigure),
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

async function signPassageFigureUrls(passages: IeltsReadingPassage[]): Promise<IeltsReadingPassage[]> {
  const figureEntries = passages.flatMap((passage, passageIndex) =>
    passage.figures.map((figure, figureIndex) => ({ passageIndex, figureIndex, figure })),
  );
  if (figureEntries.length === 0) return passages;

  const signedUrls = await Promise.all(
    figureEntries.map(async ({ figure }) => {
      if (!figure.storagePath) return figure.imageUrl;

      const { data, error } = await supabase.storage
        .from(IELTS_READING_FIGURE_BUCKET)
        .createSignedUrl(figure.storagePath, 6 * 60 * 60);

      if (error || !data?.signedUrl) return figure.imageUrl;
      return data.signedUrl;
    }),
  );

  return passages.map((passage, passageIndex) => ({
    ...passage,
    figures: passage.figures.map((figure, figureIndex) => {
      const entryIndex = figureEntries.findIndex(
        (entry) => entry.passageIndex === passageIndex && entry.figureIndex === figureIndex,
      );
      return {
        ...figure,
        imageUrl: entryIndex >= 0 ? signedUrls[entryIndex] : figure.imageUrl,
      };
    }),
  }));
}

function mapTestSummary(row: TestRow, fallbackBook?: BookRow): IeltsReadingTestSummary {
  const book = asArray(row.ielts_reading_books)[0] ?? fallbackBook;
  const passages = asArray(row.ielts_reading_passages);
  const nestedQuestionCount = passages.reduce(
    (count, passage) =>
      count +
      asArray(passage.ielts_reading_question_groups).reduce(
        (groupCount, group) => groupCount + asArray(group.ielts_reading_questions).length,
        0,
      ),
    0,
  );
  const directQuestionCount = Array.isArray(row.ielts_reading_questions) ? row.ielts_reading_questions.length : 0;

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
    .select(
      `
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
    `,
    )
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
  return withOfflineTest('reading', testId, () => fetchRemoteReadingTestDetail(testId));
}

async function fetchRemoteReadingTestDetail(testId: string): Promise<IeltsReadingTestDetail | null> {
  const { data, error } = await supabase
    .from('ielts_reading_tests')
    .select(
      `
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
        ielts_reading_passage_figures (
          id,
          passage_id,
          figure_key,
          title,
          caption,
          image_url,
          storage_path,
          pdf_page,
          anchor_text,
          fallback_json,
          sort_order
        ),
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
    `,
    )
    .eq('id', testId)
    .maybeSingle();

  if (error) throw new Error(`ielts_reading_tests lookup failed: ${error.message}`);
  if (!data) return null;

  const row = data as TestRow;
  const passages = await signPassageFigureUrls(
    asArray(row.ielts_reading_passages)
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map(mapPassage)
      .sort((left, right) => left.number - right.number),
  );
  const summary = mapTestSummary({ ...row, ielts_reading_passages: passages as unknown as PassageRow[] });

  return {
    ...summary,
    passageCount: passages.length,
    questionCount: flattenQuestions(passages).length,
    passages,
  };
}

export async function fetchRecentIeltsReadingAttempts(
  userId: string,
  options: { limit?: number | null } = {},
): Promise<IeltsReadingAttemptSummary[]> {
  const limit = options.limit === undefined ? 8 : options.limit;
  const query = supabase
    .from('ielts_reading_attempts')
    .select(
      `
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
    `,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const { data, error } = typeof limit === 'number' ? await query.limit(limit) : await query;

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

  const attempt = await submitDurableIeltsAttempt(userId, 'reading', {
    testId: test.id,
    startedAt,
    submittedAt,
    elapsedSeconds,
    score: evaluation.score,
    totalQuestions: evaluation.totalQuestions,
    responses: evaluation.responses.map((result) => ({
      questionId: result.questionId,
      questionNumber: result.questionNumber,
      response: normalizeIeltsAnswerValue(result.response),
      correctAnswer: normalizeIeltsAnswerValue(result.correctAnswer),
      isCorrect: result.isCorrect,
    })),
  });

  return {
    id: attempt.id,
    testId: test.id,
    bookTitle: test.bookTitle,
    bookNumber: test.bookNumber,
    testNumber: test.testNumber,
    score: evaluation.score,
    totalQuestions: evaluation.totalQuestions,
    elapsedSeconds: attempt.elapsedSeconds,
    submittedAt: attempt.submittedAt ?? submittedAt,
    responses: evaluation.responses as IeltsReadingResponseResult[],
  };
}

export function getIeltsReadingQuestions(test: IeltsReadingTestDetail): IeltsReadingQuestion[] {
  return flattenQuestions(test.passages);
}
