import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BookOpenCheck,
  Check,
  CheckCircle2,
  Clock3,
  Eraser,
  FileText,
  Flag,
  Highlighter,
  Loader2,
  Minus,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  X,
} from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type {
  IeltsReadingAttemptResult,
  IeltsReadingAttemptSummary,
  IeltsReadingBookSummary,
  IeltsReadingPassageFigure,
  IeltsReadingQuestion,
  IeltsReadingQuestionGroup,
  IeltsReadingTestDetail,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import { useWordPopover } from '../../contexts/WordPopoverContext';
import { cx } from '../shared/LearningUI';
import { ClickableText, type WordClickHandler } from '../shared/ClickableText';
import {
  fetchIeltsReadingBooks,
  fetchIeltsReadingTestDetail,
  fetchRecentIeltsReadingAttempts,
  getIeltsReadingQuestions,
  submitIeltsReadingAttempt,
} from '../../lib/ieltsReadingApi';
import {
  clampIeltsElapsedSeconds,
  formatElapsedTime,
  normalizeIeltsAnswerValue,
  summarizeIeltsReadingResult,
  type IeltsReadingAnswerMap,
  type IeltsReadingAnswerValue,
} from '../../lib/ieltsReadingScoring';
import { preloadIeltsReadingPassageLookupResources } from '../../lib/ieltsReadingLookupPreload';
import {
  clampReadingFontSize,
  clearDraft,
  countCompletionInputs,
  countPassageAnswers,
  createAnnotationId,
  DEFAULT_READING_FONT_SIZE,
  formatAnswerList,
  getAnswerPart,
  getEmbeddedFiguresAfterParagraph,
  getInstructionLines,
  getPassageParagraphs,
  getQuestionDisplayPrompt,
  getQuestionGroupFigures,
  getQuestionGroupRangeLabel,
  getQuestionRangeLabel,
  getRawAnswerText,
  getUnansweredNumbers,
  hasCompletionTable,
  isAnswered,
  isCompletionQuestionType,
  isPassagePartHeading,
  normalizeOptions,
  optionButtonClass,
  parsePipeCompletionTable,
  questionTypeLabel,
  rangesOverlap,
  readArticleSelection,
  readDraft,
  setAnswerPart,
  TEST_DURATION_SECONDS,
  trueFalseChoiceClass,
  writeDraft,
  type AnnotationSelection,
  type CompletionInputContext,
  type ReadingAnnotation,
  type ReadingPane,
  type ReadingToolMode,
  type ReviewFilter,
  type ReviewItem,
  type SubmitMode,
} from './ieltsReadingHelpers';

function renderCompletionCellContent(value: string, context?: CompletionInputContext) {
  const nodes: ReactNode[] = [];
  const markerRe = /\[(\d{1,2})\]\s*_{2,}|_{2,}/g;
  const inputCounts = countCompletionInputs(value, context);
  const renderedInputCounts = new Map<number, number>();
  const questionNumbers = new Set(context?.group.questions.map((question) => question.number) ?? []);
  let cursor = 0;
  let currentQuestionNumber: number | null = null;
  let match: RegExpExecArray | null;

  while ((match = markerRe.exec(value))) {
    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }

    if (match[1]) {
      currentQuestionNumber = Number.parseInt(match[1], 10);
    }

    const canRenderInput = Boolean(
      context &&
      currentQuestionNumber &&
      questionNumbers.has(currentQuestionNumber) &&
      inputCounts.has(currentQuestionNumber),
    );

    if (canRenderInput && context && currentQuestionNumber) {
      const questionNumber = currentQuestionNumber;
      const partIndex = renderedInputCounts.get(questionNumber) ?? 0;
      const partCount = inputCounts.get(questionNumber) ?? 1;
      renderedInputCounts.set(questionNumber, partIndex + 1);

      nodes.push(
        <span
          key={`${questionNumber}-${match.index}`}
          ref={partIndex === 0 ? (node) => context.registerQuestionRef(questionNumber, node) : undefined}
          className={cx(
            'mx-1 inline-flex items-center gap-1.5 rounded-[9px] px-1 py-0.5 transition-all',
            context.activeQuestionNumber === questionNumber && 'bg-apple-blue/8 ring-2 ring-apple-blue/15',
          )}
        >
          {partIndex === 0 && (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[8px] bg-apple-blue/10 px-1.5 text-xs font-black text-apple-blue">
              {questionNumber}
            </span>
          )}
          <input
            value={getAnswerPart(context.answers[questionNumber], partIndex, partCount)}
            onChange={(event) => {
              context.onAnswerChange(
                questionNumber,
                setAnswerPart(context.answers[questionNumber], partIndex, partCount, event.target.value),
              );
            }}
            onFocus={() => context.onQuestionFocus(questionNumber)}
            disabled={context.disabled}
            aria-label={`第 ${questionNumber} 题答案`}
            className={cx(
              'h-8 min-w-[5.5rem] rounded-[8px] border border-apple-blue/20 bg-apple-blue/5 px-2 text-sm font-black text-text-primary outline-none transition-colors placeholder:text-text-secondary/45 focus:border-apple-blue focus:bg-white disabled:cursor-not-allowed disabled:opacity-60',
              partCount > 1 ? 'w-24' : 'w-36',
            )}
            placeholder="答案"
          />
        </span>,
      );
      cursor = match.index + match[0].length;
      continue;
    }

    nodes.push(
      <span
        key={`${match[1] ?? 'blank'}-${match.index}`}
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        {match[1] && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[8px] bg-apple-blue/10 px-1.5 text-xs font-black text-apple-blue">
            {match[1]}
          </span>
        )}
        <span className="inline-block h-5 min-w-20 border-b-2 border-dotted border-[#8e96a8]" aria-hidden="true" />
      </span>,
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }

  return nodes.length > 0 ? nodes : value;
}

function CompletionSourceBlock({
  group,
  answers,
  disabled = false,
  activeQuestionNumber = null,
  onAnswerChange,
  onQuestionFocus,
  registerQuestionRef,
}: {
  group: IeltsReadingQuestionGroup;
  answers?: IeltsReadingAnswerMap;
  disabled?: boolean;
  activeQuestionNumber?: number | null;
  onAnswerChange?: (questionNumber: number, value: IeltsReadingAnswerValue) => void;
  onQuestionFocus?: (questionNumber: number) => void;
  registerQuestionRef?: (questionNumber: number, node: HTMLElement | null) => void;
}) {
  if (!isCompletionQuestionType(group.type) || !group.instructions.trim()) return null;

  const lines = getInstructionLines(group.instructions);
  const table = parsePipeCompletionTable(lines);
  const instructionLines = lines.filter((line) => !line.includes('|'));
  if (instructionLines.length === 0 && !table) return null;
  const inputContext =
    answers && onAnswerChange && onQuestionFocus && registerQuestionRef
      ? {
          group,
          answers,
          disabled,
          activeQuestionNumber,
          onAnswerChange,
          onQuestionFocus,
          registerQuestionRef,
        }
      : undefined;

  return (
    <div className="rounded-[24px] border border-[#e5ebf5] bg-white p-5">
      {instructionLines.length > 0 && (
        <div className="space-y-2 text-sm font-bold leading-6 text-text-secondary">
          {instructionLines.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </div>
      )}
      {table && (
        <div className={cx('overflow-x-auto', instructionLines.length > 0 && 'mt-4')}>
          <table className="min-w-[720px] border-collapse overflow-hidden rounded-[18px] text-left text-sm">
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th
                    key={`${cell}-${index}`}
                    className="border border-[#dfe5ef] bg-[#f3f6fb] px-3 py-3 text-xs font-black uppercase tracking-[0.12em] text-text-primary"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={`${row.join('|')}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${rowIndex}-${cellIndex}`}
                      className="border border-[#dfe5ef] bg-white px-3 py-3 align-top text-sm font-bold leading-6 text-text-primary"
                    >
                      {renderCompletionCellContent(cell, inputContext)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmbeddedPassageFigureBlock({ figure }: { figure: IeltsReadingPassageFigure }) {
  const imageAlt = figure.caption ? `${figure.title}: ${figure.caption}` : figure.title;
  const imageMaxWidth = figure.figureKey.startsWith('question-')
    ? 'max-w-[760px]'
    : figure.figureKey === 'fig-1'
      ? 'max-w-[240px]'
      : 'max-w-[520px]';
  const fallback =
    figure.fallback.headers && figure.fallback.rows
      ? { headers: figure.fallback.headers, rows: figure.fallback.rows }
      : null;

  if (figure.imageUrl) {
    return (
      <figure className="my-8 flex justify-center">
        <img
          src={figure.imageUrl}
          alt={imageAlt}
          loading="lazy"
          className={cx('h-auto w-full rounded-lg border border-[#e2e8f2] bg-white object-contain', imageMaxWidth)}
        />
        {figure.caption && <figcaption className="sr-only">{imageAlt}</figcaption>}
      </figure>
    );
  }

  if (!fallback) return null;

  return (
    <figure className="my-8 overflow-hidden rounded-[18px] border border-[#dfe5ef] bg-white font-sans">
      <div className="overflow-x-auto">
        <table className="min-w-[520px] w-full border-collapse text-left">
          <thead>
            <tr>
              {fallback.headers.map((header) => (
                <th
                  key={header}
                  className="border-b border-[#dfe5ef] bg-[#f3f6fb] px-4 py-3 text-[0.72rem] font-black uppercase tracking-[0.08em] text-text-primary"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fallback.rows.map(([label, value]) => (
              <tr key={label} className="border-b border-[#edf1f7] last:border-b-0">
                <td className="px-4 py-2.5 text-sm font-black tracking-[0.02em] text-[#25252a]">{label}</td>
                <td className="px-4 py-2.5 text-sm font-black text-[#25252a]">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="border-t border-[#dfe5ef] bg-[#fafbfe] px-4 py-3 text-center text-xs font-bold italic leading-5 text-text-secondary">
        <span className="font-black text-text-primary">{figure.title}</span> {figure.caption}
      </figcaption>
    </figure>
  );
}

function renderLookupTextSegment(text: string, readingMode: ReadingToolMode, onWordClick: WordClickHandler) {
  if (readingMode !== 'lookup') return text;
  return <ClickableText text={text} onWordClick={onWordClick} stopPropagation />;
}

function renderAnnotatedParagraph({
  text,
  passageNumber,
  paragraphIndex,
  annotations,
  readingMode,
  onAnnotationClick,
  onWordClick,
}: {
  text: string;
  passageNumber: number;
  paragraphIndex: number;
  annotations: ReadingAnnotation[];
  readingMode: ReadingToolMode;
  onAnnotationClick: (annotation: ReadingAnnotation) => void;
  onWordClick: WordClickHandler;
}) {
  const paragraphAnnotations = annotations
    .filter(
      (annotation) =>
        annotation.passageNumber === passageNumber &&
        annotation.paragraphIndex === paragraphIndex &&
        annotation.start >= 0 &&
        annotation.end <= text.length &&
        annotation.end > annotation.start,
    )
    .sort((left, right) => left.start - right.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;

  paragraphAnnotations.forEach((annotation) => {
    if (annotation.start < cursor) return;
    if (annotation.start > cursor) {
      const segment = text.slice(cursor, annotation.start);
      nodes.push(
        <Fragment key={`text-${cursor}-${annotation.start}`}>
          {renderLookupTextSegment(segment, readingMode, onWordClick)}
        </Fragment>,
      );
    }
    nodes.push(
      <span
        key={annotation.id}
        className={cx(
          'relative rounded-[6px] px-0.5 transition-colors',
          annotation.note
            ? 'bg-[#dcebff] underline decoration-apple-blue/50 decoration-2 underline-offset-4'
            : 'bg-[#ffe7a8]',
          readingMode === 'clear' && 'cursor-pointer ring-1 ring-apple-red/30',
          readingMode === 'note' && 'cursor-pointer ring-1 ring-apple-blue/30',
        )}
        onClick={(event) => {
          if (readingMode === 'highlight' || readingMode === 'lookup') return;
          event.preventDefault();
          event.stopPropagation();
          onAnnotationClick(annotation);
        }}
      >
        {renderLookupTextSegment(text.slice(annotation.start, annotation.end), readingMode, onWordClick)}
        {annotation.note && (
          <span className="ml-1 inline-flex h-4 w-4 translate-y-0.5 items-center justify-center rounded-[5px] bg-apple-blue text-white">
            <PenLine className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </span>,
    );
    cursor = annotation.end;
  });

  if (cursor < text.length) {
    nodes.push(
      <Fragment key={`text-${cursor}-${text.length}`}>
        {renderLookupTextSegment(text.slice(cursor), readingMode, onWordClick)}
      </Fragment>,
    );
  }

  return nodes;
}

function IeltsLoadingShell({ label }: { label: string }) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] w-full max-w-4xl items-center justify-center">
      <div className="glass flex w-full max-w-xl flex-col items-center gap-5 rounded-[32px] p-12 text-center jelly-shadow">
        <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
        <p className="text-xl font-black text-text-primary">{label}</p>
      </div>
    </div>
  );
}

function IeltsErrorShell({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] w-full max-w-4xl items-center justify-center">
      <div className="glass flex w-full max-w-xl flex-col items-center gap-5 rounded-[32px] p-12 text-center jelly-shadow">
        <AlertCircle className="h-10 w-10 text-apple-red" />
        <div>
          <p className="text-xl font-black text-text-primary">雅思阅读暂时不可用</p>
          <p className="mt-2 text-sm font-bold leading-6 text-text-secondary">{message}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-2xl bg-apple-blue px-5 py-3 text-sm font-black text-white"
        >
          回到阅读列表
        </button>
      </div>
    </div>
  );
}

function RecentAttempts({ attempts }: { attempts: IeltsReadingAttemptSummary[] }) {
  if (attempts.length === 0) {
    return (
      <div className="rounded-[26px] border border-dashed border-black/10 bg-white/55 p-6 text-sm font-bold text-text-secondary">
        还没有完成过雅思阅读训练。
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {attempts.map((attempt) => (
        <div
          key={attempt.id}
          className="rounded-[26px] border border-white/70 bg-white/78 p-5 shadow-[0_14px_34px_rgba(14,26,56,0.06)]"
        >
          <p className="text-xs font-black uppercase tracking-[0.22em] text-text-secondary">
            Cambridge {attempt.bookNumber} · Test {attempt.testNumber}
          </p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <p className="text-3xl font-black text-text-primary">
              {attempt.score}
              <span className="text-base text-text-secondary"> / {attempt.totalQuestions}</span>
            </p>
            <p className="text-sm font-bold text-text-secondary">{formatElapsedTime(attempt.elapsedSeconds)}</p>
          </div>
          <p className="mt-3 text-xs font-bold text-text-secondary">
            {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString('zh-CN') : '刚刚完成'}
          </p>
        </div>
      ))}
    </div>
  );
}

function SubmitConfirmDialog({
  answeredCount,
  totalQuestions,
  unansweredNumbers,
  elapsedSeconds,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  answeredCount: number;
  totalQuestions: number;
  unansweredNumbers: number[];
  elapsedSeconds: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hasUnanswered = unansweredNumbers.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/24 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ielts-submit-confirm-title"
        className="w-full max-w-lg rounded-[32px] border border-white/70 bg-white/94 p-6 shadow-[0_24px_70px_rgba(14,26,56,0.18)]"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-apple-blue/12 text-apple-blue">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 id="ielts-submit-confirm-title" className="text-2xl font-black text-text-primary">
              {hasUnanswered ? '还有题目未作答' : '确认提交本次答案'}
            </h3>
            <p className="mt-2 text-sm font-bold leading-6 text-text-secondary">
              已答 {answeredCount} / {totalQuestions}，用时 {formatElapsedTime(elapsedSeconds)}。
              {hasUnanswered ? '提交后会立即评分，未作答题目按错误处理。' : '提交后会立即进入完整回看。'}
            </p>
          </div>
        </div>

        {hasUnanswered && (
          <div className="mt-5 rounded-[24px] bg-black/[0.035] p-4">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-text-secondary">未答题号</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {unansweredNumbers.map((number) => (
                <span
                  key={number}
                  className="flex h-9 min-w-9 items-center justify-center rounded-xl bg-white px-3 text-sm font-black text-text-primary"
                >
                  {number}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-2xl border border-black/10 bg-white px-5 py-3 text-sm font-black text-text-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            继续检查
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-apple-blue px-5 py-3 text-sm font-black text-white shadow-[0_16px_34px_rgba(25,200,185,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            确认提交
          </button>
        </div>
      </div>
    </div>
  );
}

function AnnotationNoteDialog({
  selection,
  onCancel,
  onSave,
}: {
  selection: AnnotationSelection;
  onCancel: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState(selection.note ?? '');

  useEffect(() => {
    setNote(selection.note ?? '');
  }, [selection]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/24 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ielts-note-title"
        className="w-full max-w-lg rounded-[30px] border border-white/70 bg-white/95 p-6 shadow-[0_24px_70px_rgba(14,26,56,0.18)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-apple-blue">Reading Note</p>
            <h3 id="ielts-note-title" className="mt-2 text-2xl font-black text-text-primary">
              添加笔记
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.04] text-text-secondary"
            aria-label="关闭笔记"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-4 rounded-[20px] bg-[#f5f7fb] px-4 py-3 text-sm font-bold leading-6 text-text-primary">
          {selection.text}
        </p>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={5}
          className="mt-4 w-full resize-none rounded-[22px] border border-black/10 bg-white px-4 py-3 text-sm font-bold leading-6 text-text-primary outline-none transition-colors placeholder:text-text-secondary/60 focus:border-apple-blue"
          placeholder="写下这段原文的笔记"
        />

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-black/10 bg-white px-5 py-3 text-sm font-black text-text-secondary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(note.trim())}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-apple-blue px-5 py-3 text-sm font-black text-white shadow-[0_16px_34px_rgba(25,200,185,0.22)]"
          >
            <StickyNote className="h-4 w-4" />
            保存笔记
          </button>
        </div>
      </div>
    </div>
  );
}

export function IeltsReadingHomeView() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [books, setBooks] = useState<IeltsReadingBookSummary[]>([]);
  const [attempts, setAttempts] = useState<IeltsReadingAttemptSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId) return;
      setIsLoading(true);
      setErrorMsg('');
      try {
        const [nextBooks, nextAttempts] = await Promise.all([
          fetchIeltsReadingBooks(),
          fetchRecentIeltsReadingAttempts(userId),
        ]);
        if (cancelled) return;
        setBooks(nextBooks);
        setAttempts(nextAttempts);
      } catch (error) {
        if (cancelled) return;
        setErrorMsg(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (isLoading) return <IeltsLoadingShell label="正在读取雅思阅读题库" />;
  if (errorMsg) return <IeltsErrorShell message={errorMsg} onBack={() => navigate('/app/home')} />;

  const totalTests = books.reduce((count, book) => count + book.tests.length, 0);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] bg-apple-blue/12 text-apple-blue shadow-[0_16px_32px_rgba(25,200,185,0.12)]">
            <BookOpenCheck className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-text-secondary">IELTS Academic Reading</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-text-primary sm:text-4xl">雅思阅读真题训练</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-text-secondary">
              每套 3 篇文章、40 题、60 分钟。按真实考试节奏完成阅读、答题和回看。
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <div className="rounded-[24px] bg-white/76 px-5 py-4 text-center shadow-[0_12px_30px_rgba(14,26,56,0.06)]">
            <p className="text-2xl font-black text-text-primary">{books.length}</p>
            <p className="text-xs font-bold text-text-secondary">册</p>
          </div>
          <div className="rounded-[24px] bg-white/76 px-5 py-4 text-center shadow-[0_12px_30px_rgba(14,26,56,0.06)]">
            <p className="text-2xl font-black text-text-primary">{totalTests}</p>
            <p className="text-xs font-bold text-text-secondary">套题</p>
          </div>
        </div>
      </header>

      {books.length === 0 ? (
        <section className="glass rounded-[34px] p-8 text-center jelly-shadow">
          <FileText className="mx-auto h-10 w-10 text-text-secondary" />
          <h3 className="mt-4 text-2xl font-black text-text-primary">还没有导入真题 PDF</h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm font-bold leading-7 text-text-secondary">
            把 PDF 放到 `content/ielts-reading/raw/` 后运行 dry-run 导入脚本。校对通过后再 apply 到
            Supabase，这里就会出现套题入口。
          </p>
        </section>
      ) : (
        <section className="grid gap-5 lg:grid-cols-2">
          {books.map((book) => (
            <div
              key={book.id}
              className="rounded-[30px] border border-white/70 bg-white/78 p-6 shadow-[0_18px_44px_rgba(14,26,56,0.07)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-text-secondary">
                    Cambridge IELTS {book.bookNumber}
                  </p>
                  <h3 className="mt-2 text-2xl font-black text-text-primary">{book.title}</h3>
                  {book.sourceLabel && <p className="mt-2 text-xs font-bold text-text-secondary">{book.sourceLabel}</p>}
                </div>
                <div className="rounded-2xl bg-apple-green/10 px-3 py-2 text-sm font-black text-apple-green">
                  {book.tests.length} 套
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {book.tests.map((test) => (
                  <button
                    key={test.id}
                    type="button"
                    onClick={() => navigate(`/app/ielts-reading/test/${test.id}`)}
                    className="rounded-[22px] bg-apple-blue px-4 py-4 text-left text-white shadow-[0_16px_34px_rgba(25,200,185,0.20)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <p className="text-xs font-bold text-white/70">Test</p>
                    <p className="text-2xl font-black">{test.testNumber}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Clock3 className="h-5 w-5 text-apple-blue" />
          <h3 className="text-xl font-black text-text-primary">最近记录</h3>
        </div>
        <RecentAttempts attempts={attempts} />
      </section>
    </div>
  );
}

function QuestionInput({
  question,
  group,
  value,
  disabled = false,
  onChange,
}: {
  question: IeltsReadingQuestion;
  group: IeltsReadingQuestionGroup;
  value: IeltsReadingAnswerValue;
  disabled?: boolean;
  onChange: (value: IeltsReadingAnswerValue) => void;
}) {
  const response = normalizeIeltsAnswerValue(value);
  const options = normalizeOptions(question.options.length > 0 ? question.options : group.options);
  const isGroupedMultiChoice = question.type === 'multiple_choice_multi' && group.questions.length > 1;

  if (question.type === 'true_false_not_given' || question.type === 'yes_no_not_given') {
    const choices =
      question.type === 'true_false_not_given' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
    return (
      <div className="grid grid-cols-3 gap-1 rounded-[18px] bg-[#f3f5fa] p-1">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => {
              if (!disabled) onChange(choice);
            }}
            disabled={disabled}
            className={trueFalseChoiceClass(choice, response[0] === choice.toLowerCase())}
          >
            {choice}
          </button>
        ))}
      </div>
    );
  }

  if (isGroupedMultiChoice && options.length > 0) {
    return (
      <div className="grid gap-2">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => {
              if (!disabled) onChange(option.key);
            }}
            disabled={disabled}
            className={cx(
              optionButtonClass(response[0] === option.key.toLowerCase()),
              'w-full justify-start text-left',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {option.key}. {option.text}
          </button>
        ))}
      </div>
    );
  }

  if (question.type === 'multiple_choice_multi' && options.length > 0) {
    return (
      <div className="grid gap-2">
        {options.map((option) => {
          const active = response.includes(option.key.toLowerCase());
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                if (disabled) return;
                const next = active
                  ? response.filter((item) => item !== option.key.toLowerCase())
                  : [...response, option.key];
                onChange(next);
              }}
              disabled={disabled}
              className={cx(
                optionButtonClass(active),
                'w-full justify-start text-left',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              {option.key}. {option.text}
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === 'multiple_choice_single' && options.length > 0) {
    return (
      <div className="grid gap-2">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => {
              if (!disabled) onChange(option.key);
            }}
            disabled={disabled}
            className={cx(
              optionButtonClass(response[0] === option.key.toLowerCase()),
              'w-full justify-start text-left',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {option.key}. {option.text}
          </button>
        ))}
      </div>
    );
  }

  if (options.length > 0 && question.type.startsWith('matching_')) {
    return (
      <select
        value={response[0] ?? ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-2xl border border-black/10 bg-white/85 px-4 py-3 text-sm font-bold text-text-primary outline-none transition-colors focus:border-apple-blue disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">选择答案</option>
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.key}. {option.text}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      value={getRawAnswerText(value)}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="w-full rounded-2xl border border-black/10 bg-white/85 px-4 py-3 text-sm font-bold text-text-primary outline-none transition-colors placeholder:text-text-secondary/60 focus:border-apple-blue disabled:cursor-not-allowed disabled:opacity-60"
      placeholder="输入答案"
    />
  );
}

function ResultPanel({
  result,
  test,
  onReset,
}: {
  result: IeltsReadingAttemptResult;
  test: IeltsReadingTestDetail;
  onReset: () => void;
}) {
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [activeReviewNumber, setActiveReviewNumber] = useState<number | null>(null);
  const reviewRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const questions = getIeltsReadingQuestions(test);
  const groupByQuestionId = new Map(
    test.passages.flatMap((passage) =>
      passage.groups.flatMap((group) => group.questions.map((question) => [question.id, group] as const)),
    ),
  );
  const responseByQuestion = new Map(result.responses.map((response) => [response.questionNumber, response]));
  const summary = summarizeIeltsReadingResult(result.responses, result.totalQuestions);
  const reviewItems: ReviewItem[] = questions.map((question) => {
    const response = responseByQuestion.get(question.number);
    const answered = Boolean(response && response.response.length > 0);
    return {
      question,
      response,
      answered,
      isCorrect: Boolean(response?.isCorrect),
      isWrong: answered && !response?.isCorrect,
      isUnanswered: !answered,
    };
  });
  const reviewItemByQuestionNumber = new Map(reviewItems.map((item) => [item.question.number, item]));
  const applyReviewFilter = (item: ReviewItem) => {
    if (filter === 'wrong') return item.isWrong;
    if (filter === 'unanswered') return item.isUnanswered;
    return true;
  };
  const filteredReviewGroups = test.passages
    .flatMap((passage) =>
      passage.groups.map((group) => {
        const allItems = group.questions
          .map((question) => reviewItemByQuestionNumber.get(question.number))
          .filter((item): item is ReviewItem => Boolean(item));
        return {
          passage,
          group,
          allItems,
          items: allItems.filter(applyReviewFilter),
        };
      }),
    )
    .filter((group) => group.items.length > 0);

  const scrollToReviewQuestion = (questionNumber: number) => {
    setFilter('all');
    setActiveReviewNumber(questionNumber);
    window.setTimeout(() => {
      reviewRefs.current[questionNumber]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    window.setTimeout(() => {
      setActiveReviewNumber((current) => (current === questionNumber ? null : current));
    }, 1800);
  };

  const filterOptions: { key: ReviewFilter; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: reviewItems.length },
    { key: 'wrong', label: '错题', count: summary.wrongCount },
    { key: 'unanswered', label: '未答', count: summary.unansweredCount },
  ];

  return (
    <section className="space-y-5">
      <div className="glass rounded-[34px] p-7 jelly-shadow">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-text-secondary">
              Cambridge {result.bookNumber} · Test {result.testNumber}
            </p>
            <h2 className="mt-3 text-3xl font-black text-text-primary">
              本次得分 {result.score} / {result.totalQuestions}
            </h2>
            <p className="mt-2 text-sm font-bold text-text-secondary">
              用时 {formatElapsedTime(result.elapsedSeconds)}
            </p>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-apple-blue px-5 py-3 text-sm font-black text-white"
          >
            <RotateCcw className="h-4 w-4" />
            再做一次
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-5">
          {[
            { label: '正确率', value: `${summary.accuracyPercent}%`, tone: 'text-apple-blue' },
            { label: '已答', value: summary.answeredCount, tone: 'text-text-primary' },
            { label: '正确', value: summary.correctCount, tone: 'text-apple-green' },
            { label: '错误', value: summary.wrongCount, tone: 'text-apple-red' },
            { label: '未答', value: summary.unansweredCount, tone: 'text-text-secondary' },
          ].map((item) => (
            <div key={item.label} className="rounded-[22px] bg-white/70 px-4 py-4 text-center">
              <p className={cx('text-2xl font-black', item.tone)}>{item.value}</p>
              <p className="mt-1 text-xs font-bold text-text-secondary">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10">
        {reviewItems.map(({ question, isCorrect, isWrong, isUnanswered }) => {
          return (
            <button
              key={question.id}
              type="button"
              onClick={() => scrollToReviewQuestion(question.number)}
              className={cx(
                'rounded-2xl px-3 py-3 text-center text-sm font-black transition-all',
                isCorrect && 'bg-apple-green/12 text-apple-green',
                isWrong && 'bg-apple-red/10 text-apple-red',
                isUnanswered && 'bg-black/5 text-text-secondary',
              )}
            >
              {question.number}
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xl font-black text-text-primary">答题回看</h3>
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className={cx(
                  'rounded-2xl px-4 py-2.5 text-sm font-black transition-colors',
                  filter === option.key ? 'bg-apple-blue text-white' : 'bg-white/76 text-text-secondary',
                )}
              >
                {option.label} {option.count}
              </button>
            ))}
          </div>
        </div>

        {filteredReviewGroups.length === 0 ? (
          <div className="rounded-[26px] bg-apple-green/10 p-5 text-sm font-black text-apple-green">
            {filter === 'wrong' ? '没有错题。' : filter === 'unanswered' ? '没有未答题。' : '这套题全部答对了。'}
          </div>
        ) : (
          filteredReviewGroups.map(({ passage, group, allItems, items }) => {
            const groupCorrectCount = allItems.filter((item) => item.isCorrect).length;
            const groupUnansweredCount = allItems.filter((item) => item.isUnanswered).length;
            return (
              <div
                key={group.id}
                className="overflow-hidden rounded-[26px] border border-white/70 bg-white/82 transition-all"
              >
                <div className="flex flex-col gap-3 border-b border-[#edf1f7] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-apple-blue">
                      Passage {passage.number} · {questionTypeLabel[group.type]}
                    </p>
                    <p className="mt-1 text-sm font-black text-text-primary">{getQuestionGroupRangeLabel(group)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-black">
                    <span className="rounded-xl bg-apple-green/10 px-3 py-1.5 text-apple-green">
                      正确 {groupCorrectCount}/{allItems.length}
                    </span>
                    {groupUnansweredCount > 0 && (
                      <span className="rounded-xl bg-black/5 px-3 py-1.5 text-text-secondary">
                        未答 {groupUnansweredCount}
                      </span>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-[#edf1f7]">
                  {items.map(({ question, response, isCorrect, isWrong, isUnanswered }) => (
                    <div
                      key={question.id}
                      ref={(node) => {
                        reviewRefs.current[question.number] = node;
                      }}
                      className={cx(
                        'grid gap-3 px-5 py-4 text-sm transition-all md:grid-cols-[minmax(0,1fr)_minmax(9rem,0.32fr)_minmax(9rem,0.32fr)_5rem] md:items-center',
                        activeReviewNumber === question.number &&
                          'bg-apple-blue/7 ring-1 ring-inset ring-apple-blue/20',
                      )}
                    >
                      <p className="min-w-0 font-black leading-6 text-text-primary">
                        {question.number}. {getQuestionDisplayPrompt(question, groupByQuestionId.get(question.id))}
                      </p>
                      <div className="min-w-0 rounded-[16px] bg-black/[0.025] px-3 py-2">
                        <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-text-secondary">
                          你的答案
                        </p>
                        <p className="mt-1 break-words font-bold text-text-primary">
                          {formatAnswerList(response?.response ?? [])}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-[16px] bg-apple-green/10 px-3 py-2">
                        <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-apple-green">
                          正确答案
                        </p>
                        <p className="mt-1 break-words font-bold text-text-primary">
                          {formatAnswerList(response?.correctAnswer ?? question.answer)}
                        </p>
                      </div>
                      <span
                        className={cx(
                          'inline-flex w-fit items-center justify-center rounded-2xl px-3 py-2 text-xs font-black md:justify-self-end',
                          isCorrect && 'bg-apple-green/12 text-apple-green',
                          isWrong && 'bg-apple-red/10 text-apple-red',
                          isUnanswered && 'bg-black/5 text-text-secondary',
                        )}
                      >
                        {isCorrect ? '正确' : isUnanswered ? '未答' : '错误'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function IeltsReadingTestView() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { preferences } = useLearningPreferences();
  const { openPopover, closePopover } = useWordPopover();
  const questionRefs = useRef<Record<number, HTMLElement | null>>({});
  const preloadedLookupPassagesRef = useRef<Set<string>>(new Set());
  const [test, setTest] = useState<IeltsReadingTestDetail | null>(null);
  const [answers, setAnswers] = useState<IeltsReadingAnswerMap>({});
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [selectedPassage, setSelectedPassage] = useState(1);
  const [pane, setPane] = useState<ReadingPane>('passage');
  const [readingMode, setReadingMode] = useState<ReadingToolMode>('highlight');
  const [practiceMode, setPracticeMode] = useState(false);
  const [flaggedNumbers, setFlaggedNumbers] = useState<number[]>([]);
  const [annotations, setAnnotations] = useState<ReadingAnnotation[]>([]);
  const [fontSize, setFontSize] = useState(DEFAULT_READING_FONT_SIZE);
  const [pendingNoteSelection, setPendingNoteSelection] = useState<AnnotationSelection | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<IeltsReadingAttemptResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [isLockedByTimeout, setIsLockedByTimeout] = useState(false);
  const [timeoutSubmitAttempted, setTimeoutSubmitAttempted] = useState(false);
  const [activeQuestionNumber, setActiveQuestionNumber] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!testId || !userId) return;
    const draft = readDraft(userId, testId);
    if (!draft) return;
    setStartedAt(draft.startedAt);
    setAnswers(draft.answers);
    setSelectedPassage(draft.selectedPassage);
    setFlaggedNumbers(draft.flags ?? []);
    setAnnotations(draft.annotations ?? []);
    setFontSize(clampReadingFontSize(draft.fontSize));
    setPracticeMode(draft.practiceMode);
  }, [testId, userId]);

  useEffect(() => {
    if (!testId) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setErrorMsg('');
      try {
        const nextTest = await fetchIeltsReadingTestDetail(testId);
        if (cancelled) return;
        setTest(nextTest);
        if (!nextTest) {
          setErrorMsg('找不到这套雅思阅读。');
        }
      } catch (error) {
        if (cancelled) return;
        setErrorMsg(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [testId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!testId || !userId || result) return;
    writeDraft(userId, testId, {
      startedAt,
      answers,
      selectedPassage,
      flags: flaggedNumbers,
      annotations,
      fontSize,
      practiceMode,
    });
  }, [
    answers,
    annotations,
    flaggedNumbers,
    fontSize,
    practiceMode,
    result,
    selectedPassage,
    startedAt,
    testId,
    userId,
  ]);

  const questions = useMemo(() => (test ? getIeltsReadingQuestions(test) : []), [test]);
  const selectedPassageData =
    test?.passages.find((passage) => passage.number === selectedPassage) ?? test?.passages[0] ?? null;
  const flaggedSet = useMemo(() => new Set(flaggedNumbers), [flaggedNumbers]);
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const remainingSeconds = Math.max(0, TEST_DURATION_SECONDS - elapsedSeconds);
  const timerSeconds = practiceMode ? TEST_DURATION_SECONDS : remainingSeconds;
  const pronunciationLocale = preferences.defaultPronunciationLocale;
  const answeredCount = questions.filter((question) => isAnswered(answers[question.number])).length;
  const submitElapsedSeconds = practiceMode
    ? elapsedSeconds
    : clampIeltsElapsedSeconds(elapsedSeconds, TEST_DURATION_SECONDS);
  const unansweredNumbers = useMemo(() => getUnansweredNumbers(questions, answers), [answers, questions]);
  const inputsLocked = isSubmitting || isLockedByTimeout;

  useEffect(() => {
    if (practiceMode || readingMode !== 'lookup') return;
    setReadingMode('highlight');
    closePopover();
  }, [closePopover, practiceMode, readingMode]);

  useEffect(() => {
    closePopover();
  }, [closePopover, selectedPassage]);

  useEffect(() => {
    if (!practiceMode || !selectedPassageData) return;

    const preloadKey = `${selectedPassageData.id}:${pronunciationLocale}`;
    if (preloadedLookupPassagesRef.current.has(preloadKey)) return;
    preloadedLookupPassagesRef.current.add(preloadKey);

    void preloadIeltsReadingPassageLookupResources(selectedPassageData.body, pronunciationLocale);
  }, [practiceMode, pronunciationLocale, selectedPassageData]);

  const setAnswer = useCallback(
    (questionNumber: number, value: IeltsReadingAnswerValue) => {
      if (inputsLocked) return;
      setAnswers((current) => ({
        ...current,
        [questionNumber]: value,
      }));
    },
    [inputsLocked],
  );

  const toggleFlag = useCallback(
    (questionNumber: number) => {
      if (inputsLocked) return;
      setFlaggedNumbers((current) => {
        if (current.includes(questionNumber)) {
          return current.filter((number) => number !== questionNumber);
        }
        return [...current, questionNumber].sort((left, right) => left - right);
      });
    },
    [inputsLocked],
  );

  const upsertAnnotation = useCallback((selection: AnnotationSelection, note?: string) => {
    const nextAnnotation: ReadingAnnotation = {
      id: selection.annotationId ?? createAnnotationId(),
      passageNumber: selection.passageNumber,
      paragraphIndex: selection.paragraphIndex,
      start: selection.start,
      end: selection.end,
      note: note || undefined,
    };

    setAnnotations((current) =>
      [
        ...current.filter((annotation) => {
          if (annotation.id === selection.annotationId) return false;
          if (
            annotation.passageNumber !== selection.passageNumber ||
            annotation.paragraphIndex !== selection.paragraphIndex
          ) {
            return true;
          }
          return !rangesOverlap(annotation.start, annotation.end, selection.start, selection.end);
        }),
        nextAnnotation,
      ].sort(
        (left, right) =>
          left.passageNumber - right.passageNumber ||
          left.paragraphIndex - right.paragraphIndex ||
          left.start - right.start,
      ),
    );
  }, []);

  const clearSelectedAnnotations = useCallback((selection: AnnotationSelection) => {
    setAnnotations((current) =>
      current.filter((annotation) => {
        if (
          annotation.passageNumber !== selection.passageNumber ||
          annotation.paragraphIndex !== selection.paragraphIndex
        ) {
          return true;
        }
        return !rangesOverlap(annotation.start, annotation.end, selection.start, selection.end);
      }),
    );
  }, []);

  const handleArticleSelection = useCallback(() => {
    if (inputsLocked) return;
    if (readingMode === 'lookup') return;
    const selection = readArticleSelection();
    if (!selection) return;
    if (selection.passageNumber !== selectedPassage) return;

    if (readingMode === 'clear') {
      clearSelectedAnnotations(selection);
      window.getSelection()?.removeAllRanges();
      return;
    }

    if (readingMode === 'note') {
      setPendingNoteSelection(selection);
      return;
    }

    upsertAnnotation(selection);
    window.getSelection()?.removeAllRanges();
  }, [clearSelectedAnnotations, inputsLocked, readingMode, selectedPassage, upsertAnnotation]);

  const handleAnnotationClick = useCallback(
    (annotation: ReadingAnnotation) => {
      if (inputsLocked) return;
      if (readingMode === 'lookup') return;
      if (readingMode === 'clear') {
        setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
        return;
      }
      if (readingMode !== 'note' || !test) return;
      const passage = test.passages.find((item) => item.number === annotation.passageNumber);
      const paragraph = passage ? (getPassageParagraphs(passage.body)[annotation.paragraphIndex] ?? '') : '';
      setPendingNoteSelection({
        passageNumber: annotation.passageNumber,
        paragraphIndex: annotation.paragraphIndex,
        start: annotation.start,
        end: annotation.end,
        text: paragraph.slice(annotation.start, annotation.end),
        annotationId: annotation.id,
        note: annotation.note,
      });
    },
    [inputsLocked, readingMode, test],
  );

  const handleSaveNote = useCallback(
    (note: string) => {
      if (!pendingNoteSelection) return;
      upsertAnnotation(pendingNoteSelection, note);
      setPendingNoteSelection(null);
      window.getSelection()?.removeAllRanges();
    },
    [pendingNoteSelection, upsertAnnotation],
  );

  const submitAttempt = useCallback(
    async (mode: SubmitMode) => {
      if (!test || !testId || !userId || isSubmitting) return;

      setIsSubmitting(true);
      setErrorMsg('');
      if (mode === 'timeout') {
        setIsLockedByTimeout(true);
        setIsSubmitDialogOpen(false);
      }

      try {
        const nextResult = await submitIeltsReadingAttempt({
          userId,
          test,
          answers,
          startedAt,
          elapsedSeconds: mode === 'timeout' ? TEST_DURATION_SECONDS : submitElapsedSeconds,
        });
        clearDraft(userId, testId);
        closePopover();
        setResult(nextResult);
        setIsSubmitDialogOpen(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : String(error));
        if (mode === 'timeout') {
          setIsLockedByTimeout(true);
        } else {
          setIsSubmitDialogOpen(false);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [answers, closePopover, isSubmitting, startedAt, submitElapsedSeconds, test, testId, userId],
  );

  useEffect(() => {
    if (!test || practiceMode || result || isSubmitting || timeoutSubmitAttempted || remainingSeconds > 0) return;
    setTimeoutSubmitAttempted(true);
    setIsLockedByTimeout(true);
    setIsSubmitDialogOpen(false);
    void submitAttempt('timeout');
  }, [isSubmitting, practiceMode, remainingSeconds, result, submitAttempt, test, timeoutSubmitAttempted]);

  const handleSubmitClick = () => {
    if (isLockedByTimeout) {
      void submitAttempt('timeout');
      return;
    }
    setIsSubmitDialogOpen(true);
  };

  const scrollToQuestion = useCallback((question: IeltsReadingQuestion) => {
    setSelectedPassage(question.passageNumber);
    setPane('questions');
    setActiveQuestionNumber(question.number);
    window.setTimeout(() => {
      questionRefs.current[question.number]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    window.setTimeout(() => {
      setActiveQuestionNumber((current) => (current === question.number ? null : current));
    }, 1800);
  }, []);

  const handleReset = () => {
    if (testId && userId) clearDraft(userId, testId);
    closePopover();
    setAnswers({});
    setStartedAt(new Date().toISOString());
    setNow(Date.now());
    setResult(null);
    setSelectedPassage(1);
    setPane('passage');
    setReadingMode('highlight');
    setPracticeMode(false);
    setFlaggedNumbers([]);
    setAnnotations([]);
    setFontSize(DEFAULT_READING_FONT_SIZE);
    setPendingNoteSelection(null);
    setIsSubmitDialogOpen(false);
    setIsLockedByTimeout(false);
    setTimeoutSubmitAttempted(false);
    setActiveQuestionNumber(null);
  };

  if (!testId) return <Navigate to="/app/ielts-reading" replace />;
  if (isLoading) return <IeltsLoadingShell label="正在打开这套阅读" />;
  if (errorMsg && !test) return <IeltsErrorShell message={errorMsg} onBack={() => navigate('/app/ielts-reading')} />;
  if (!test) return <IeltsErrorShell message="找不到这套雅思阅读。" onBack={() => navigate('/app/ielts-reading')} />;

  if (result) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <button
          type="button"
          onClick={() => navigate('/app/ielts-reading')}
          className="inline-flex items-center gap-2 rounded-2xl bg-white/70 px-4 py-3 text-sm font-black text-text-secondary shadow-[0_10px_24px_rgba(14,26,56,0.06)]"
        >
          <ArrowLeft className="h-4 w-4" />
          阅读列表
        </button>
        <ResultPanel result={result} test={test} onReset={handleReset} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#edf3ff] px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-8">
      <div className="mx-auto w-full max-w-[1840px] space-y-6 [zoom:0.9]">
        <header className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/app/ielts-reading')}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-white text-text-primary shadow-[0_14px_30px_rgba(31,45,75,0.10)] transition-transform active:scale-95"
              aria-label="返回雅思阅读列表"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
                Cambridge {test.bookNumber} · Academic · Test {test.testNumber}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3 overflow-x-auto pb-1 xl:pb-0">
            <button
              type="button"
              aria-pressed={practiceMode}
              onClick={() => {
                if (isLockedByTimeout || isSubmitting) return;
                setPracticeMode((current) => !current);
              }}
              disabled={isLockedByTimeout || isSubmitting}
              className={cx(
                'inline-flex h-16 min-w-[178px] shrink-0 items-center justify-between gap-4 rounded-full border px-5 text-sm font-black transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                practiceMode
                  ? 'border-apple-blue bg-apple-blue text-white'
                  : 'border-[#dfe6f2] bg-white text-text-secondary hover:border-apple-blue/25 hover:text-text-primary',
              )}
            >
              <span className="whitespace-nowrap">练习模式</span>
              <span
                className={cx(
                  'relative h-8 w-14 shrink-0 rounded-full transition-colors',
                  practiceMode ? 'bg-white/25' : 'bg-[#e8edf7]',
                )}
                aria-hidden="true"
              >
                <span
                  className={cx(
                    'absolute left-1 top-1 h-6 w-6 rounded-full bg-white transition-transform',
                    practiceMode ? 'translate-x-6' : 'translate-x-0',
                  )}
                />
              </span>
            </button>
            <div
              className={cx(
                'inline-flex h-16 shrink-0 items-center gap-3 rounded-[18px] bg-white px-5 text-xl font-black tracking-[0.08em] text-text-primary shadow-[0_14px_30px_rgba(31,45,75,0.08)]',
                !practiceMode && remainingSeconds <= 300 && 'text-apple-red',
              )}
            >
              <Clock3 className="h-5 w-5 text-text-secondary" />
              <span>{formatElapsedTime(timerSeconds)}</span>
            </div>
            <div className="inline-flex h-16 shrink-0 items-center gap-3 rounded-[18px] bg-white px-5 text-xl font-black tracking-[0.12em] text-text-primary shadow-[0_14px_30px_rgba(31,45,75,0.08)]">
              <PenLine className="h-5 w-5 text-text-secondary" />
              <span>{String(answeredCount).padStart(2, '0')}</span>
              <span className="text-text-secondary">/</span>
              <span className="text-text-secondary">{questions.length}</span>
            </div>
            <button
              type="button"
              onClick={handleSubmitClick}
              disabled={isSubmitting}
              className="inline-flex h-16 shrink-0 items-center justify-center gap-2 rounded-[18px] bg-apple-blue px-8 text-base font-black text-white shadow-[0_18px_34px_rgba(25,200,185,0.26)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              {isSubmitting ? '提交中' : isLockedByTimeout ? '重新提交' : '交卷'}
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {test.passages.map((passage) => {
              const counts = countPassageAnswers(passage, answers);
              return (
                <button
                  key={passage.id}
                  type="button"
                  onClick={() => {
                    setSelectedPassage(passage.number);
                    setPane('passage');
                  }}
                  className={cx(
                    'inline-flex h-14 min-w-[190px] shrink-0 items-center justify-center gap-3 rounded-[16px] border px-5 text-base font-black transition-colors',
                    selectedPassage === passage.number
                      ? 'border-apple-blue bg-apple-blue text-white'
                      : 'border-[#dfe6f2] bg-white text-text-primary hover:border-apple-blue/25',
                  )}
                >
                  Passage {passage.number}
                  <span
                    className={cx(
                      'rounded-lg px-2 py-1 text-xs font-black',
                      selectedPassage === passage.number
                        ? 'bg-white/20 text-white'
                        : 'bg-[#f1f3f8] text-text-secondary',
                    )}
                  >
                    {counts.answered}/{counts.total}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
            <div className="inline-flex h-12 items-center rounded-[16px] bg-[#f4f6fb] p-1 text-sm font-black text-text-secondary">
              <button
                type="button"
                onClick={() => setFontSize((current) => clampReadingFontSize(current - 1))}
                disabled={inputsLocked}
                className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="减小原文字号"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="flex h-10 min-w-10 items-center justify-center">{fontSize}</span>
              <button
                type="button"
                onClick={() => setFontSize((current) => clampReadingFontSize(current + 1))}
                disabled={inputsLocked}
                className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="增大原文字号"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {[
              { key: 'highlight' as const, label: '高亮', icon: Highlighter },
              { key: 'note' as const, label: '笔记', icon: StickyNote },
              { key: 'clear' as const, label: '清除', icon: Eraser },
              ...(practiceMode ? [{ key: 'lookup' as const, label: '查阅', icon: Search }] : []),
            ].map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.key}
                  type="button"
                  onClick={() => setReadingMode(tool.key)}
                  disabled={inputsLocked}
                  className={cx(
                    'inline-flex h-12 items-center gap-2 rounded-[16px] border px-4 text-sm font-black transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    readingMode === tool.key
                      ? 'border-apple-blue/20 bg-apple-blue/10 text-apple-blue'
                      : 'border-[#dfe6f2] bg-white text-text-secondary hover:border-apple-blue/25 hover:bg-[#f4f6fb] hover:text-text-primary',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tool.label}
                </button>
              );
            })}

            <span className="inline-flex items-center gap-2 rounded-full bg-apple-blue/9 px-4 py-2 text-xs font-black text-apple-blue">
              <span className="h-2 w-2 rounded-full bg-apple-blue" />
              {readingMode === 'highlight' && '高亮模式 — 选中文字以高亮'}
              {readingMode === 'note' && '笔记模式 — 选中文字或点击标注写笔记'}
              {readingMode === 'clear' && '清除模式 — 选中文字或点击标注清除'}
              {readingMode === 'lookup' && '查阅模式 — 点击英文单词查看读音和释义'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:hidden">
            {(['passage', 'questions'] as ReadingPane[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setPane(item)}
                className={cx(
                  'rounded-2xl px-4 py-2.5 text-sm font-black',
                  pane === item ? 'bg-apple-blue text-white' : 'bg-white text-text-secondary',
                )}
              >
                {item === 'passage' ? '文章' : '题目'}
              </button>
            ))}
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-[24px] bg-apple-red/10 px-5 py-4 text-sm font-bold text-apple-red">{errorMsg}</div>
        )}

        {isLockedByTimeout && !result && (
          <div className="rounded-[24px] bg-apple-red/10 px-5 py-4 text-sm font-bold text-apple-red">
            {isSubmitting ? '时间到，正在自动交卷。' : '时间到，答案已锁定。若提交失败，请点击右上角重新提交。'}
          </div>
        )}

        {isSubmitDialogOpen && (
          <SubmitConfirmDialog
            answeredCount={answeredCount}
            totalQuestions={questions.length}
            unansweredNumbers={unansweredNumbers}
            elapsedSeconds={submitElapsedSeconds}
            isSubmitting={isSubmitting}
            onCancel={() => setIsSubmitDialogOpen(false)}
            onConfirm={() => {
              void submitAttempt('manual');
            }}
          />
        )}

        {pendingNoteSelection && (
          <AnnotationNoteDialog
            selection={pendingNoteSelection}
            onCancel={() => setPendingNoteSelection(null)}
            onSave={handleSaveNote}
          />
        )}

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <section className={cx(pane !== 'passage' && 'hidden lg:block')}>
            <div className="rounded-[28px] border border-[#e5ebf5] bg-white p-6 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto xl:p-9">
              {selectedPassageData && (
                <article
                  className="space-y-7"
                  onMouseUp={handleArticleSelection}
                  onTouchEnd={handleArticleSelection}
                  onKeyUp={handleArticleSelection}
                >
                  <div className="border-b border-[#e5e9f2] pb-7">
                    <div className="min-w-0">
                      <h3 className="font-serif text-4xl font-black leading-tight text-[#1f1f22]">
                        {selectedPassageData.title}
                      </h3>
                      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-black tracking-[0.12em] text-text-secondary">
                        <span className="whitespace-nowrap">
                          ≈{' '}
                          {selectedPassageData.wordCount ||
                            getPassageParagraphs(selectedPassageData.body).join(' ').split(/\s+/).length}{' '}
                          词
                        </span>
                        <span className="hidden h-1 w-1 rounded-full bg-[#c2c7d1] sm:inline-block" />
                        <span className="whitespace-nowrap">
                          建议 {selectedPassageData.number === 1 ? 18 : selectedPassageData.number === 2 ? 20 : 22} 分钟
                        </span>
                        <span className="hidden h-1 w-1 rounded-full bg-[#c2c7d1] sm:inline-block" />
                        <span className="whitespace-nowrap">
                          Questions {getQuestionRangeLabel(selectedPassageData)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    className="space-y-7 font-serif font-medium leading-[1.72] text-[#25252a]"
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    {getPassageParagraphs(selectedPassageData.body).map((paragraph, index) => {
                      const isPartHeading = isPassagePartHeading(paragraph);
                      const figures = getEmbeddedFiguresAfterParagraph(selectedPassageData, paragraph);

                      return (
                        <Fragment key={`${selectedPassageData.id}-${index}`}>
                          <p
                            data-ielts-paragraph
                            data-passage-number={selectedPassageData.number}
                            data-paragraph-index={index}
                            className={cx(
                              'selection:bg-apple-blue/20',
                              isPartHeading
                                ? 'font-sans text-sm font-black uppercase tracking-[0.18em] text-text-secondary'
                                : index === 0 &&
                                    'first-letter:float-left first-letter:mr-3 first-letter:text-[4.6em] first-letter:font-black first-letter:leading-[0.82]',
                            )}
                          >
                            {renderAnnotatedParagraph({
                              text: paragraph,
                              passageNumber: selectedPassageData.number,
                              paragraphIndex: index,
                              annotations,
                              readingMode,
                              onAnnotationClick: handleAnnotationClick,
                              onWordClick: openPopover,
                            })}
                          </p>
                          {figures.map((figure) => (
                            <EmbeddedPassageFigureBlock key={figure.id} figure={figure} />
                          ))}
                        </Fragment>
                      );
                    })}
                  </div>

                  <div className="pt-6 text-sm font-black text-[#c2c7d1]">↓ 向下滚动以继续阅读</div>
                </article>
              )}
            </div>
          </section>

          <aside
            className={cx(
              'space-y-5 lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100vh-3rem)] lg:flex-col lg:space-y-0 lg:gap-5 lg:overflow-hidden',
              pane !== 'questions' && 'hidden lg:block',
            )}
          >
            <div className="rounded-[28px] border border-[#e5ebf5] bg-white p-6">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-black tracking-[0.16em] text-text-secondary">答题进度</p>
                <div className="flex items-center gap-4 text-xs font-black text-text-secondary">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-apple-blue" />
                    已答
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border border-[#dfe4ef]" />
                    未答
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff9500]" />
                    标记
                  </span>
                </div>
              </div>

              <div className="mt-6">
                {selectedPassageData && (
                  <div key={selectedPassageData.id}>
                    <div className="flex flex-wrap gap-2.5">
                      {selectedPassageData.groups
                        .flatMap((group) => group.questions)
                        .map((question) => {
                          const answered = isAnswered(answers[question.number]);
                          const flagged = flaggedSet.has(question.number);
                          return (
                            <button
                              key={question.id}
                              type="button"
                              onClick={() => scrollToQuestion(question)}
                              className={cx(
                                'relative flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[7px] border text-xs font-black transition-all',
                                answered
                                  ? 'border-apple-blue bg-apple-blue text-white shadow-[0_12px_22px_rgba(25,200,185,0.18)]'
                                  : 'border-[#e3e8f2] bg-white text-text-secondary hover:border-apple-blue/40 hover:text-text-primary',
                                activeQuestionNumber === question.number &&
                                  'ring-2 ring-apple-blue ring-offset-2 ring-offset-white',
                              )}
                            >
                              {question.number}
                              {flagged && (
                                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#ff9500]" />
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              {test.passages.map((passage) => (
                <div key={passage.id} className={cx('space-y-5', passage.number !== selectedPassage && 'hidden')}>
                  {passage.groups.map((group) => {
                    const groupFigures = getQuestionGroupFigures(passage, group);
                    const rendersInlineTable =
                      groupFigures.length === 0 && group.type === 'table_completion' && hasCompletionTable(group);
                    return (
                      <section key={group.id} className="space-y-5">
                        <div className="flex items-center justify-between gap-4 rounded-[20px] border border-[#e5ebf5] bg-white px-6 py-4">
                          <p className="rounded-lg bg-apple-blue/9 px-3 py-2 text-xs font-black uppercase tracking-[0.26em] text-apple-blue">
                            {questionTypeLabel[group.type]}
                          </p>
                          <p className="shrink-0 text-sm font-black tracking-[0.12em] text-text-primary">
                            Questions {group.rangeStart ?? group.questions[0]?.number}-
                            {group.rangeEnd ?? group.questions[group.questions.length - 1]?.number}
                          </p>
                        </div>

                        {groupFigures.map((figure) => (
                          <EmbeddedPassageFigureBlock key={figure.id} figure={figure} />
                        ))}

                        {groupFigures.length === 0 && (
                          <CompletionSourceBlock
                            group={group}
                            answers={answers}
                            disabled={inputsLocked}
                            activeQuestionNumber={activeQuestionNumber}
                            onAnswerChange={setAnswer}
                            onQuestionFocus={setActiveQuestionNumber}
                            registerQuestionRef={(questionNumber, node) => {
                              questionRefs.current[questionNumber] = node;
                            }}
                          />
                        )}

                        {!rendersInlineTable && (
                          <div className="space-y-5">
                            {group.questions.map((question) => {
                              const answered = isAnswered(answers[question.number]);
                              const flagged = flaggedSet.has(question.number);
                              return (
                                <div
                                  key={question.id}
                                  ref={(node) => {
                                    questionRefs.current[question.number] = node;
                                  }}
                                  className={cx(
                                    'rounded-[26px] border bg-white p-6 transition-all',
                                    activeQuestionNumber === question.number
                                      ? 'border-apple-blue ring-2 ring-apple-blue/15'
                                      : 'border-[#e5ebf5]',
                                  )}
                                >
                                  <div className="mb-5 flex items-start gap-4">
                                    <div
                                      className={cx(
                                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-base font-black',
                                        answered || activeQuestionNumber === question.number
                                          ? 'bg-apple-blue text-white'
                                          : 'bg-[#f0f3f9] text-text-secondary',
                                      )}
                                    >
                                      {question.number}
                                    </div>
                                    <p className="min-w-0 flex-1 text-lg font-black leading-8 text-text-primary">
                                      {getQuestionDisplayPrompt(question, group)}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => toggleFlag(question.number)}
                                      disabled={inputsLocked}
                                      aria-pressed={flagged}
                                      className={cx(
                                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] transition-all disabled:cursor-not-allowed disabled:opacity-60',
                                        flagged
                                          ? 'bg-[#fff0db] text-[#ff9500]'
                                          : 'bg-white text-[#c2c7d1] hover:bg-[#f4f6fb] hover:text-text-secondary',
                                      )}
                                      aria-label={
                                        flagged ? `取消标记第 ${question.number} 题` : `标记第 ${question.number} 题`
                                      }
                                    >
                                      <Flag className={cx('h-5 w-5', flagged && 'fill-current')} />
                                    </button>
                                  </div>
                                  <QuestionInput
                                    question={question}
                                    group={group}
                                    value={answers[question.number]}
                                    disabled={inputsLocked}
                                    onChange={(value) => setAnswer(question.number, value)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
