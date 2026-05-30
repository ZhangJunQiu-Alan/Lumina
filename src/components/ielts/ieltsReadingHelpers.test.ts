import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IeltsReadingPassage,
  IeltsReadingPassageFigure,
  IeltsReadingQuestion,
  IeltsReadingQuestionGroup,
  IeltsReadingQuestionType,
} from '../../types';
import type { IeltsReadingAnswerMap } from '../../lib/ieltsReadingScoring';
import {
  clampReadingFontSize,
  clearDraft,
  containsQuestionMarker,
  countCompletionInputs,
  countPassageAnswers,
  deriveCompletionPromptFromInstructions,
  deriveQuestionPromptFromGroup,
  draftKey,
  figureMatchesParagraph,
  formatAnswerList,
  getAnswerPart,
  getEmbeddedFiguresAfterParagraph,
  getInstructionLines,
  getQuestionDisplayPrompt,
  getQuestionGroupRangeLabel,
  getQuestionRangeLabel,
  getRawAnswerText,
  getUnansweredNumbers,
  hasCompletionTable,
  isAnswered,
  isCompletionQuestionType,
  isPassagePartHeading,
  normalizeOptions,
  normalizeQuestionMarker,
  optionButtonClass,
  parsePipeCompletionTable,
  rangesOverlap,
  readDraft,
  setAnswerPart,
  trueFalseChoiceClass,
  writeDraft,
} from './ieltsReadingHelpers';

function makeQuestion(number: number, overrides: Partial<IeltsReadingQuestion> = {}): IeltsReadingQuestion {
  return {
    id: `q${number}`,
    testId: 't1',
    groupId: 'g1',
    number,
    prompt: '',
    options: [],
    answer: [],
    answerNote: '',
    type: 'sentence_completion' as IeltsReadingQuestionType,
    passageNumber: 1,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<IeltsReadingQuestionGroup> = {}): IeltsReadingQuestionGroup {
  return {
    id: 'g1',
    type: 'sentence_completion' as IeltsReadingQuestionType,
    prompt: '',
    instructions: '',
    options: [],
    rangeStart: null,
    rangeEnd: null,
    questions: [],
    ...overrides,
  };
}

function makeFigure(overrides: Partial<IeltsReadingPassageFigure> = {}): IeltsReadingPassageFigure {
  return {
    id: 'f1',
    figureKey: 'fig-1',
    title: 'Fig. 1',
    caption: '',
    imageUrl: '',
    storagePath: '',
    pdfPage: null,
    anchorText: '',
    sortOrder: 0,
    fallback: {},
    ...overrides,
  };
}

function makePassage(overrides: Partial<IeltsReadingPassage> = {}): IeltsReadingPassage {
  return {
    id: 'p1',
    number: 1,
    title: 'Passage',
    body: '',
    wordCount: 0,
    figures: [],
    groups: [],
    ...overrides,
  };
}

describe('isAnswered / normalizeOptions', () => {
  it('treats empty values as unanswered', () => {
    expect(isAnswered('hello')).toBe(true);
    expect(isAnswered('')).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered(['a'])).toBe(true);
  });

  it('drops options with a blank key or text', () => {
    const options = [
      { key: 'A', text: 'Apple' },
      { key: '', text: 'Bad' },
      { key: 'C', text: '   ' },
      { key: 'D', text: 'Date' },
    ];
    expect(normalizeOptions(options).map((o) => o.key)).toEqual(['A', 'D']);
  });
});

describe('deriveQuestionPromptFromGroup', () => {
  it('strips the "Questions N-M" prefix and leading choose/write directives, returning the question', () => {
    const group = makeGroup({
      instructions: 'Questions 1-3\nChoose the correct answer. Which option is best?',
    });
    expect(deriveQuestionPromptFromGroup(group)).toBe('Which option is best?');
  });

  it('returns empty string when there is nothing question-like', () => {
    expect(deriveQuestionPromptFromGroup(makeGroup({ instructions: '' }))).toBe('');
    expect(deriveQuestionPromptFromGroup(undefined)).toBe('');
  });
});

describe('pipe completion tables', () => {
  it('parses a header row plus body rows', () => {
    const table = parsePipeCompletionTable(['Name | Age', 'Alice | 30', 'Bob | 25']);
    expect(table).toEqual({
      header: ['Name', 'Age'],
      rows: [
        ['Alice', '30'],
        ['Bob', '25'],
      ],
    });
  });

  it('returns null without at least two rows', () => {
    expect(parsePipeCompletionTable(['Name | Age'])).toBeNull();
    expect(parsePipeCompletionTable(['no pipes here'])).toBeNull();
  });

  it('reports table presence via hasCompletionTable', () => {
    expect(hasCompletionTable(makeGroup({ instructions: 'Name | Age\nAlice | 30' }))).toBe(true);
    expect(hasCompletionTable(makeGroup({ instructions: 'plain text' }))).toBe(false);
  });
});

describe('question markers', () => {
  it('detects a numbered blank marker only for the matching number', () => {
    expect(containsQuestionMarker('The [1] ______ matters', 1)).toBe(true);
    expect(containsQuestionMarker('The [1] ______ matters', 2)).toBe(false);
    expect(containsQuestionMarker('answer 3 ____ here', 3)).toBe(true);
  });

  it('normalizes a numbered marker into a plain blank (marker run absorbs the trailing space)', () => {
    expect(normalizeQuestionMarker('The [1] _____ end', 1)).toBe('The ______end');
    expect(normalizeQuestionMarker('value 2 ____ here', 2)).toBe('value ______here');
  });
});

describe('deriveCompletionPromptFromInstructions', () => {
  it('extracts the line containing the question marker', () => {
    const group = makeGroup({
      type: 'note_completion',
      instructions: 'Complete the notes.\nThe [1] ______ is on the table.',
    });
    const prompt = deriveCompletionPromptFromInstructions(makeQuestion(1, { type: 'note_completion' }), group);
    expect(prompt).toBe('The ______is on the table.');
  });

  it('returns empty string for non-completion types', () => {
    expect(
      deriveCompletionPromptFromInstructions(
        makeQuestion(1, { type: 'multiple_choice_single' }),
        makeGroup({ instructions: 'The [1] ______ here' }),
      ),
    ).toBe('');
  });
});

describe('getQuestionDisplayPrompt', () => {
  it('prefers an explicit prompt, falling back to derivation then a default', () => {
    expect(getQuestionDisplayPrompt(makeQuestion(1, { prompt: '  What  is   it? ' }))).toBe('What is it?');
    expect(getQuestionDisplayPrompt(makeQuestion(5, { type: 'short_answer' }))).toBe('Question 5');
    expect(getQuestionDisplayPrompt(makeQuestion(5, { type: 'multiple_choice_single' }))).toBe(
      'Write the correct answer.',
    );
  });
});

describe('answer part get/set', () => {
  it('reads raw text from strings and arrays', () => {
    expect(getRawAnswerText('hi')).toBe('hi');
    expect(getRawAnswerText(['a', 'b'])).toBe('a b');
    expect(getRawAnswerText(null as never)).toBe('');
  });

  it('splits and updates multi-part answers', () => {
    expect(getAnswerPart('hello world', 0, 2)).toBe('hello');
    expect(getAnswerPart('hello world', 1, 2)).toBe('world');
    expect(getAnswerPart('single', 0, 1)).toBe('single');
    expect(setAnswerPart('a b', 1, 2, 'c')).toBe('a c');
    expect(setAnswerPart('', 0, 1, 'x')).toBe('x');
  });
});

describe('countCompletionInputs', () => {
  it('counts blanks per question, carrying the active number across bare blanks', () => {
    const group = makeGroup({ questions: [makeQuestion(1), makeQuestion(2)] });
    const context = {
      group,
      answers: {} as IeltsReadingAnswerMap,
      disabled: false,
      activeQuestionNumber: null,
      onAnswerChange: () => {},
      onQuestionFocus: () => {},
      registerQuestionRef: () => {},
    };
    expect(Object.fromEntries(countCompletionInputs('[1] ____ ____ then [2] ____', context))).toEqual({
      1: 2,
      2: 1,
    });
    expect(countCompletionInputs('[1] ____', undefined).size).toBe(0);
  });
});

describe('passage figures', () => {
  it('matches figures by anchor text or title', () => {
    expect(figureMatchesParagraph(makeFigure({ anchorText: 'See chart' }), 'Please See chart now')).toBe(true);
    expect(figureMatchesParagraph(makeFigure({ title: 'Fig. 1' }), 'As shown in Fig. 1 below')).toBe(true);
    expect(figureMatchesParagraph(makeFigure({ anchorText: 'zzz' }), 'nothing here')).toBe(false);
  });

  it('supplies the legacy Fig. 2 fallback for the blind-symbols passage', () => {
    const passage = makePassage({ title: 'Visual Symbols and the Blind' });
    const figures = getEmbeddedFiguresAfterParagraph(passage, 'They were shown shapes. (See Fig. 2.)');
    expect(figures).toHaveLength(1);
    expect(figures[0].figureKey).toBe('fig-2');
    expect(getEmbeddedFiguresAfterParagraph(passage, 'no marker here')).toEqual([]);
  });
});

describe('ranges, counts, and labels', () => {
  it('lists unanswered question numbers', () => {
    const questions = [makeQuestion(1), makeQuestion(2), makeQuestion(3)];
    const answers: IeltsReadingAnswerMap = { 1: 'a', 3: 'c' };
    expect(getUnansweredNumbers(questions, answers)).toEqual([2]);
  });

  it('clamps the reading font size into range and rounds', () => {
    expect(clampReadingFontSize(10)).toBe(15);
    expect(clampReadingFontSize(30)).toBe(21);
    expect(clampReadingFontSize(17.4)).toBe(17);
    expect(clampReadingFontSize('nope')).toBe(17);
  });

  it('labels question ranges from a passage and a group', () => {
    const passage = makePassage({
      groups: [
        makeGroup({ questions: [makeQuestion(1), makeQuestion(2)] }),
        makeGroup({ questions: [makeQuestion(5)] }),
      ],
    });
    expect(getQuestionRangeLabel(passage)).toBe('1-5');
    expect(getQuestionGroupRangeLabel(makeGroup({ rangeStart: 1, rangeEnd: 3 }))).toBe('Questions 1-3');
    expect(getQuestionGroupRangeLabel(makeGroup({ rangeStart: 4, rangeEnd: 4 }))).toBe('Question 4');
    expect(getQuestionGroupRangeLabel(makeGroup())).toBe('Questions');
  });

  it('counts answered vs total for a passage', () => {
    const passage = makePassage({
      groups: [makeGroup({ questions: [makeQuestion(1), makeQuestion(2), makeQuestion(3)] })],
    });
    expect(countPassageAnswers(passage, { 1: 'a', 2: '' })).toEqual({ answered: 1, total: 3 });
  });

  it('detects overlapping ranges', () => {
    expect(rangesOverlap(0, 5, 3, 8)).toBe(true);
    expect(rangesOverlap(0, 3, 3, 5)).toBe(false);
  });
});

describe('misc string helpers', () => {
  it('splits instruction lines and trims blanks', () => {
    expect(getInstructionLines('a\n\n b  \n c\n')).toEqual(['a', 'b', 'c']);
  });

  it('recognizes part headings and completion types', () => {
    expect(isPassagePartHeading('Part 2')).toBe(true);
    expect(isPassagePartHeading('Introduction')).toBe(false);
    expect(isCompletionQuestionType('note_completion')).toBe(true);
    expect(isCompletionQuestionType('multiple_choice_single')).toBe(false);
  });

  it('formats answer lists and class names', () => {
    expect(formatAnswerList(['a', 'b'])).toBe('a, b');
    expect(formatAnswerList([])).toBe('未作答');
    expect(optionButtonClass(true)).toContain('bg-apple-blue');
    expect(optionButtonClass(false)).toContain('bg-white/80');
    expect(trueFalseChoiceClass('FALSE', true)).toContain('border-apple-red');
    expect(trueFalseChoiceClass('NOT GIVEN', true)).toContain('#8e8e93');
    expect(trueFalseChoiceClass('TRUE', true)).toContain('border-apple-green');
  });
});

describe('draft persistence', () => {
  beforeEach(() => {
    // jsdom's built-in localStorage is only a partial stub here, so use an in-memory one.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a namespaced key and round-trips through localStorage', () => {
    expect(draftKey('user-1', 'test-9')).toBe('lumina.ielts-reading-draft.v1.user-1.test-9');
    expect(readDraft('user-1', 'test-9')).toBeNull();

    const draft = {
      answers: { 1: 'cat' },
      annotations: [],
      fontSize: 19,
      activePane: 'passage' as const,
      activePassageNumber: 1,
      elapsedSeconds: 42,
    };
    writeDraft('user-1', 'test-9', draft as never);
    expect(window.localStorage.getItem(draftKey('user-1', 'test-9'))).not.toBeNull();

    clearDraft('user-1', 'test-9');
    expect(window.localStorage.getItem(draftKey('user-1', 'test-9'))).toBeNull();
  });
});
