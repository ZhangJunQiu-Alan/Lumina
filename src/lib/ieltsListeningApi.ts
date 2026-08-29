import type {
  IeltsListeningAttemptResult,
  IeltsListeningAttemptSummary,
  IeltsListeningBookSummary,
  IeltsListeningOption,
  IeltsListeningPaperHotspot,
  IeltsListeningPaperPage,
  IeltsListeningQuestion,
  IeltsListeningQuestionGroup,
  IeltsListeningQuestionType,
  IeltsListeningResponseResult,
  IeltsListeningSection,
  IeltsListeningTestDetail,
  IeltsListeningTestSummary,
} from '../types';
import { supabase } from './supabase';
import { submitDurableIeltsAttempt } from './ieltsSubmission';
import { withOfflineTest } from './offlineTestCache';
import {
  evaluateIeltsListeningAnswers,
  normalizeIeltsAnswerValue,
  type IeltsListeningAnswerMap,
} from './ieltsListeningScoring';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface BookRow {
  id: string;
  book_number: number | null;
  title: string | null;
  source_label: string | null;
  ielts_listening_tests?: TestRow[] | TestRow | null;
}

interface TestRow {
  id: string;
  book_id?: string | null;
  test_number: number | null;
  title: string | null;
  ielts_listening_books?: BookRow | BookRow[] | null;
  ielts_listening_sections?: SectionRow[] | SectionRow | null;
  ielts_listening_questions?: { id: string }[] | null;
}

interface SectionRow {
  id: string;
  test_id?: string | null;
  section_number: number | null;
  title: string | null;
  instructions: string | null;
  audio_url: string | null;
  audio_storage_path: string | null;
  source_audio_filename: string | null;
  paper_pages_json?: JsonValue;
  sort_order: number | null;
  ielts_listening_question_groups?: QuestionGroupRow[] | QuestionGroupRow | null;
}

interface QuestionGroupRow {
  id: string;
  section_id?: string | null;
  question_type: IeltsListeningQuestionType | null;
  prompt: string | null;
  instructions: string | null;
  options_json: JsonValue;
  question_range_start: number | null;
  question_range_end: number | null;
  sort_order: number | null;
  ielts_listening_questions?: QuestionRow[] | QuestionRow | null;
}

interface QuestionRow {
  id: string;
  test_id: string | null;
  section_id: string | null;
  group_id: string | null;
  question_number: number | null;
  prompt: string | null;
  options_json: JsonValue;
  answer_json: JsonValue;
  answer_note: string | null;
  paper_hotspot_json?: JsonValue;
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
  ielts_listening_tests?: TestRow | TestRow[] | null;
  ielts_listening_responses?: ResponseRow[] | ResponseRow | null;
}

interface ResponseRow {
  question_id: string | null;
  question_number: number | null;
  response_json: JsonValue;
  correct_answer_json: JsonValue;
  is_correct: boolean | null;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function coerceOptions(value: JsonValue): IeltsListeningOption[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      if (typeof item === 'string') return { key: String.fromCharCode(65 + index), text: item };
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item as Record<string, JsonValue>;
        const key = typeof record.key === 'string' ? record.key : String.fromCharCode(65 + index);
        const text = typeof record.text === 'string' ? record.text : '';
        return { key, text };
      }
      return null;
    })
    .filter((option): option is IeltsListeningOption => Boolean(option && option.key && option.text));
}

function coerceAnswers(value: JsonValue): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === 'string' || typeof item === 'number' ? [String(item)] : []))
      .filter(Boolean);
  }
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (value && typeof value === 'object') {
    const record = value as Record<string, JsonValue>;
    return coerceAnswers(record.answers ?? []);
  }
  return [];
}

function coercePaperPages(value: JsonValue | undefined): IeltsListeningPaperPage[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item): IeltsListeningPaperPage[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, JsonValue>;
      if (typeof record.pageKey !== 'string' || typeof record.imageUrl !== 'string') return [];
      return [
        {
          pageKey: record.pageKey,
          pdfPage: typeof record.pdfPage === 'number' ? record.pdfPage : 0,
          width: typeof record.width === 'number' ? record.width : 0,
          height: typeof record.height === 'number' ? record.height : 0,
          storagePath: typeof record.storagePath === 'string' ? record.storagePath : '',
          imageUrl: record.imageUrl,
          sortOrder: typeof record.sortOrder === 'number' ? record.sortOrder : 0,
        },
      ];
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function coercePaperHotspot(value: JsonValue | undefined): IeltsListeningPaperHotspot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, JsonValue>;
  if (typeof record.pageKey !== 'string') return null;
  const inputKind = record.inputKind === 'choice' ? 'choice' : 'text';
  return {
    pageKey: record.pageKey,
    pdfPage: typeof record.pdfPage === 'number' ? record.pdfPage : 0,
    x: typeof record.x === 'number' ? record.x : 0,
    y: typeof record.y === 'number' ? record.y : 0,
    width: typeof record.width === 'number' ? record.width : 0,
    height: typeof record.height === 'number' ? record.height : 0,
    inputKind,
    source: typeof record.source === 'string' ? record.source : undefined,
  };
}

function mapQuestion(
  row: QuestionRow,
  group: Pick<IeltsListeningQuestionGroup, 'id' | 'type'>,
  sectionNumber: number,
): IeltsListeningQuestion {
  return {
    id: row.id,
    testId: row.test_id ?? '',
    sectionId: row.section_id ?? '',
    groupId: group.id,
    number: row.question_number ?? 0,
    prompt: row.prompt?.trim() ?? '',
    options: coerceOptions(row.options_json),
    answer: coerceAnswers(row.answer_json),
    answerNote: row.answer_note?.trim() ?? '',
    type: group.type,
    sectionNumber,
    paperHotspot: coercePaperHotspot(row.paper_hotspot_json),
  };
}

function mapQuestionGroup(row: QuestionGroupRow, sectionNumber: number): IeltsListeningQuestionGroup {
  const group: IeltsListeningQuestionGroup = {
    id: row.id,
    type: row.question_type ?? 'other',
    prompt: row.prompt?.trim() ?? '',
    instructions: row.instructions?.trim() ?? '',
    options: coerceOptions(row.options_json),
    rangeStart: row.question_range_start,
    rangeEnd: row.question_range_end,
    questions: [],
  };

  group.questions = asArray(row.ielts_listening_questions)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((question) => mapQuestion(question, group, sectionNumber))
    .sort((left, right) => left.number - right.number);

  return group;
}

function mapSection(row: SectionRow): IeltsListeningSection {
  const sectionNumber = row.section_number ?? 0;
  return {
    id: row.id,
    number: sectionNumber,
    title: row.title?.trim() ?? `Section ${sectionNumber}`,
    instructions: row.instructions?.trim() ?? '',
    audioUrl: row.audio_url?.trim() ?? '',
    audioStoragePath: row.audio_storage_path?.trim() ?? '',
    sourceAudioFilename: row.source_audio_filename?.trim() ?? '',
    paperPages: coercePaperPages(row.paper_pages_json),
    groups: asArray(row.ielts_listening_question_groups)
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((group) => mapQuestionGroup(group, sectionNumber)),
  };
}

function flattenQuestions(sections: IeltsListeningSection[]): IeltsListeningQuestion[] {
  return sections
    .flatMap((section) => section.groups.flatMap((group) => group.questions))
    .sort((left, right) => left.number - right.number);
}

function mapTestSummary(row: TestRow, fallbackBook?: BookRow): IeltsListeningTestSummary {
  const book = asArray(row.ielts_listening_books)[0] ?? fallbackBook;
  const sections = asArray(row.ielts_listening_sections);
  const nestedQuestionCount = sections.reduce(
    (count, section) =>
      count +
      asArray(section.ielts_listening_question_groups).reduce(
        (groupCount, group) => groupCount + asArray(group.ielts_listening_questions).length,
        0,
      ),
    0,
  );
  const directQuestionCount = Array.isArray(row.ielts_listening_questions) ? row.ielts_listening_questions.length : 0;

  return {
    id: row.id,
    bookId: row.book_id ?? book?.id ?? '',
    bookNumber: book?.book_number ?? 0,
    bookTitle: book?.title ?? 'Cambridge IELTS',
    testNumber: row.test_number ?? 0,
    title: row.title?.trim() ?? `Test ${row.test_number ?? ''}`.trim(),
    sectionCount: sections.length,
    questionCount: nestedQuestionCount || directQuestionCount || (sections.length > 0 ? sections.length * 10 : 0),
  };
}

export async function fetchIeltsListeningBooks(): Promise<IeltsListeningBookSummary[]> {
  const { data, error } = await supabase
    .from('ielts_listening_books')
    .select(
      `
      id,
      book_number,
      title,
      source_label,
      ielts_listening_tests (
        id,
        book_id,
        test_number,
        title,
        ielts_listening_sections ( id )
      )
    `,
    )
    .order('book_number', { ascending: true });

  if (error) throw new Error(`ielts_listening_books lookup failed: ${error.message}`);

  return ((data ?? []) as BookRow[]).map((book) => ({
    id: book.id,
    bookNumber: book.book_number ?? 0,
    title: book.title?.trim() ?? `Cambridge IELTS ${book.book_number ?? ''}`.trim(),
    sourceLabel: book.source_label?.trim() ?? '',
    tests: asArray(book.ielts_listening_tests)
      .map((test) => mapTestSummary(test, book))
      .sort((left, right) => left.testNumber - right.testNumber),
  }));
}

export async function fetchIeltsListeningTestDetail(testId: string): Promise<IeltsListeningTestDetail | null> {
  return withOfflineTest('listening', testId, () => fetchRemoteListeningTestDetail(testId));
}

async function fetchRemoteListeningTestDetail(testId: string): Promise<IeltsListeningTestDetail | null> {
  const { data, error } = await supabase
    .from('ielts_listening_tests')
    .select(
      `
      id,
      book_id,
      test_number,
      title,
      ielts_listening_books (
        id,
        book_number,
        title,
        source_label
      ),
      ielts_listening_sections (
        id,
        test_id,
        section_number,
        title,
        instructions,
        audio_url,
        audio_storage_path,
        source_audio_filename,
        paper_pages_json,
        sort_order,
        ielts_listening_question_groups (
          id,
          section_id,
          question_type,
          prompt,
          instructions,
          options_json,
          question_range_start,
          question_range_end,
          sort_order,
          ielts_listening_questions (
            id,
            test_id,
            section_id,
            group_id,
            question_number,
            prompt,
            options_json,
            answer_json,
            answer_note,
            paper_hotspot_json,
            sort_order
          )
        )
      )
    `,
    )
    .eq('id', testId)
    .maybeSingle();

  if (error) throw new Error(`ielts_listening_tests lookup failed: ${error.message}`);
  if (!data) return null;

  const row = data as TestRow;
  const sections = asArray(row.ielts_listening_sections)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map(mapSection)
    .sort((left, right) => left.number - right.number);
  const summary = mapTestSummary({ ...row, ielts_listening_sections: sections as unknown as SectionRow[] });

  return {
    ...summary,
    sectionCount: sections.length,
    questionCount: flattenQuestions(sections).length,
    sections,
  };
}

export async function fetchRecentIeltsListeningAttempts(
  userId: string,
  options: { limit?: number | null } = {},
): Promise<IeltsListeningAttemptSummary[]> {
  const limit = options.limit === undefined ? 8 : options.limit;
  const query = supabase
    .from('ielts_listening_attempts')
    .select(
      `
      id,
      test_id,
      score,
      total_questions,
      elapsed_seconds,
      submitted_at,
      created_at,
      ielts_listening_tests (
        id,
        test_number,
        title,
        ielts_listening_books (
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

  if (error) throw new Error(`ielts_listening_attempts lookup failed: ${error.message}`);

  return ((data ?? []) as AttemptRow[]).map((row) => {
    const test = asArray(row.ielts_listening_tests)[0];
    const book = asArray(test?.ielts_listening_books)[0];
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

export async function fetchIeltsListeningAttemptResult(
  userId: string,
  attemptId: string,
): Promise<IeltsListeningAttemptResult | null> {
  const { data, error } = await supabase
    .from('ielts_listening_attempts')
    .select(
      `
      id,
      test_id,
      score,
      total_questions,
      elapsed_seconds,
      submitted_at,
      created_at,
      ielts_listening_tests (
        id,
        test_number,
        title,
        ielts_listening_books (
          id,
          book_number,
          title
        )
      ),
      ielts_listening_responses (
        question_id,
        question_number,
        response_json,
        correct_answer_json,
        is_correct
      )
    `,
    )
    .eq('id', attemptId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`ielts_listening_attempt lookup failed: ${error.message}`);
  if (!data) return null;

  const row = data as AttemptRow;
  const test = asArray(row.ielts_listening_tests)[0];
  const book = asArray(test?.ielts_listening_books)[0];
  const responses = asArray(row.ielts_listening_responses)
    .map(
      (response): IeltsListeningResponseResult => ({
        questionId: response.question_id ?? '',
        questionNumber: response.question_number ?? 0,
        response: coerceAnswers(response.response_json),
        correctAnswer: coerceAnswers(response.correct_answer_json),
        isCorrect: Boolean(response.is_correct),
      }),
    )
    .sort((left, right) => left.questionNumber - right.questionNumber);

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
    responses,
  };
}

export async function submitIeltsListeningAttempt({
  userId,
  test,
  answers,
  startedAt,
  elapsedSeconds,
}: {
  userId: string;
  test: IeltsListeningTestDetail;
  answers: IeltsListeningAnswerMap;
  startedAt: string;
  elapsedSeconds: number;
}): Promise<IeltsListeningAttemptResult> {
  const questions = flattenQuestions(test.sections);
  const evaluation = evaluateIeltsListeningAnswers(questions, answers);
  const submittedAt = new Date().toISOString();

  const attempt = await submitDurableIeltsAttempt(userId, 'listening', {
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
    responses: evaluation.responses as IeltsListeningResponseResult[],
  };
}

export function getIeltsListeningQuestions(test: IeltsListeningTestDetail): IeltsListeningQuestion[] {
  return flattenQuestions(test.sections);
}
