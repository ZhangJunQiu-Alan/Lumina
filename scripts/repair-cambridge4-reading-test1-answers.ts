import { supabaseAdmin } from '../shared/server/supabase.ts';
import type { IeltsReadingQuestionType } from '../src/types.ts';
import {
  isIeltsQuestionCorrect,
  normalizeIeltsAnswerValue,
  type IeltsReadingAnswerValue,
} from '../src/lib/ieltsReadingScoring.ts';

type Option = { key: string; text: string };
type ExpectedQuestion = {
  answer: string[];
  type: IeltsReadingQuestionType;
  prompt?: string;
};
type QuestionRow = {
  id: string;
  group_id: string | null;
  question_number: number;
  prompt: string | null;
  answer_json: string[] | null;
  answer_note: string | null;
};
type ResponseRow = {
  id: string;
  attempt_id: string;
  question_number: number;
  response_json: IeltsReadingAnswerValue;
  correct_answer_json: string[] | null;
  is_correct: boolean | null;
};

const shouldApply = process.argv.includes('--apply');

const q40Options: Option[] = [
  { key: 'A', text: 'The blind represent some aspects of reality differently from sighted people.' },
  { key: 'B', text: 'The blind comprehend visual metaphors in similar ways to sighted people.' },
  { key: 'C', text: 'The blind may create unusual and effective symbols to represent reality.' },
  { key: 'D', text: 'The blind may be successful artists if given the right training.' },
];

const expected = new Map<number, ExpectedQuestion>([
  [1, { answer: ['FALSE'], type: 'true_false_not_given' }],
  [2, { answer: ['FALSE'], type: 'true_false_not_given' }],
  [3, { answer: ['TRUE'], type: 'true_false_not_given' }],
  [4, { answer: ['TRUE'], type: 'true_false_not_given' }],
  [5, { answer: ['FALSE'], type: 'true_false_not_given' }],
  [6, { answer: ['NOT GIVEN'], type: 'true_false_not_given' }],
  [7, { answer: ['TRUE'], type: 'true_false_not_given' }],
  [8, { answer: ['NOT GIVEN'], type: 'true_false_not_given' }],
  [9, { answer: ['M'], type: 'matching_features' }],
  [10, { answer: ['E'], type: 'matching_features' }],
  [11, { answer: ['G'], type: 'matching_features' }],
  [12, { answer: ['P'], type: 'matching_features' }],
  [13, { answer: ['J'], type: 'matching_features' }],
  [14, { answer: ['B'], type: 'multiple_choice_single' }],
  [15, { answer: ['taste buds'], type: 'table_completion' }],
  [16, { answer: ['baleen', 'the baleen whales'], type: 'table_completion' }],
  [17, { answer: ['forward downward', 'downward forward'], type: 'table_completion' }],
  [18, { answer: ['freshwater dolphin(s)', 'the freshwater dolphin(s)'], type: 'table_completion' }],
  [19, { answer: ['water', 'the water'], type: 'table_completion' }],
  [20, { answer: ['lower frequencies', 'the lower frequencies'], type: 'table_completion' }],
  [21, { answer: ['bowhead humpback', 'humpback bowhead'], type: 'table_completion' }],
  [22, { answer: ['touch', 'sense of touch'], type: 'summary_completion' }],
  [23, { answer: ['freshwater dolphin(s)', 'the freshwater dolphin(s)'], type: 'summary_completion' }],
  [24, { answer: ['airborne flying fish'], type: 'summary_completion' }],
  [25, { answer: ['clear water(s)', 'clear open water(s)'], type: 'summary_completion' }],
  [26, { answer: ['acoustic sense', 'the acoustic sense'], type: 'summary_completion' }],
  [27, { answer: ['C'], type: 'matching_sentence_endings' }],
  [28, { answer: ['C'], type: 'matching_sentence_endings' }],
  [29, { answer: ['A'], type: 'matching_sentence_endings' }],
  [30, { answer: ['E'], type: 'matching_sentence_endings' }],
  [31, { answer: ['C'], type: 'matching_sentence_endings' }],
  [32, { answer: ['A'], type: 'matching_sentence_endings' }],
  [33, { answer: ['pairs'], type: 'summary_completion' }],
  [34, { answer: ['shapes'], type: 'summary_completion' }],
  [35, { answer: ['sighted'], type: 'summary_completion' }],
  [36, { answer: ['sighted'], type: 'summary_completion' }],
  [37, { answer: ['deep'], type: 'summary_completion' }],
  [38, { answer: ['blind'], type: 'summary_completion' }],
  [39, { answer: ['similar'], type: 'summary_completion' }],
  [
    40,
    {
      answer: ['B'],
      type: 'multiple_choice_single',
      prompt: "Which of the following statements best summarises the writer's general conclusion?",
    },
  ],
]);

function assertFound<T>(value: T | null | undefined, label: string): T {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function assertNoError(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

function answersEqual(left: string[] | null | undefined, right: string[]) {
  return JSON.stringify(left ?? []) === JSON.stringify(right);
}

async function updateRow(label: string, operation: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await operation;
  assertNoError(error, label);
}

async function getTargetTestId() {
  const bookResult = await supabaseAdmin
    .from('ielts_reading_books')
    .select('id, book_number')
    .eq('book_number', 4)
    .single();
  assertNoError(bookResult.error, 'ielts_reading_books lookup failed');
  const book = assertFound(bookResult.data, 'Cambridge 4 book');

  const testResult = await supabaseAdmin
    .from('ielts_reading_tests')
    .select('id, test_number')
    .eq('book_id', book.id)
    .eq('test_number', 1)
    .single();
  assertNoError(testResult.error, 'ielts_reading_tests lookup failed');
  return assertFound(testResult.data?.id, 'Cambridge 4 Test 1 id');
}

async function getQuestions(testId: string) {
  const result = await supabaseAdmin
    .from('ielts_reading_questions')
    .select('id, group_id, question_number, prompt, answer_json, answer_note')
    .eq('test_id', testId)
    .order('question_number');
  assertNoError(result.error, 'ielts_reading_questions lookup failed');
  return (result.data ?? []) as QuestionRow[];
}

async function repairQuestions(testId: string) {
  const questions = await getQuestions(testId);
  const mismatches = questions.filter((question) => {
    const entry = expected.get(question.question_number);
    return !entry || !answersEqual(question.answer_json, entry.answer) || Boolean(question.answer_note);
  });

  console.log(`question rows checked: ${questions.length}`);
  console.log(`question rows needing repair: ${mismatches.length}`);
  for (const question of mismatches) {
    const entry = expected.get(question.question_number);
    console.log(
      `Q${question.question_number}: ${JSON.stringify(question.answer_json ?? [])} -> ${JSON.stringify(entry?.answer ?? [])}; note=${JSON.stringify(question.answer_note)}`,
    );
  }

  if (!shouldApply) return questions;

  for (const question of questions) {
    const entry = assertFound(
      expected.get(question.question_number),
      `official answer for Q${question.question_number}`,
    );
    await updateRow(
      `ielts_reading_questions Q${question.question_number} update failed`,
      supabaseAdmin
        .from('ielts_reading_questions')
        .update({
          answer_json: entry.answer,
          answer_note: null,
          ...(entry.prompt ? { prompt: entry.prompt } : {}),
        })
        .eq('id', question.id),
    );
  }

  const q40 = assertFound(
    questions.find((question) => question.question_number === 40),
    'Q40',
  );
  await updateRow(
    'ielts_reading_question_groups Q40 update failed',
    supabaseAdmin
      .from('ielts_reading_question_groups')
      .update({
        question_type: 'multiple_choice_single',
        prompt: 'Question 40',
        instructions: 'Choose the correct letter, A, B, C or D. Write your answer in box 40 on your answer sheet.',
        options_json: q40Options,
        question_range_start: 40,
        question_range_end: 40,
      })
      .eq('id', q40.group_id),
  );

  return getQuestions(testId);
}

async function repairStoredResponses(testId: string) {
  const attemptsResult = await supabaseAdmin.from('ielts_reading_attempts').select('id, score').eq('test_id', testId);
  assertNoError(attemptsResult.error, 'ielts_reading_attempts lookup failed');
  const attempts = attemptsResult.data ?? [];
  if (attempts.length === 0) {
    console.log('stored attempts checked: 0');
    return;
  }

  const attemptIds = attempts.map((attempt) => attempt.id);
  const responsesResult = await supabaseAdmin
    .from('ielts_reading_responses')
    .select('id, attempt_id, question_number, response_json, correct_answer_json, is_correct')
    .in('attempt_id', attemptIds);
  assertNoError(responsesResult.error, 'ielts_reading_responses lookup failed');
  const responses = (responsesResult.data ?? []) as ResponseRow[];
  let responseUpdates = 0;
  const scores = new Map(attemptIds.map((id) => [id, 0]));

  for (const response of responses) {
    const entry = assertFound(
      expected.get(response.question_number),
      `official response answer for Q${response.question_number}`,
    );
    const expectedStoredAnswer = normalizeIeltsAnswerValue(entry.answer);
    const isCorrect = isIeltsQuestionCorrect(
      {
        type: entry.type,
        answer: entry.answer,
      },
      response.response_json,
    );
    if (isCorrect) scores.set(response.attempt_id, (scores.get(response.attempt_id) ?? 0) + 1);

    if (answersEqual(response.correct_answer_json, expectedStoredAnswer) && response.is_correct === isCorrect) continue;
    responseUpdates += 1;

    if (shouldApply) {
      await updateRow(
        `ielts_reading_responses ${response.id} update failed`,
        supabaseAdmin
          .from('ielts_reading_responses')
          .update({
            correct_answer_json: expectedStoredAnswer,
            is_correct: isCorrect,
          })
          .eq('id', response.id),
      );
    }
  }

  let attemptScoreUpdates = 0;
  for (const attempt of attempts) {
    const score = scores.get(attempt.id) ?? 0;
    if (attempt.score === score) continue;
    attemptScoreUpdates += 1;
    if (shouldApply) {
      await updateRow(
        `ielts_reading_attempts ${attempt.id} score update failed`,
        supabaseAdmin.from('ielts_reading_attempts').update({ score }).eq('id', attempt.id),
      );
    }
  }

  console.log(`stored attempts checked: ${attempts.length}`);
  console.log(`stored responses needing repair: ${responseUpdates}`);
  console.log(`attempt scores needing repair: ${attemptScoreUpdates}`);
}

async function main() {
  console.log(`${shouldApply ? 'Applying' : 'Dry run for'} Cambridge 4 Test 1 answer repair`);
  const testId = await getTargetTestId();
  const repairedQuestions = await repairQuestions(testId);
  await repairStoredResponses(testId);

  const remaining = repairedQuestions.filter((question) => {
    const entry = expected.get(question.question_number);
    return !entry || !answersEqual(question.answer_json, entry.answer) || Boolean(question.answer_note);
  });
  console.log(`remaining question mismatches: ${remaining.length}`);
  if (remaining.length > 0) {
    for (const question of remaining) {
      console.log(`Q${question.question_number}: ${JSON.stringify(question.answer_json ?? [])}`);
    }
  }
  if (!shouldApply) console.log('Use --apply to update Supabase rows in place.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
