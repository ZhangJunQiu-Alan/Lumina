// Pure helpers, constants, and types extracted from LearningEngine.tsx.
// No JSX and no React state — safe to unit-test in isolation.
import { PronunciationLocale, Word } from '../../types';
import type { WordClickHandler } from '../shared/ClickableText';
import type { VocabularyIssueType } from '../../lib/vocabReportApi';

export type Round1LookupProps = {
  targetWords?: ReadonlySet<string>;
  onWordClick?: WordClickHandler;
};

export const trimDisplayText = (value: string | null | undefined) => value?.trim() ?? '';

export const hasDisplayText = (value: string | null | undefined) => trimDisplayText(value).length > 0;

export const hasRound1WordItems = (items: readonly { word: string }[]) =>
  items.some((item) => hasDisplayText(item.word));

export const getRound1WordItems = <T extends { word: string }>(items: readonly T[], limit?: number) => {
  const visibleItems = items.filter((item) => hasDisplayText(item.word));
  return typeof limit === 'number' ? visibleItems.slice(0, limit) : visibleItems;
};

export const getRelationDetailText = (item: { meaningZh?: string; noteZh?: string }) =>
  [trimDisplayText(item.meaningZh), trimDisplayText(item.noteZh)].filter(Boolean).join(' · ');

export const round1RelationWordClassName =
  'text-base sm:text-[18px] font-black text-text-primary [overflow-wrap:anywhere]';
export const round1RelationDetailClassName =
  'mt-1.5 text-[13px] sm:text-[15px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]';

export const getRound1ExampleItems = (word: Word) =>
  word.senses
    .filter((sense) => hasDisplayText(sense.example_sentence))
    .slice(0, 2)
    .map((sense, index) => ({
      key: `${word.id}-example-${index}`,
      sentence: trimDisplayText(sense.example_sentence),
      translation: hasDisplayText(sense.example_translation_zh)
        ? trimDisplayText(sense.example_translation_zh)
        : undefined,
    }));

export const hasRound1Examples = (word: Word) => word.senses.some((sense) => hasDisplayText(sense.example_sentence));

export const hasRound1MorphologyContent = (word: Word) =>
  hasDisplayText(word.morphology.summaryZh) || hasRound1WordItems(word.derivedWords);

export const hasRound1RelationsContent = (word: Word) =>
  hasRound1WordItems(word.synonyms) || hasRound1WordItems(word.antonyms);

export const hasRound1ContextContent = (word: Word) =>
  hasRound1WordItems(word.confusingPairs) || hasRound1Examples(word);

export type PlaybackTarget = { kind: 'pronunciation'; locale: PronunciationLocale } | { kind: 'example'; key: string };

export type SessionActionKind = 'mastered' | 'save' | 'report';

export type ActionFeedback = {
  tone: 'success' | 'error';
  text: string;
};

export const VOCABULARY_ISSUE_OPTIONS: Array<{ type: VocabularyIssueType; label: string }> = [
  { type: 'definition', label: '释义问题' },
  { type: 'example', label: '例句/拆解问题' },
  { type: 'pronunciation', label: '发音/音标问题' },
  { type: 'other', label: '其他' },
];

export const stripDiacritics = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

const WRONG_ANSWER_MIN_GAP = 4;
const WRONG_ANSWER_GAP_VARIANTS = 2;

export function getWrongAnswerRequeueIndex(currentIndex: number, queueLength: number, randomValue = Math.random()) {
  const safeCurrentIndex = Math.max(0, Math.round(currentIndex));
  const safeQueueLength = Math.max(0, Math.round(queueLength));
  const normalizedRandomValue = Math.min(Math.max(randomValue, 0), 0.999999999);
  const interveningWordCount = WRONG_ANSWER_MIN_GAP + Math.floor(normalizedRandomValue * WRONG_ANSWER_GAP_VARIANTS);

  return Math.min(safeCurrentIndex + interveningWordCount + 1, safeQueueLength);
}

export function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
}

export function formatClozeWordInfo(pos: string | undefined | null, meaning: string | undefined | null) {
  const trimmedPos = pos?.trim();
  const trimmedMeaning = meaning?.trim();

  if (trimmedPos && trimmedMeaning) {
    const displayPos = trimmedPos.endsWith('.') ? trimmedPos : `${trimmedPos}.`;
    return `${displayPos} ${trimmedMeaning}`;
  }

  return trimmedMeaning || trimmedPos || '';
}
