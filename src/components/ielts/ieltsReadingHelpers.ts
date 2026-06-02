// Pure helpers, constants, and types extracted from IeltsReadingView.tsx.
// No JSX and no React state — these encode the reading-test domain logic
// (draft persistence, prompt derivation, completion-table parsing, answer
// part handling, annotation geometry) and are safe to unit-test directly.
import type {
  IeltsReadingAttemptResult,
  IeltsReadingOption,
  IeltsReadingPassage,
  IeltsReadingPassageFigure,
  IeltsReadingQuestion,
  IeltsReadingQuestionGroup,
} from '../../types';
import { cx } from '../shared/LearningUI';
import {
  normalizeIeltsAnswerValue,
  type IeltsReadingAnswerMap,
  type IeltsReadingAnswerValue,
} from '../../lib/ieltsReadingScoring';
import { splitIeltsPassageParagraphs } from '../../lib/ieltsReadingText';
import { coerceIeltsReadingDraft, type IeltsReadingDraft } from '../../lib/ieltsReadingDraft';

export const TEST_DURATION_SECONDS = 60 * 60;

export type ReadingPane = 'passage' | 'questions';
export type SubmitMode = 'manual' | 'timeout';
export type ReviewFilter = 'all' | 'wrong' | 'unanswered';
export type ReadingToolMode = 'highlight' | 'note' | 'clear' | 'lookup';
export type ReviewItem = {
  question: IeltsReadingQuestion;
  response: IeltsReadingAttemptResult['responses'][number] | undefined;
  answered: boolean;
  isCorrect: boolean;
  isWrong: boolean;
  isUnanswered: boolean;
};

export const DEFAULT_READING_FONT_SIZE = 17;
export const MIN_READING_FONT_SIZE = 15;
export const MAX_READING_FONT_SIZE = 21;

export interface ReadingAnnotation {
  id: string;
  passageNumber: number;
  paragraphIndex: number;
  start: number;
  end: number;
  note?: string;
}

export interface AnnotationSelection {
  passageNumber: number;
  paragraphIndex: number;
  start: number;
  end: number;
  text: string;
  annotationId?: string;
  note?: string;
}

export type ReadingDraft = IeltsReadingDraft;

export const questionTypeLabel: Record<IeltsReadingQuestionGroup['type'], string> = {
  true_false_not_given: 'TRUE / FALSE / NOT GIVEN',
  yes_no_not_given: 'YES / NO / NOT GIVEN',
  multiple_choice_single: '单选',
  multiple_choice_multi: '多选',
  matching_headings: '匹配标题',
  matching_information: '匹配信息',
  matching_features: '匹配特征',
  matching_sentence_endings: '匹配句尾',
  summary_completion: '摘要填空',
  note_completion: '笔记填空',
  table_completion: '表格填空',
  flow_chart_completion: '流程图填空',
  sentence_completion: '句子填空',
  short_answer: '简答',
  diagram_label: '图表标注',
  other: '题目',
};

export function draftKey(userId: string, testId: string) {
  return `lumina.ielts-reading-draft.v1.${userId}.${testId}`;
}

export function readDraft(userId: string, testId: string): ReadingDraft | null {
  if (typeof window === 'undefined') return null;
  return coerceIeltsReadingDraft(window.localStorage.getItem(draftKey(userId, testId)), clampReadingFontSize);
}

export function writeDraft(userId: string, testId: string, draft: ReadingDraft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(draftKey(userId, testId), JSON.stringify(draft));
}

export function clearDraft(userId: string, testId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(draftKey(userId, testId));
}

export function isAnswered(value: IeltsReadingAnswerValue): boolean {
  return normalizeIeltsAnswerValue(value).length > 0;
}

export function normalizeOptions(options: IeltsReadingOption[]) {
  return options.filter((option) => option.key.trim() && option.text.trim());
}

export function normalizeQuestionText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function deriveQuestionPromptFromGroup(group?: IeltsReadingQuestionGroup) {
  if (!group?.instructions) return '';

  let text = normalizeQuestionText(group.instructions).replace(
    /^Questions?\s+\d{1,2}(?:\s*(?:-|and)\s*\d{1,2})?\s*/i,
    '',
  );

  let previous = '';
  while (previous !== text) {
    previous = text;
    text = text.replace(/^Choose\s+[^.?!]*[.?!]\s*/i, '').replace(/^Write your answers?\s+[^.?!]*[.?!]\s*/i, '');
  }

  const questionEnd = text.indexOf('?');
  if (questionEnd >= 0) return text.slice(0, questionEnd + 1).trim();

  const optionStart = /\s+[A-H]\s+(?=[A-Z0-9'"])/.exec(text)?.index ?? -1;
  if (optionStart > 0) {
    const candidate = text.slice(0, optionStart).trim();
    if ((candidate.match(/[A-Za-z]+/g) ?? []).length >= 4) return candidate;
  }

  return '';
}

const completionQuestionTypes = new Set<IeltsReadingQuestionGroup['type']>([
  'summary_completion',
  'note_completion',
  'table_completion',
  'flow_chart_completion',
  'sentence_completion',
  'short_answer',
  'diagram_label',
]);

export interface CompletionTable {
  header: string[];
  rows: string[][];
}

export interface EmbeddedPassageTableFallback {
  headers: [string, string];
  rows: [string, string][];
}

export const visualSymbolsFig2Fallback: EmbeddedPassageTableFallback = {
  headers: ['Words associated with circle/square', 'Agreement among subjects (%)'],
  rows: [
    ['SOFT-HARD', '100'],
    ['MOTHER-FATHER', '94'],
    ['HAPPY-SAD', '94'],
    ['GOOD-EVIL', '89'],
    ['LOVE-HATE', '89'],
    ['ALIVE-DEAD', '87'],
    ['BRIGHT-DARK', '87'],
    ['LIGHT-HEAVY', '85'],
    ['WARM-COLD', '81'],
    ['SUMMER-WINTER', '81'],
    ['WEAK-STRONG', '79'],
    ['FAST-SLOW', '79'],
    ['CAT-DOG', '74'],
    ['SPRING-FALL', '74'],
    ['QUIET-LOUD', '62'],
    ['WALKING-STANDING', '62'],
    ['ODD-EVEN', '57'],
    ['FAR-NEAR', '53'],
    ['PLANT-ANIMAL', '53'],
    ['DEEP-SHALLOW', '51'],
  ],
};

export interface CompletionInputContext {
  group: IeltsReadingQuestionGroup;
  answers: IeltsReadingAnswerMap;
  disabled: boolean;
  activeQuestionNumber: number | null;
  onAnswerChange: (questionNumber: number, value: IeltsReadingAnswerValue) => void;
  onQuestionFocus: (questionNumber: number) => void;
  registerQuestionRef: (questionNumber: number, node: HTMLElement | null) => void;
}

export function isCompletionQuestionType(type: IeltsReadingQuestionGroup['type']) {
  return completionQuestionTypes.has(type);
}

export function getInstructionLines(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parsePipeCompletionTable(lines: string[]): CompletionTable | null {
  const tableRows = lines
    .filter((line) => line.includes('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((row) => row.length >= 2 && row.some(Boolean));

  if (tableRows.length < 2) return null;

  const width = Math.max(...tableRows.map((row) => row.length));
  const normalizedRows = tableRows.map((row) => Array.from({ length: width }, (_value, index) => row[index] ?? ''));
  return {
    header: normalizedRows[0],
    rows: normalizedRows.slice(1),
  };
}

export function containsQuestionMarker(text: string, questionNumber: number) {
  const escapedNumber = String(questionNumber);
  return new RegExp(`(?:\\[${escapedNumber}\\]|(?:^|\\D)${escapedNumber})(?=\\s*(?:[_\\.]{2,}|…))`).test(text);
}

export function normalizeQuestionMarker(text: string, questionNumber: number) {
  const escapedNumber = String(questionNumber);
  return text
    .replace(new RegExp(`\\[${escapedNumber}\\]\\s*(?:[_\\.\\s]|…)*`, 'g'), '______')
    .replace(new RegExp(`(^|\\D)${escapedNumber}\\s*(?:[_\\.\\s]|…){2,}`, 'g'), '$1______')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveCompletionPromptFromInstructions(
  question: IeltsReadingQuestion,
  group?: IeltsReadingQuestionGroup,
) {
  if (!group?.instructions || !isCompletionQuestionType(question.type)) return '';

  const lines = getInstructionLines(group.instructions);
  const table = parsePipeCompletionTable(lines);
  const tableRow = table?.rows.find((row) => row.some((cell) => containsQuestionMarker(cell, question.number)));
  if (tableRow) {
    return tableRow.map((cell) => normalizeQuestionMarker(cell, question.number)).join(' | ');
  }

  const markerIndex = lines.findIndex((line) => containsQuestionMarker(line, question.number));
  if (markerIndex < 0) return '';

  const contextLines = [lines[markerIndex]];
  for (let index = markerIndex + 1; index < Math.min(lines.length, markerIndex + 3); index += 1) {
    const line = lines[index];
    if (/^Questions?\s+\d/i.test(line) || containsQuestionMarker(line, question.number + 1)) break;
    contextLines.push(line);
  }

  return normalizeQuestionMarker(contextLines.join(' '), question.number);
}

export function getQuestionDisplayPrompt(question: IeltsReadingQuestion, group?: IeltsReadingQuestionGroup) {
  return (
    normalizeQuestionText(question.prompt) ||
    deriveCompletionPromptFromInstructions(question, group) ||
    deriveQuestionPromptFromGroup(group) ||
    (isCompletionQuestionType(question.type) ? `Question ${question.number}` : 'Write the correct answer.')
  );
}

export function hasCompletionTable(group: IeltsReadingQuestionGroup) {
  return Boolean(parsePipeCompletionTable(getInstructionLines(group.instructions)));
}

export function getRawAnswerText(value: IeltsReadingAnswerValue) {
  if (Array.isArray(value)) return value.join(' ');
  if (typeof value === 'string') return value;
  return '';
}

export function getAnswerPart(value: IeltsReadingAnswerValue, partIndex: number, partCount: number) {
  const raw = getRawAnswerText(value);
  if (partCount <= 1) return raw;
  return raw.trim().split(/\s+/)[partIndex] ?? '';
}

export function setAnswerPart(value: IeltsReadingAnswerValue, partIndex: number, partCount: number, nextPart: string) {
  if (partCount <= 1) return nextPart;

  const currentParts = getRawAnswerText(value).trim().split(/\s+/).filter(Boolean);
  const nextParts = Array.from({ length: partCount }, (_item, index) => currentParts[index] ?? '');
  nextParts[partIndex] = nextPart.trim();
  return nextParts.filter(Boolean).join(' ');
}

export function countCompletionInputs(value: string, context?: CompletionInputContext) {
  const counts = new Map<number, number>();
  if (!context) return counts;

  const questionNumbers = new Set(context.group.questions.map((question) => question.number));
  const markerRe = /\[(\d{1,2})\]\s*_{2,}|_{2,}/g;
  let currentQuestionNumber: number | null = null;
  let match: RegExpExecArray | null;

  while ((match = markerRe.exec(value))) {
    if (match[1]) {
      currentQuestionNumber = Number.parseInt(match[1], 10);
    }
    if (!currentQuestionNumber || !questionNumbers.has(currentQuestionNumber)) continue;
    counts.set(currentQuestionNumber, (counts.get(currentQuestionNumber) ?? 0) + 1);
  }

  return counts;
}

export function isPassagePartHeading(value: string) {
  return /^Part\s+\d+$/i.test(value.trim());
}

export function makeLegacyPassageFigure(
  figureKey: string,
  title: string,
  caption: string,
  fallback: EmbeddedPassageTableFallback,
): IeltsReadingPassageFigure {
  return {
    id: `legacy-${figureKey}`,
    figureKey,
    title,
    caption,
    imageUrl: '',
    storagePath: '',
    pdfPage: null,
    anchorText: '',
    sortOrder: 0,
    fallback,
  };
}

export function figureMatchesParagraph(figure: IeltsReadingPassageFigure, paragraph: string) {
  if (figure.anchorText && paragraph.includes(figure.anchorText)) return true;
  if (figure.title && new RegExp(`\\b${figure.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(paragraph))
    return true;
  return false;
}

export function getEmbeddedFiguresAfterParagraph(
  passage: IeltsReadingPassage,
  paragraph: string,
): IeltsReadingPassageFigure[] {
  const figures = passage.figures.filter((figure) => figureMatchesParagraph(figure, paragraph));
  if (figures.length > 0) return figures;

  if (passage.title !== 'Visual Symbols and the Blind') return [];
  if (!/\(See Fig\. 2\.\)/.test(paragraph)) return [];

  return [
    makeLegacyPassageFigure(
      'fig-2',
      'Fig. 2',
      'Subjects were asked which word in each pair fits best with a circle and which with a square. These percentages show the level of consensus among sighted subjects.',
      visualSymbolsFig2Fallback,
    ),
  ];
}

export function getQuestionGroupFigures(
  passage: IeltsReadingPassage,
  group: IeltsReadingQuestionGroup,
): IeltsReadingPassageFigure[] {
  const questionText = `${group.prompt}\n${group.instructions}`;
  if (!questionText.trim()) return [];

  return passage.figures
    .filter((figure) => figure.anchorText && questionText.includes(figure.anchorText))
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function getUnansweredNumbers(questions: IeltsReadingQuestion[], answers: IeltsReadingAnswerMap) {
  return questions.filter((question) => !isAnswered(answers[question.number])).map((question) => question.number);
}

export function clampReadingFontSize(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : DEFAULT_READING_FONT_SIZE;
  return Math.min(MAX_READING_FONT_SIZE, Math.max(MIN_READING_FONT_SIZE, Math.round(numericValue)));
}

export function getPassageParagraphs(body: string): string[] {
  return splitIeltsPassageParagraphs(body);
}

export function getQuestionRangeLabel(passage: IeltsReadingPassage) {
  const numbers = passage.groups.flatMap((group) => group.questions.map((question) => question.number));
  if (numbers.length === 0) return '';
  return `${Math.min(...numbers)}-${Math.max(...numbers)}`;
}

export function getQuestionGroupRangeLabel(group: IeltsReadingQuestionGroup) {
  const start = group.rangeStart ?? group.questions[0]?.number;
  const end = group.rangeEnd ?? group.questions[group.questions.length - 1]?.number ?? start;
  if (!start) return 'Questions';
  return start === end ? `Question ${start}` : `Questions ${start}-${end}`;
}

export function countPassageAnswers(passage: IeltsReadingPassage, answers: IeltsReadingAnswerMap) {
  const passageQuestions = passage.groups.flatMap((group) => group.questions);
  return {
    answered: passageQuestions.filter((question) => isAnswered(answers[question.number])).length,
    total: passageQuestions.length,
  };
}

export function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function createAnnotationId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getParagraphElement(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest<HTMLElement>('[data-ielts-paragraph]') ?? null;
}

export function getTextOffsetWithin(element: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
}

export function readArticleSelection(): AnnotationSelection | null {
  if (typeof window === 'undefined') return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  const startElement = getParagraphElement(range.startContainer);
  const endElement = getParagraphElement(range.endContainer);
  if (!startElement || !endElement || startElement !== endElement) return null;

  const passageNumber = Number(startElement.dataset.passageNumber);
  const paragraphIndex = Number(startElement.dataset.paragraphIndex);
  if (!Number.isFinite(passageNumber) || !Number.isFinite(paragraphIndex)) return null;

  const firstOffset = getTextOffsetWithin(startElement, range.startContainer, range.startOffset);
  const secondOffset = getTextOffsetWithin(startElement, range.endContainer, range.endOffset);
  const start = Math.min(firstOffset, secondOffset);
  const end = Math.max(firstOffset, secondOffset);
  const text = selection.toString().trim();
  if (end <= start || !text) return null;

  return { passageNumber, paragraphIndex, start, end, text };
}

export function formatAnswerList(values: string[]) {
  return values.length > 0 ? values.join(', ') : '未作答';
}

export function optionButtonClass(active: boolean) {
  return cx(
    'min-h-11 rounded-2xl border px-4 py-3 text-sm font-black transition-all',
    active
      ? 'border-apple-blue bg-apple-blue text-white shadow-[0_10px_20px_rgba(25,200,185,0.18)]'
      : 'border-black/8 bg-white/80 text-text-secondary hover:border-apple-blue/30 hover:text-text-primary',
  );
}

export function trueFalseChoiceClass(choice: string, active: boolean) {
  const isNegative = choice === 'FALSE' || choice === 'NO';
  const isNeutral = choice === 'NOT GIVEN';
  return cx(
    'flex h-11 items-center justify-center rounded-xl border text-[0.82rem] font-black uppercase tracking-[0.16em] transition-all disabled:cursor-not-allowed disabled:opacity-60',
    active
      ? cx(
          'bg-white shadow-[0_8px_18px_rgba(14,26,56,0.06)]',
          isNegative && 'border-apple-red text-apple-red',
          isNeutral && 'border-[#8e8e93] text-[#74777f]',
          !isNegative && !isNeutral && 'border-apple-green text-apple-green',
        )
      : 'border-transparent text-text-secondary hover:bg-white/70 hover:text-text-primary',
  );
}
