import { supabaseAdmin } from '../server/supabase.ts';
import { normalizeIeltsPassageBody } from '../src/lib/ieltsReadingText.ts';

type Option = { key: string; text: string };
type GroupRow = {
  id: string;
  question_type: string;
  prompt: string | null;
  instructions: string | null;
  options_json: Option[] | null;
  question_range_start: number | null;
  question_range_end: number | null;
};
type QuestionRow = {
  id: string;
  question_number: number;
  prompt: string | null;
  answer_json: string[] | null;
};

const shouldApply = process.argv.includes('--apply');

const WORD_RE = /[\p{Script=Latin}]+(?:[-'][\p{Script=Latin}]+)?/gu;

const q1To8Answers = new Map<number, string[]>([
  [1, ['FALSE']],
  [2, ['FALSE']],
  [3, ['TRUE']],
  [4, ['TRUE']],
  [5, ['FALSE']],
  [6, ['NOT GIVEN']],
  [7, ['TRUE']],
  [8, ['NOT GIVEN']],
]);

const q9To13Answers = new Map<number, string[]>([
  [9, ['M']],
  [10, ['E']],
  [11, ['G']],
  [12, ['P']],
  [13, ['J']],
]);

const q9To13Prompts = new Map<number, string>([
  [9, "What was the children's most frequent response when asked where the rainforests were?"],
  [10, 'What was the most common response to the question about the importance of the rainforests?'],
  [11, 'What did most children give as the reason for the loss of the rainforests?'],
  [12, 'Why did most children think it important for the rainforests to be protected?'],
  [13, 'Which of the responses is cited as unexpectedly uncommon, given the amount of time spent on the issue by the newspapers and television?'],
]);

const q9To13Options: Option[] = [
  { key: 'A', text: 'There is a complicated combination of reasons for the loss of the rainforests.' },
  { key: 'B', text: 'The rainforests are being destroyed by the same things that are destroying the forests of Western Europe.' },
  { key: 'C', text: 'Rainforests are located near the Equator.' },
  { key: 'D', text: 'Brazil is home to the rainforests.' },
  { key: 'E', text: 'Without rainforests some animals would have nowhere to live.' },
  { key: 'F', text: 'Rainforests are important habitats for a lot of plants.' },
  { key: 'G', text: 'People are responsible for the loss of the rainforests.' },
  { key: 'H', text: 'The rainforests are a source of oxygen.' },
  { key: 'I', text: 'Rainforests are of consequence for a number of different reasons.' },
  { key: 'J', text: 'As the rainforests are destroyed, the world gets warmer.' },
  { key: 'K', text: 'Without rainforests there would not be enough oxygen in the air.' },
  { key: 'L', text: 'There are people for whom the rainforests are home.' },
  { key: 'M', text: 'Rainforests are found in Africa.' },
  { key: 'N', text: 'Rainforests are not really important to human life.' },
  { key: 'O', text: 'The destruction of the rainforests is the direct result of logging activity.' },
  { key: 'P', text: 'Humans depend on the rainforests for their continuing existence.' },
];

function countWords(body: string): number {
  return [...body.matchAll(WORD_RE)].length;
}

function assertFound<T>(value: T | null | undefined, label: string): T {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function assertNoError(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

function findGroup(groups: GroupRow[], start: number, end: number) {
  return assertFound(
    groups.find((group) => group.question_range_start === start && group.question_range_end === end),
    `question group ${start}-${end}`,
  );
}

function findQuestion(questions: QuestionRow[], questionNumber: number) {
  return assertFound(
    questions.find((question) => question.question_number === questionNumber),
    `question ${questionNumber}`,
  );
}

async function getTargetRows() {
  const bookResult = await supabaseAdmin
    .from('ielts_reading_books')
    .select('id, book_number, title')
    .eq('book_number', 4)
    .single();
  assertNoError(bookResult.error, 'ielts_reading_books lookup failed');
  const book = assertFound(bookResult.data, 'Cambridge 4 book');

  const testResult = await supabaseAdmin
    .from('ielts_reading_tests')
    .select('id, test_number, title')
    .eq('book_id', book.id)
    .eq('test_number', 1)
    .single();
  assertNoError(testResult.error, 'ielts_reading_tests lookup failed');
  const test = assertFound(testResult.data, 'Cambridge 4 Test 1');

  const passageResult = await supabaseAdmin
    .from('ielts_reading_passages')
    .select('id, passage_number, title, body')
    .eq('test_id', test.id)
    .eq('passage_number', 1)
    .single();
  assertNoError(passageResult.error, 'ielts_reading_passages lookup failed');
  const passage = assertFound(passageResult.data, 'Cambridge 4 Test 1 Passage 1');

  const groupsResult = await supabaseAdmin
    .from('ielts_reading_question_groups')
    .select('id, question_type, prompt, instructions, options_json, question_range_start, question_range_end')
    .eq('passage_id', passage.id);
  assertNoError(groupsResult.error, 'ielts_reading_question_groups lookup failed');
  const groups = (groupsResult.data ?? []) as GroupRow[];

  const questionsResult = await supabaseAdmin
    .from('ielts_reading_questions')
    .select('id, question_number, prompt, answer_json')
    .eq('test_id', test.id)
    .gte('question_number', 1)
    .lte('question_number', 13);
  assertNoError(questionsResult.error, 'ielts_reading_questions lookup failed');
  const questions = (questionsResult.data ?? []) as QuestionRow[];

  return {
    passage,
    groups,
    questions,
    q1To8Group: findGroup(groups, 1, 8),
    q9To13Group: findGroup(groups, 9, 13),
  };
}

async function updateRow(label: string, operation: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await operation;
  assertNoError(error, label);
}

async function main() {
  const { passage, questions, q1To8Group, q9To13Group } = await getTargetRows();
  const normalizedBody = normalizeIeltsPassageBody(passage.body);
  const bodyChanged = normalizedBody !== passage.body;

  console.log(`${shouldApply ? 'Applying' : 'Dry run for'} Cambridge 4 Test 1 Passage 1 repair`);
  console.log(`passage body changed: ${bodyChanged}`);

  if (!shouldApply) {
    console.log('Use --apply to update Supabase rows in place.');
    return;
  }

  if (bodyChanged) {
    await updateRow(
      'ielts_reading_passages update failed',
      supabaseAdmin
        .from('ielts_reading_passages')
        .update({
          body: normalizedBody,
          word_count: countWords(normalizedBody),
        })
        .eq('id', passage.id),
    );
  }

  await updateRow(
    'ielts_reading_question_groups Q1-8 update failed',
    supabaseAdmin
      .from('ielts_reading_question_groups')
      .update({
        question_type: 'true_false_not_given',
        prompt: 'Questions 1-8',
        instructions: [
          'Do the following statements agree with the information given in Reading Passage 1?',
          'In boxes 1-8 on your answer sheet, write TRUE if the statement agrees with the information, FALSE if the statement contradicts the information, or NOT GIVEN if there is no information on this.',
        ].join(' '),
        options_json: [],
      })
      .eq('id', q1To8Group.id),
  );

  await updateRow(
    'ielts_reading_question_groups Q9-13 update failed',
    supabaseAdmin
      .from('ielts_reading_question_groups')
      .update({
        question_type: 'matching_features',
        prompt: 'Questions 9-13',
        instructions: [
          'The box below gives a list of responses A-P to the questionnaire discussed in Reading Passage 1.',
          'Answer the following questions by choosing the correct responses A-P.',
          'Write your answers in boxes 9-13 on your answer sheet.',
        ].join(' '),
        options_json: q9To13Options,
      })
      .eq('id', q9To13Group.id),
  );

  for (const [questionNumber, answer] of q1To8Answers) {
    const question = findQuestion(questions, questionNumber);
    await updateRow(
      `ielts_reading_questions Q${questionNumber} update failed`,
      supabaseAdmin
        .from('ielts_reading_questions')
        .update({ answer_json: answer })
        .eq('id', question.id),
    );
  }

  for (const [questionNumber, answer] of q9To13Answers) {
    const question = findQuestion(questions, questionNumber);
    await updateRow(
      `ielts_reading_questions Q${questionNumber} update failed`,
      supabaseAdmin
        .from('ielts_reading_questions')
        .update({
          prompt: q9To13Prompts.get(questionNumber),
          options_json: [],
          answer_json: answer,
          answer_note: null,
        })
        .eq('id', question.id),
    );
  }

  const repaired = await getTargetRows();
  const q9To13OptionsApplied = repaired.q9To13Group.options_json?.map((option) => option.key).join('') === 'ABCDEFGHIJKLMNOP';
  const passageClean = !/[~]econd|\br8%|\bro%/.test(repaired.passage.body);

  console.log(`passage clean: ${passageClean}`);
  console.log(`Q9-13 type: ${repaired.q9To13Group.question_type}`);
  console.log(`Q9-13 options A-P: ${q9To13OptionsApplied}`);
  console.log('Q1-13 answers:');
  for (const question of repaired.questions.sort((left, right) => left.question_number - right.question_number)) {
    console.log(`${question.question_number}: ${(question.answer_json ?? []).join(' / ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
