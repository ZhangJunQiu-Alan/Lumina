import { supabaseAdmin } from './supabase.ts';

const IELTS_READING_FIGURE_BUCKET = 'ielts-reading-figures';

interface BookRow {
  id: string;
  book_number: number | null;
  title: string | null;
  source_label: string | null;
  tests: TestRow[] | null;
}

interface TestRow {
  id: string;
  book_id: string | null;
  test_number: number | null;
  title: string | null;
  parts: Array<{ id: string }> | null;
  questions: Array<{ id: string }> | null;
}

interface AttemptRow {
  id: string;
  test_id: string | null;
  score: number | null;
  total_questions: number | null;
  elapsed_seconds: number | null;
  submitted_at: string | null;
  created_at: string | null;
  test: {
    id: string;
    test_number: number | null;
    book: { book_number: number | null; title: string | null } | null;
  } | null;
}

export interface IeltsDashboardTestPayload {
  id: string;
  bookId: string;
  bookNumber: number;
  bookTitle: string;
  testNumber: number;
  title: string;
  partCount: number;
  questionCount: number;
}

export interface IeltsDashboardBookPayload {
  id: string;
  bookNumber: number;
  title: string;
  sourceLabel: string;
  tests: IeltsDashboardTestPayload[];
}

export interface IeltsDashboardAttemptPayload {
  id: string;
  testId: string;
  bookTitle: string;
  bookNumber: number;
  testNumber: number;
  score: number;
  totalQuestions: number;
  elapsedSeconds: number;
  submittedAt: string;
}

export interface IeltsDashboardPayload {
  readingBooks: IeltsDashboardBookPayload[];
  listeningBooks: IeltsDashboardBookPayload[];
  readingAttempts: IeltsDashboardAttemptPayload[];
  listeningAttempts: IeltsDashboardAttemptPayload[];
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface ReadingDetailRow {
  id: string;
  book_id: string | null;
  test_number: number | null;
  title: string | null;
  book: { id: string; book_number: number | null; title: string | null } | null;
  passages: ReadingPassageRow[] | null;
}

interface ListeningDetailRow {
  id: string;
  book_id: string | null;
  test_number: number | null;
  title: string | null;
  book: { id: string; book_number: number | null; title: string | null } | null;
  sections: ListeningSectionRow[] | null;
}

interface ListeningSectionRow {
  id: string;
  section_number: number | null;
  title: string | null;
  instructions: string | null;
  audio_url: string | null;
  audio_storage_path: string | null;
  source_audio_filename: string | null;
  paper_pages_json: JsonValue;
  sort_order: number | null;
  groups: ListeningGroupRow[] | null;
}

interface ListeningGroupRow {
  id: string;
  question_type: string | null;
  prompt: string | null;
  instructions: string | null;
  options_json: JsonValue;
  question_range_start: number | null;
  question_range_end: number | null;
  sort_order: number | null;
  questions: ListeningQuestionRow[] | null;
}

interface ListeningQuestionRow {
  id: string;
  test_id: string | null;
  section_id: string | null;
  question_number: number | null;
  prompt: string | null;
  options_json: JsonValue;
  answer_json: JsonValue;
  answer_note: string | null;
  paper_hotspot_json: JsonValue;
  sort_order: number | null;
}

interface ReadingPassageRow {
  id: string;
  passage_number: number | null;
  title: string | null;
  body: string | null;
  word_count: number | null;
  sort_order: number | null;
  figures: ReadingFigureRow[] | null;
  groups: ReadingGroupRow[] | null;
}

interface ReadingFigureRow {
  id: string;
  figure_key: string | null;
  title: string | null;
  caption: string | null;
  image_url: string | null;
  storage_path: string | null;
  pdf_page: number | null;
  anchor_text: string | null;
  sort_order: number | null;
}

interface ReadingGroupRow {
  id: string;
  question_type: string | null;
  prompt: string | null;
  instructions: string | null;
  options_json: JsonValue;
  question_range_start: number | null;
  question_range_end: number | null;
  sort_order: number | null;
  questions: ReadingQuestionRow[] | null;
}

interface ReadingQuestionRow {
  id: string;
  test_id: string | null;
  question_number: number | null;
  prompt: string | null;
  options_json: JsonValue;
  answer_json: JsonValue;
  answer_note: string | null;
  sort_order: number | null;
}

function coerceOptions(value: JsonValue): Array<{ key: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === 'string') return [{ key: String.fromCharCode(65 + index), text: item }];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, JsonValue>;
    const key = typeof record.key === 'string' ? record.key : String.fromCharCode(65 + index);
    const text = typeof record.text === 'string' ? record.text : '';
    return key && text ? [{ key, text }] : [];
  });
}

function coerceAnswers(value: JsonValue): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === 'string' || typeof item === 'number' ? [String(item)] : []));
  }
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (value && typeof value === 'object') {
    return coerceAnswers((value as Record<string, JsonValue>).answers ?? []);
  }
  return [];
}

function coercePaperPages(value: JsonValue) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
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

function coercePaperHotspot(value: JsonValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, JsonValue>;
  if (typeof record.pageKey !== 'string') return null;
  return {
    pageKey: record.pageKey,
    pdfPage: typeof record.pdfPage === 'number' ? record.pdfPage : 0,
    x: typeof record.x === 'number' ? record.x : 0,
    y: typeof record.y === 'number' ? record.y : 0,
    width: typeof record.width === 'number' ? record.width : 0,
    height: typeof record.height === 'number' ? record.height : 0,
    inputKind: record.inputKind === 'choice' ? 'choice' : 'text',
    source: typeof record.source === 'string' ? record.source : undefined,
  };
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return value ?? [];
}

function mapBooks(rows: BookRow[], fallbackPartCount: number): IeltsDashboardBookPayload[] {
  return rows.map((book) => ({
    id: book.id,
    bookNumber: book.book_number ?? 0,
    title: book.title?.trim() ?? `Cambridge IELTS ${book.book_number ?? ''}`.trim(),
    sourceLabel: book.source_label?.trim() ?? '',
    tests: asArray(book.tests)
      .map((test) => ({
        id: test.id,
        bookId: test.book_id ?? book.id,
        bookNumber: book.book_number ?? 0,
        bookTitle: book.title?.trim() ?? 'Cambridge IELTS',
        testNumber: test.test_number ?? 0,
        title: test.title?.trim() ?? `Test ${test.test_number ?? ''}`.trim(),
        partCount: asArray(test.parts).length,
        questionCount: asArray(test.questions).length || (asArray(test.parts).length > 0 ? fallbackPartCount : 0),
      }))
      .sort((left, right) => left.testNumber - right.testNumber),
  }));
}

function mapAttempts(rows: AttemptRow[]): IeltsDashboardAttemptPayload[] {
  return rows.map((row) => ({
    id: row.id,
    testId: row.test_id ?? row.test?.id ?? '',
    bookTitle: row.test?.book?.title ?? 'Cambridge IELTS',
    bookNumber: row.test?.book?.book_number ?? 0,
    testNumber: row.test?.test_number ?? 0,
    score: row.score ?? 0,
    totalQuestions: row.total_questions ?? 40,
    elapsedSeconds: row.elapsed_seconds ?? 0,
    submittedAt: row.submitted_at ?? row.created_at ?? '',
  }));
}

export async function getIeltsDashboard(userId: string): Promise<IeltsDashboardPayload> {
  const [readingBooksResult, listeningBooksResult, readingAttemptsResult, listeningAttemptsResult] = await Promise.all([
    supabaseAdmin
      .from('ielts_reading_books')
      .select(
        `
        id,
        book_number,
        title,
        source_label,
        tests:ielts_reading_tests (
          id,
          book_id,
          test_number,
          title,
          parts:ielts_reading_passages ( id ),
          questions:ielts_reading_questions ( id )
        )
      `,
      )
      .order('book_number', { ascending: true }),
    supabaseAdmin
      .from('ielts_listening_books')
      .select(
        `
        id,
        book_number,
        title,
        source_label,
        tests:ielts_listening_tests (
          id,
          book_id,
          test_number,
          title,
          parts:ielts_listening_sections ( id ),
          questions:ielts_listening_questions ( id )
        )
      `,
      )
      .order('book_number', { ascending: true }),
    supabaseAdmin
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
        test:ielts_reading_tests (
          id,
          test_number,
          book:ielts_reading_books ( book_number, title )
        )
      `,
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
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
        test:ielts_listening_tests (
          id,
          test_number,
          book:ielts_listening_books ( book_number, title )
        )
      `,
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  if (readingBooksResult.error) {
    throw new Error(`ielts_reading_books lookup failed: ${readingBooksResult.error.message}`);
  }
  if (listeningBooksResult.error) {
    throw new Error(`ielts_listening_books lookup failed: ${listeningBooksResult.error.message}`);
  }
  if (readingAttemptsResult.error) {
    throw new Error(`ielts_reading_attempts lookup failed: ${readingAttemptsResult.error.message}`);
  }
  if (listeningAttemptsResult.error) {
    throw new Error(`ielts_listening_attempts lookup failed: ${listeningAttemptsResult.error.message}`);
  }

  return {
    readingBooks: mapBooks((readingBooksResult.data ?? []) as unknown as BookRow[], 40),
    listeningBooks: mapBooks((listeningBooksResult.data ?? []) as unknown as BookRow[], 40),
    readingAttempts: mapAttempts((readingAttemptsResult.data ?? []) as unknown as AttemptRow[]),
    listeningAttempts: mapAttempts((listeningAttemptsResult.data ?? []) as unknown as AttemptRow[]),
  };
}

export async function getIeltsReadingTest(testId: string) {
  const { data, error } = await supabaseAdmin
    .from('ielts_reading_tests')
    .select(
      `
      id,
      book_id,
      test_number,
      title,
      book:ielts_reading_books ( id, book_number, title ),
      passages:ielts_reading_passages (
        id,
        passage_number,
        title,
        body,
        word_count,
        sort_order,
        figures:ielts_reading_passage_figures (
          id,
          figure_key,
          title,
          caption,
          image_url,
          storage_path,
          pdf_page,
          anchor_text,
          sort_order
        ),
        groups:ielts_reading_question_groups (
          id,
          question_type,
          prompt,
          instructions,
          options_json,
          question_range_start,
          question_range_end,
          sort_order,
          questions:ielts_reading_questions (
            id,
            test_id,
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

  const row = data as unknown as ReadingDetailRow;
  const passages = asArray(row.passages)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((passage) => ({
      id: passage.id,
      number: passage.passage_number ?? 0,
      title: passage.title?.trim() ?? '',
      body: passage.body?.trim() ?? '',
      wordCount: passage.word_count ?? 0,
      figures: asArray(passage.figures)
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
        .map((figure) => ({
          id: figure.id,
          figureKey: figure.figure_key?.trim() ?? '',
          title: figure.title?.trim() ?? '',
          caption: figure.caption?.trim() ?? '',
          imageUrl: figure.image_url?.trim() ?? '',
          storagePath: figure.storage_path?.trim() ?? '',
          pdfPage: figure.pdf_page,
          anchorText: figure.anchor_text?.trim() ?? '',
          sortOrder: figure.sort_order ?? 0,
        })),
      groups: asArray(passage.groups)
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
        .map((group) => ({
          id: group.id,
          type: group.question_type ?? 'other',
          prompt: group.prompt?.trim() ?? '',
          instructions: group.instructions?.trim() ?? '',
          options: coerceOptions(group.options_json),
          rangeStart: group.question_range_start,
          rangeEnd: group.question_range_end,
          questions: asArray(group.questions)
            .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
            .map((question) => ({
              id: question.id,
              testId: question.test_id ?? testId,
              groupId: group.id,
              number: question.question_number ?? 0,
              prompt: question.prompt?.trim() ?? '',
              options: coerceOptions(question.options_json),
              answer: coerceAnswers(question.answer_json),
              answerNote: question.answer_note?.trim() ?? '',
              type: group.question_type ?? 'other',
              passageNumber: passage.passage_number ?? 0,
            }))
            .sort((left, right) => left.number - right.number),
        })),
    }));

  const figures = passages.flatMap((passage) => passage.figures);
  const storageFigures = figures.filter((figure) => figure.storagePath);
  if (storageFigures.length > 0) {
    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from(IELTS_READING_FIGURE_BUCKET)
      .createSignedUrls(
        storageFigures.map((figure) => figure.storagePath),
        60 * 60,
      );
    if (signedError) throw new Error(`ielts reading figure signing failed: ${signedError.message}`);
    storageFigures.forEach((figure, index) => {
      figure.imageUrl = signedData[index]?.signedUrl ?? figure.imageUrl;
    });
  }

  return {
    id: row.id,
    bookId: row.book_id ?? row.book?.id ?? '',
    bookNumber: row.book?.book_number ?? 0,
    bookTitle: row.book?.title ?? 'Cambridge IELTS',
    testNumber: row.test_number ?? 0,
    title: row.title?.trim() ?? `Test ${row.test_number ?? ''}`.trim(),
    passageCount: passages.length,
    questionCount: passages.reduce(
      (count, passage) => count + passage.groups.reduce((sum, group) => sum + group.questions.length, 0),
      0,
    ),
    passages,
  };
}

export async function getIeltsListeningTest(testId: string) {
  const { data, error } = await supabaseAdmin
    .from('ielts_listening_tests')
    .select(
      `
      id,
      book_id,
      test_number,
      title,
      book:ielts_listening_books ( id, book_number, title ),
      sections:ielts_listening_sections (
        id,
        section_number,
        title,
        instructions,
        audio_url,
        audio_storage_path,
        source_audio_filename,
        paper_pages_json,
        sort_order,
        groups:ielts_listening_question_groups (
          id,
          question_type,
          prompt,
          instructions,
          options_json,
          question_range_start,
          question_range_end,
          sort_order,
          questions:ielts_listening_questions (
            id,
            test_id,
            section_id,
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

  const row = data as unknown as ListeningDetailRow;
  const sections = asArray(row.sections)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((section) => ({
      id: section.id,
      number: section.section_number ?? 0,
      title: section.title?.trim() ?? '',
      instructions: section.instructions?.trim() ?? '',
      audioUrl: section.audio_url?.trim() ?? '',
      audioStoragePath: section.audio_storage_path?.trim() ?? '',
      sourceAudioFilename: section.source_audio_filename?.trim() ?? '',
      paperPages: coercePaperPages(section.paper_pages_json),
      groups: asArray(section.groups)
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
        .map((group) => ({
          id: group.id,
          type: group.question_type ?? 'other',
          prompt: group.prompt?.trim() ?? '',
          instructions: group.instructions?.trim() ?? '',
          options: coerceOptions(group.options_json),
          rangeStart: group.question_range_start,
          rangeEnd: group.question_range_end,
          questions: asArray(group.questions)
            .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
            .map((question) => ({
              id: question.id,
              testId: question.test_id ?? testId,
              sectionId: question.section_id ?? section.id,
              groupId: group.id,
              number: question.question_number ?? 0,
              prompt: question.prompt?.trim() ?? '',
              options: coerceOptions(question.options_json),
              answer: coerceAnswers(question.answer_json),
              answerNote: question.answer_note?.trim() ?? '',
              type: group.question_type ?? 'other',
              sectionNumber: section.section_number ?? 0,
              paperHotspot: coercePaperHotspot(question.paper_hotspot_json),
            }))
            .sort((left, right) => left.number - right.number),
        })),
    }));

  return {
    id: row.id,
    bookId: row.book_id ?? row.book?.id ?? '',
    bookNumber: row.book?.book_number ?? 0,
    bookTitle: row.book?.title ?? 'Cambridge IELTS',
    testNumber: row.test_number ?? 0,
    title: row.title?.trim() ?? `Test ${row.test_number ?? ''}`.trim(),
    sectionCount: sections.length,
    questionCount: sections.reduce(
      (count, section) => count + section.groups.reduce((sum, group) => sum + group.questions.length, 0),
      0,
    ),
    sections,
  };
}
