import { supabaseAdmin } from '../shared/server/supabase.ts';
import type { IeltsReadingOption, IeltsReadingQuestion, IeltsReadingQuestionType } from '../src/types.ts';
import {
  evaluateIeltsReadingAnswers,
  normalizeIeltsAnswerValue,
  type IeltsReadingAnswerMap,
  type IeltsReadingAnswerValue,
} from '../src/lib/ieltsReadingScoring.ts';

type Option = IeltsReadingOption;
type GroupRow = {
  id: string;
  passage_id: string | null;
  question_type: IeltsReadingQuestionType | null;
  prompt: string | null;
  instructions: string | null;
  options_json: Option[] | null;
  question_range_start: number | null;
  question_range_end: number | null;
};
type QuestionRow = {
  id: string;
  group_id: string | null;
  question_number: number;
  prompt: string | null;
  options_json: Option[] | null;
  answer_json: string[] | null;
  answer_note: string | null;
};
type ExpectedQuestion = {
  answer: string[];
  type: IeltsReadingQuestionType;
  prompt: string;
  options?: Option[];
  answerNote?: string | null;
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

const paragraphOptions: Option[] = 'ABCDEFGHI'.split('').map((key) => ({ key, text: `Paragraph ${key}` }));

const q5To9Options: Option[] = [
  { key: 'A', text: 'Michael Krauss' },
  { key: 'B', text: 'Salikoko Mufwene' },
  { key: 'C', text: 'Nicholas Ostler' },
  { key: 'D', text: 'Mark Pagel' },
  { key: 'E', text: 'Doug Whalen' },
];

const q14Options: Option[] = [
  { key: 'A', text: 'They have worked closely with pharmaceutical companies.' },
  { key: 'B', text: 'They have often worked alongside other therapists.' },
  { key: 'C', text: 'They have been reluctant to accept alternative therapists.' },
  { key: 'D', text: 'They have regularly prescribed alternative remedies.' },
];

const q15Options: Option[] = [
  { key: 'A', text: 'were prescribed more herbal medicines than in previous years.' },
  { key: 'B', text: 'consulted alternative therapists more often than doctors.' },
  { key: 'C', text: 'spent more on natural therapies than orthodox medicines.' },
  { key: 'D', text: 'made more complaints about doctors than in previous years.' },
];

const q33To35Options: Option[] = [
  { key: 'A', text: 'a rehearsal for later adult activities' },
  { key: 'B', text: 'a method animals use to prove themselves to their peer group' },
  { key: 'C', text: 'an activity intended to build up strength for adulthood' },
  { key: 'D', text: 'a means of communicating feelings' },
  { key: 'E', text: 'a defensive strategy' },
  { key: 'F', text: 'an activity assisting organ growth' },
];

const q36To40Options: Option[] = [
  { key: 'A', text: 'There is a link between a specific substance in the brain and playing.' },
  { key: 'B', text: 'Play provides input concerning physical surroundings.' },
  { key: 'C', text: 'Varieties of play can be matched to different stages of evolutionary history.' },
  { key: 'D', text: 'There is a tendency for mammals with smaller brains to play less.' },
  { key: 'E', text: 'Play is not a form of fitness training for the future.' },
  { key: 'F', text: 'Some species of larger-brained birds engage in play.' },
  { key: 'G', text: 'A wide range of activities are combined during play.' },
  { key: 'H', text: 'Play is a method of teaching survival techniques.' },
];

const groupPatches = new Map<string, Partial<GroupRow>>([
  [
    '1-4',
    {
      question_type: 'summary_completion',
      prompt: 'Questions 1-4',
      instructions: [
        'Complete the summary below.',
        'Choose NO MORE THAN TWO WORDS from the passage for each answer.',
        'Write your answers in boxes 1-4 on your answer sheet.',
      ].join('\n'),
      options_json: [],
    },
  ],
  [
    '5-9',
    {
      question_type: 'matching_features',
      prompt: 'Questions 5-9',
      instructions: [
        'Look at the following statements and the list of people in the box below.',
        'Match each statement with the correct person A-E.',
        'Write the appropriate letter A-E in boxes 5-9 on your answer sheet.',
        'NB You may use any letter more than once.',
      ].join(' '),
      options_json: q5To9Options,
    },
  ],
  [
    '10-13',
    {
      question_type: 'yes_no_not_given',
      prompt: 'Questions 10-13',
      instructions: [
        'Do the following statements agree with the views of the writer in Reading Passage 1?',
        'In boxes 10-13 on your answer sheet, write YES if the statement agrees with the views of the writer, NO if the statement contradicts the views of the writer, or NOT GIVEN if it is impossible to say what the writer thinks about this.',
      ].join(' '),
      options_json: [],
    },
  ],
  [
    '14-15',
    {
      question_type: 'multiple_choice_single',
      prompt: 'Questions 14 and 15',
      instructions:
        'Choose the correct letter, A, B, C or D. Write your answers in boxes 14 and 15 on your answer sheet.',
      options_json: [],
    },
  ],
  [
    '16-23',
    {
      question_type: 'yes_no_not_given',
      prompt: 'Questions 16-23',
      instructions: [
        'Do the following statements agree with the views of the writer in Reading Passage 2?',
        'In boxes 16-23 on your answer sheet, write YES if the statement agrees with the views of the writer, NO if the statement contradicts the views of the writer, or NOT GIVEN if it is impossible to say what the writer thinks about this.',
      ].join(' '),
      options_json: [],
    },
  ],
  [
    '24-26',
    {
      question_type: 'table_completion',
      prompt: 'Questions 24-26',
      instructions: [
        'Complete the vertical axis on the table below.',
        'Choose NO MORE THAN THREE WORDS from Reading Passage 2 for each answer.',
        'Write your answers in boxes 24-26 on your answer sheet.',
        'Medical complaints of patients visiting therapists',
        'Complaint | Approximate percentage',
        'Musculo-skeletal | 24%',
        'Digestive | 13%',
        '[24] ______ | 12%',
        'Respiratory | 10%',
        'Candida | 8%',
        '[25] ______ | 6%',
        '[26] ______ | 5%',
        'General health maintenance | 4%',
      ].join('\n'),
      options_json: [],
    },
  ],
  [
    '27-32',
    {
      question_type: 'matching_information',
      prompt: 'Questions 27-32',
      instructions: [
        'Reading Passage 3 has nine paragraphs labelled A-I.',
        'Which paragraph contains the following information?',
        'Write the correct letter A-I in boxes 27-32 on your answer sheet.',
        'NB You may use any letter more than once.',
      ].join(' '),
      options_json: paragraphOptions,
    },
  ],
  [
    '33-35',
    {
      question_type: 'multiple_choice_multi',
      prompt: 'Questions 33-35',
      instructions: [
        'Choose THREE letters A-F.',
        'Write your answers in boxes 33-35 on your answer sheet.',
        'The list below gives some ways of regarding play. Which THREE ways are mentioned by the writer of the text?',
      ].join(' '),
      options_json: q33To35Options,
    },
  ],
  [
    '36-40',
    {
      question_type: 'matching_features',
      prompt: 'Questions 36-40',
      instructions: [
        'Look at the following researchers and the list of findings below.',
        'Match each researcher with the correct finding.',
        'Write the correct letter A-H in boxes 36-40 on your answer sheet.',
      ].join(' '),
      options_json: q36To40Options,
    },
  ],
]);

const expected = new Map<number, ExpectedQuestion>([
  [
    1,
    {
      type: 'summary_completion',
      prompt: 'This great variety of languages came about largely as a result of geographical ______.',
      answer: ['isolation'],
    },
  ],
  [
    2,
    {
      type: 'summary_completion',
      prompt:
        'Factors such as government initiatives and ______ are contributing to a huge decrease in the number of languages.',
      answer: ['economic globalisation', 'economic globalization', 'socio-economic pressures'],
    },
  ],
  [
    3,
    {
      type: 'summary_completion',
      prompt: "One factor which may help is people's increasing appreciation of their ______.",
      answer: ['cultural identity'],
    },
  ],
  [
    4,
    {
      type: 'summary_completion',
      prompt: 'In apprentice schemes, the endangered language is used to teach people a ______.',
      answer: ['traditional skill'],
    },
  ],
  [
    5,
    {
      type: 'matching_features',
      prompt: 'Endangered languages cannot be saved unless people learn to speak more than one language.',
      answer: ['E'],
    },
  ],
  [
    6,
    {
      type: 'matching_features',
      prompt: 'Saving languages from extinction is not in itself a satisfactory goal.',
      answer: ['B'],
    },
  ],
  [7, { type: 'matching_features', prompt: 'The way we think may be determined by our language.', answer: ['D'] }],
  [
    8,
    {
      type: 'matching_features',
      prompt: 'Young people often reject the established way of life in their community.',
      answer: ['C'],
    },
  ],
  [
    9,
    {
      type: 'matching_features',
      prompt: 'A change of language may mean a loss of traditional culture.',
      answer: ['B'],
    },
  ],
  [
    10,
    {
      type: 'yes_no_not_given',
      prompt: 'The Navajo language will die out because it currently has too few speakers.',
      answer: ['NO'],
    },
  ],
  [
    11,
    {
      type: 'yes_no_not_given',
      prompt: 'A large number of native speakers fail to guarantee the survival of a language.',
      answer: ['YES'],
    },
  ],
  [
    12,
    {
      type: 'yes_no_not_given',
      prompt: 'National governments could do more to protect endangered languages.',
      answer: ['NOT GIVEN'],
    },
  ],
  [13, { type: 'yes_no_not_given', prompt: 'The loss of linguistic diversity is inevitable.', answer: ['YES'] }],
  [
    14,
    {
      type: 'multiple_choice_single',
      prompt: 'Traditionally, how have Australian doctors differed from doctors in many Western countries?',
      options: q14Options,
      answer: ['C'],
    },
  ],
  [15, { type: 'multiple_choice_single', prompt: 'In 1990, Americans', options: q15Options, answer: ['B'] }],
  [
    16,
    {
      type: 'yes_no_not_given',
      prompt: 'Australians have been turning to alternative therapies in increasing numbers over the past 20 years.',
      answer: ['YES'],
    },
  ],
  [
    17,
    {
      type: 'yes_no_not_given',
      prompt:
        'Between 1983 and 1990 the numbers of patients visiting alternative therapists rose to include a further 8% of the population.',
      answer: ['NO'],
    },
  ],
  [
    18,
    {
      type: 'yes_no_not_given',
      prompt: 'The 1990 survey related to 550,000 consultations with alternative therapists.',
      answer: ['YES'],
    },
  ],
  [
    19,
    {
      type: 'yes_no_not_given',
      prompt: 'In the past, Australians had a higher opinion of doctors than they do today.',
      answer: ['YES'],
    },
  ],
  [
    20,
    {
      type: 'yes_no_not_given',
      prompt: 'Some Australian doctors are retraining in alternative therapies.',
      answer: ['YES'],
    },
  ],
  [
    21,
    {
      type: 'yes_no_not_given',
      prompt: 'Alternative therapists earn higher salaries than doctors.',
      answer: ['NOT GIVEN'],
    },
  ],
  [
    22,
    {
      type: 'yes_no_not_given',
      prompt:
        'The 1993 Sydney survey involved 289 patients who visited alternative therapists for acupuncture treatment.',
      answer: ['NO'],
    },
  ],
  [
    23,
    {
      type: 'yes_no_not_given',
      prompt: 'All the patients in the 1993 Sydney survey had long-term medical complaints.',
      answer: ['YES'],
    },
  ],
  [
    24,
    {
      type: 'table_completion',
      prompt: 'Medical complaint category between Digestive and Respiratory.',
      answer: ['emotional', 'emotional problems'],
    },
  ],
  [
    25,
    {
      type: 'table_completion',
      prompt: 'Medical complaint category between Candida and general ill health.',
      answer: ['headache', 'headaches'],
    },
  ],
  [
    26,
    {
      type: 'table_completion',
      prompt: 'Medical complaint category before general health maintenance.',
      answer: ['general ill health'],
    },
  ],
  [
    27,
    {
      type: 'matching_information',
      prompt: 'the way play causes unusual connections in the brain which are beneficial',
      answer: ['H'],
    },
  ],
  [
    28,
    {
      type: 'matching_information',
      prompt: 'insights from recording how much time young animals spend playing',
      answer: ['F'],
    },
  ],
  [
    29,
    {
      type: 'matching_information',
      prompt: 'a description of the physical hazards that can accompany play',
      answer: ['A'],
    },
  ],
  [
    30,
    {
      type: 'matching_information',
      prompt: 'a description of the mental activities which are exercised and developed during play',
      answer: ['H'],
    },
  ],
  [
    31,
    {
      type: 'matching_information',
      prompt: 'the possible effects that a reduction in play opportunities will have on humans',
      answer: ['I'],
    },
  ],
  [32, { type: 'matching_information', prompt: 'the classes of animals for which play is important', answer: ['B'] }],
  [
    33,
    {
      type: 'multiple_choice_multi',
      prompt:
        'The list below gives some ways of regarding play. Which THREE ways are mentioned by the writer of the text?',
      answer: ['A', 'C', 'F'],
      answerNote: 'Questions 33-35 are accepted in any order.',
    },
  ],
  [
    34,
    {
      type: 'multiple_choice_multi',
      prompt:
        'The list below gives some ways of regarding play. Which THREE ways are mentioned by the writer of the text?',
      answer: ['A', 'C', 'F'],
      answerNote: 'Questions 33-35 are accepted in any order.',
    },
  ],
  [
    35,
    {
      type: 'multiple_choice_multi',
      prompt:
        'The list below gives some ways of regarding play. Which THREE ways are mentioned by the writer of the text?',
      answer: ['A', 'C', 'F'],
      answerNote: 'Questions 33-35 are accepted in any order.',
    },
  ],
  [36, { type: 'matching_features', prompt: 'Robert Barton', answer: ['B'] }],
  [37, { type: 'matching_features', prompt: 'Marc Bekoff', answer: ['G'] }],
  [38, { type: 'matching_features', prompt: 'John Byers', answer: ['E'] }],
  [39, { type: 'matching_features', prompt: 'Sergio Pellis', answer: ['D'] }],
  [40, { type: 'matching_features', prompt: 'Stephen Siviy', answer: ['A'] }],
]);

function assertFound<T>(value: T | null | undefined, label: string): T {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function assertNoError(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

function answersEqual(left: string[] | null | undefined, right: string[]) {
  return JSON.stringify(normalizeIeltsAnswerValue(left ?? [])) === JSON.stringify(normalizeIeltsAnswerValue(right));
}

function optionsEqual(left: Option[] | null | undefined, right: Option[] | undefined) {
  if (!right) return true;
  return JSON.stringify(left ?? []) === JSON.stringify(right);
}

function rangeKey(group: Pick<GroupRow, 'question_range_start' | 'question_range_end'>) {
  return `${group.question_range_start}-${group.question_range_end}`;
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
    .eq('test_number', 2)
    .single();
  assertNoError(testResult.error, 'ielts_reading_tests lookup failed');
  return assertFound(testResult.data?.id, 'Cambridge 4 Test 2 id');
}

async function getGroups(testId: string) {
  const passageResult = await supabaseAdmin.from('ielts_reading_passages').select('id').eq('test_id', testId);
  assertNoError(passageResult.error, 'ielts_reading_passages lookup failed');
  const passageIds = (passageResult.data ?? []).map((passage) => passage.id);

  const groupResult = await supabaseAdmin
    .from('ielts_reading_question_groups')
    .select(
      'id, passage_id, question_type, prompt, instructions, options_json, question_range_start, question_range_end',
    )
    .in('passage_id', passageIds)
    .order('sort_order');
  assertNoError(groupResult.error, 'ielts_reading_question_groups lookup failed');
  return (groupResult.data ?? []) as GroupRow[];
}

async function getQuestions(testId: string) {
  const result = await supabaseAdmin
    .from('ielts_reading_questions')
    .select('id, group_id, question_number, prompt, options_json, answer_json, answer_note')
    .eq('test_id', testId)
    .order('question_number');
  assertNoError(result.error, 'ielts_reading_questions lookup failed');
  return (result.data ?? []) as QuestionRow[];
}

function mismatchedGroups(groups: GroupRow[]) {
  return groups.filter((group) => {
    const patch = groupPatches.get(rangeKey(group));
    return (
      !patch ||
      group.question_type !== patch.question_type ||
      group.prompt !== patch.prompt ||
      group.instructions !== patch.instructions ||
      !optionsEqual(group.options_json, patch.options_json as Option[])
    );
  });
}

function mismatchedQuestions(questions: QuestionRow[]) {
  return questions.filter((question) => {
    const entry = expected.get(question.question_number);
    return (
      !entry ||
      question.prompt !== entry.prompt ||
      !answersEqual(question.answer_json, entry.answer) ||
      !optionsEqual(question.options_json, entry.options) ||
      (question.answer_note ?? null) !== (entry.answerNote ?? null)
    );
  });
}

async function repairGroups(testId: string) {
  const groups = await getGroups(testId);
  const mismatches = mismatchedGroups(groups);
  console.log(`question groups checked: ${groups.length}`);
  console.log(`question groups needing repair: ${mismatches.length}`);
  for (const group of mismatches) {
    console.log(
      `group ${rangeKey(group)}: ${group.question_type} -> ${groupPatches.get(rangeKey(group))?.question_type ?? 'missing patch'}`,
    );
  }
  if (!shouldApply) return groups;

  for (const group of groups) {
    const patch = assertFound(groupPatches.get(rangeKey(group)), `patch for group ${rangeKey(group)}`);
    await updateRow(
      `ielts_reading_question_groups ${rangeKey(group)} update failed`,
      supabaseAdmin.from('ielts_reading_question_groups').update(patch).eq('id', group.id),
    );
  }
  return getGroups(testId);
}

async function repairQuestions(testId: string) {
  const questions = await getQuestions(testId);
  const mismatches = mismatchedQuestions(questions);
  console.log(`question rows checked: ${questions.length}`);
  console.log(`question rows needing repair: ${mismatches.length}`);
  for (const question of mismatches) {
    const entry = expected.get(question.question_number);
    console.log(
      `Q${question.question_number}: ${JSON.stringify(question.answer_json ?? [])} -> ${JSON.stringify(entry?.answer ?? [])}`,
    );
  }
  if (!shouldApply) return questions;

  for (const question of questions) {
    const entry = assertFound(expected.get(question.question_number), `official data for Q${question.question_number}`);
    await updateRow(
      `ielts_reading_questions Q${question.question_number} update failed`,
      supabaseAdmin
        .from('ielts_reading_questions')
        .update({
          prompt: entry.prompt,
          options_json: entry.options ?? [],
          answer_json: entry.answer,
          answer_note: entry.answerNote ?? null,
        })
        .eq('id', question.id),
    );
  }
  return getQuestions(testId);
}

function toScoringQuestion(question: QuestionRow): IeltsReadingQuestion {
  const entry = assertFound(
    expected.get(question.question_number),
    `official scoring data for Q${question.question_number}`,
  );
  return {
    id: question.id,
    testId: '',
    groupId: question.group_id ?? '',
    number: question.question_number,
    prompt: entry.prompt,
    options: entry.options ?? [],
    answer: entry.answer,
    answerNote: entry.answerNote ?? '',
    type: entry.type,
    passageNumber: question.question_number <= 13 ? 1 : question.question_number <= 26 ? 2 : 3,
  };
}

async function repairStoredResponses(testId: string, questions: QuestionRow[]) {
  const attemptsResult = await supabaseAdmin.from('ielts_reading_attempts').select('id, score').eq('test_id', testId);
  assertNoError(attemptsResult.error, 'ielts_reading_attempts lookup failed');
  const attempts = attemptsResult.data ?? [];
  if (attempts.length === 0) {
    console.log('stored attempts checked: 0');
    return;
  }

  const questionModels = questions.map(toScoringQuestion);
  const attemptIds = attempts.map((attempt) => attempt.id);
  const responsesResult = await supabaseAdmin
    .from('ielts_reading_responses')
    .select('id, attempt_id, question_number, response_json, correct_answer_json, is_correct')
    .in('attempt_id', attemptIds);
  assertNoError(responsesResult.error, 'ielts_reading_responses lookup failed');
  const responses = (responsesResult.data ?? []) as ResponseRow[];
  const responsesByAttempt = new Map<string, ResponseRow[]>();
  for (const response of responses) {
    responsesByAttempt.set(response.attempt_id, [...(responsesByAttempt.get(response.attempt_id) ?? []), response]);
  }

  let responseUpdates = 0;
  let attemptScoreUpdates = 0;
  for (const attempt of attempts) {
    const attemptResponses = responsesByAttempt.get(attempt.id) ?? [];
    const answerMap: IeltsReadingAnswerMap = Object.fromEntries(
      attemptResponses.map((response) => [response.question_number, response.response_json]),
    );
    const evaluation = evaluateIeltsReadingAnswers(questionModels, answerMap);
    const evaluatedByNumber = new Map(evaluation.responses.map((response) => [response.questionNumber, response]));

    for (const response of attemptResponses) {
      const evaluated = assertFound(
        evaluatedByNumber.get(response.question_number),
        `stored response Q${response.question_number}`,
      );
      const expectedAnswer = normalizeIeltsAnswerValue(evaluated.correctAnswer);
      if (answersEqual(response.correct_answer_json, expectedAnswer) && response.is_correct === evaluated.isCorrect)
        continue;
      responseUpdates += 1;
      if (shouldApply) {
        await updateRow(
          `ielts_reading_responses ${response.id} update failed`,
          supabaseAdmin
            .from('ielts_reading_responses')
            .update({
              correct_answer_json: expectedAnswer,
              is_correct: evaluated.isCorrect,
            })
            .eq('id', response.id),
        );
      }
    }

    if (attempt.score !== evaluation.score) {
      attemptScoreUpdates += 1;
      if (shouldApply) {
        await updateRow(
          `ielts_reading_attempts ${attempt.id} score update failed`,
          supabaseAdmin.from('ielts_reading_attempts').update({ score: evaluation.score }).eq('id', attempt.id),
        );
      }
    }
  }

  console.log(`stored attempts checked: ${attempts.length}`);
  console.log(`stored responses needing repair: ${responseUpdates}`);
  console.log(`attempt scores needing repair: ${attemptScoreUpdates}`);
}

async function main() {
  console.log(`${shouldApply ? 'Applying' : 'Dry run for'} Cambridge 4 Test 2 repair`);
  const testId = await getTargetTestId();
  const groups = await repairGroups(testId);
  const questions = await repairQuestions(testId);
  await repairStoredResponses(testId, questions);

  const remainingGroups = mismatchedGroups(groups);
  const remainingQuestions = mismatchedQuestions(questions);
  console.log(`remaining group mismatches: ${remainingGroups.length}`);
  console.log(`remaining question mismatches: ${remainingQuestions.length}`);
  if (!shouldApply) console.log('Use --apply to update Supabase rows in place.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
