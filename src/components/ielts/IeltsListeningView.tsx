import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock3,
  FileAudio,
  Flag,
  Headphones,
  Loader2,
  PenLine,
  RotateCcw,
} from 'lucide-react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  IeltsListeningAttemptResult,
  IeltsListeningAttemptSummary,
  IeltsListeningBookSummary,
  IeltsListeningPaperHotspot,
  IeltsListeningQuestion,
  IeltsListeningQuestionGroup,
  IeltsListeningResponseResult,
  IeltsListeningSection,
  IeltsListeningTestDetail,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { cx } from '../shared/LearningUI';
import {
  fetchIeltsListeningBooks,
  fetchIeltsListeningAttemptResult,
  fetchIeltsListeningTestDetail,
  fetchRecentIeltsListeningAttempts,
  getIeltsListeningQuestions,
  submitIeltsListeningAttempt,
} from '../../lib/ieltsListeningApi';
import {
  clampIeltsElapsedSeconds,
  formatElapsedTime,
  normalizeIeltsAnswerValue,
  summarizeIeltsListeningResult,
  type IeltsListeningAnswerMap,
  type IeltsListeningAnswerValue,
} from '../../lib/ieltsListeningScoring';

const TEST_DURATION_SECONDS = 30 * 60;

interface ListeningDraft {
  startedAt: string;
  answers: IeltsListeningAnswerMap;
  selectedSection: number;
  flags?: number[];
}

type ReviewFilter = 'all' | 'wrong' | 'unanswered';

function draftKey(userId: string, testId: string) {
  return `lumina.ielts-listening-draft.v1.${userId}.${testId}`;
}

function readDraft(userId: string, testId: string): ListeningDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(userId, testId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ListeningDraft>;
    if (typeof parsed.startedAt !== 'string' || typeof parsed.answers !== 'object') return null;
    return {
      startedAt: parsed.startedAt,
      answers: parsed.answers as IeltsListeningAnswerMap,
      selectedSection: parsed.selectedSection ?? 1,
      flags: Array.isArray(parsed.flags) ? parsed.flags.filter((item): item is number => typeof item === 'number') : [],
    };
  } catch {
    return null;
  }
}

function writeDraft(userId: string, testId: string, draft: ListeningDraft) {
  try {
    window.localStorage.setItem(draftKey(userId, testId), JSON.stringify(draft));
  } catch {
    // Ignore local storage failures; the in-memory state still keeps the attempt usable.
  }
}

function clearDraft(userId: string, testId: string) {
  try {
    window.localStorage.removeItem(draftKey(userId, testId));
  } catch {
    // Ignore local storage failures.
  }
}

function isAnswered(value: IeltsListeningAnswerValue) {
  return normalizeIeltsAnswerValue(value).length > 0;
}

function getQuestionsForSection(section: IeltsListeningSection): IeltsListeningQuestion[] {
  return section.groups.flatMap((group) => group.questions).sort((left, right) => left.number - right.number);
}

function IeltsListeningLoadingShell({ label }: { label: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex items-center gap-3 rounded-[24px] bg-white/78 px-6 py-5 text-sm font-black text-text-secondary shadow-[0_18px_44px_rgba(14,26,56,0.08)]">
        <Loader2 className="h-5 w-5 animate-spin text-apple-orange" />
        {label}
      </div>
    </div>
  );
}

function IeltsListeningErrorShell({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center">
      <div className="rounded-[34px] border border-white/70 bg-white/82 p-8 text-center shadow-[0_18px_44px_rgba(14,26,56,0.08)]">
        <AlertCircle className="mx-auto h-10 w-10 text-apple-red" />
        <h2 className="mt-4 text-2xl font-black text-text-primary">雅思听力暂时不可用</h2>
        <p className="mt-3 text-sm font-bold leading-7 text-text-secondary">{message}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 rounded-2xl bg-apple-orange px-5 py-3 text-sm font-black text-white"
        >
          返回
        </button>
      </div>
    </div>
  );
}

function RecentListeningAttempts({
  attempts,
  onOpenAttempt,
}: {
  attempts: IeltsListeningAttemptSummary[];
  onOpenAttempt: (attempt: IeltsListeningAttemptSummary) => void;
}) {
  if (attempts.length === 0) {
    return (
      <div className="rounded-[28px] border border-dashed border-[#dbe3ef] bg-white/58 p-6 text-sm font-bold text-text-secondary">
        还没有完成过雅思听力训练。
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {attempts.map((attempt) => (
        <button
          key={attempt.id}
          type="button"
          onClick={() => onOpenAttempt(attempt)}
          className="rounded-[24px] bg-white/76 p-5 text-left shadow-[0_12px_30px_rgba(14,26,56,0.06)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
        >
          <p className="text-xs font-black uppercase tracking-[0.18em] text-text-secondary">
            Cambridge {attempt.bookNumber} · Test {attempt.testNumber}
          </p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <p className="text-2xl font-black text-text-primary">
              {attempt.score} / {attempt.totalQuestions}
            </p>
            <p className="text-xs font-bold text-text-secondary">{formatElapsedTime(attempt.elapsedSeconds)}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

export function IeltsListeningHomeView() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const [books, setBooks] = useState<IeltsListeningBookSummary[]>([]);
  const [attempts, setAttempts] = useState<IeltsListeningAttemptSummary[]>([]);
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
          fetchIeltsListeningBooks(),
          fetchRecentIeltsListeningAttempts(userId),
        ]);
        if (cancelled) return;
        setBooks(nextBooks);
        setAttempts(nextAttempts);
      } catch (error) {
        if (!cancelled) setErrorMsg(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (isLoading) return <IeltsListeningLoadingShell label="正在读取雅思听力题库" />;
  if (errorMsg) return <IeltsListeningErrorShell message={errorMsg} onBack={() => navigate('/app/ielts')} />;

  const totalTests = books.reduce((count, book) => count + book.tests.length, 0);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] bg-apple-orange/12 text-apple-orange shadow-[0_16px_32px_rgba(245,195,28,0.14)]">
            <Headphones className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-text-secondary">IELTS Listening</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-text-primary sm:text-4xl">雅思听力真题训练</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-text-secondary">
              每套 4 个 Section、40 题、30 分钟。支持 Cambridge IELTS 4-10。
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
          <FileAudio className="mx-auto h-10 w-10 text-text-secondary" />
          <h3 className="mt-4 text-2xl font-black text-text-primary">还没有导入听力题库</h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm font-bold leading-7 text-text-secondary">
            先运行 Cambridge 听力导入脚本，音频会上传到 Supabase Storage。
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
                <div className="rounded-2xl bg-apple-orange/10 px-3 py-2 text-sm font-black text-apple-orange">
                  {book.tests.length} 套
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {book.tests.map((test) => (
                  <button
                    key={test.id}
                    type="button"
                    onClick={() => navigate(`/app/ielts-listening/test/${test.id}`)}
                    className="rounded-[22px] bg-apple-orange px-4 py-4 text-left text-white shadow-[0_16px_34px_rgba(245,195,28,0.20)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <p className="text-xs font-bold text-white/75">Test</p>
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
          <Clock3 className="h-5 w-5 text-apple-orange" />
          <h3 className="text-xl font-black text-text-primary">最近记录</h3>
        </div>
        <RecentListeningAttempts
          attempts={attempts}
          onOpenAttempt={(attempt) => navigate(`/app/ielts-listening/test/${attempt.testId}?attempt=${attempt.id}`)}
        />
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
  question: IeltsListeningQuestion;
  group: IeltsListeningQuestionGroup;
  value: IeltsListeningAnswerValue;
  disabled?: boolean;
  onChange: (value: IeltsListeningAnswerValue) => void;
}) {
  const response = normalizeIeltsAnswerValue(value);
  const options = question.options.length > 0 ? question.options : group.options;

  if ((question.type === 'multiple_choice_single' || question.type === 'matching') && options.length > 0) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {options.map((option) => {
          const selected = response.includes(option.key.toLowerCase());
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                if (!disabled) onChange(option.key);
              }}
              className={cx(
                'min-h-11 rounded-2xl px-3 py-2 text-left text-sm font-black transition-all',
                selected
                  ? 'bg-apple-orange text-white shadow-[0_12px_22px_rgba(245,195,28,0.18)]'
                  : 'bg-[#f3f5fa] text-text-secondary hover:bg-white',
                disabled && 'cursor-not-allowed opacity-70',
              )}
              title={option.text}
            >
              <span className="mr-2">{option.key}</span>
              <span className="font-bold">{option.text}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <input
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-12 w-full rounded-2xl border border-[#dce3ee] bg-white px-4 text-base font-bold text-text-primary outline-none transition-colors focus:border-[#19c8b9] disabled:cursor-not-allowed disabled:bg-[#f2f4f8]"
      placeholder="输入答案"
    />
  );
}

function answerMapFromResult(result: IeltsListeningAttemptResult | null): IeltsListeningAnswerMap {
  if (!result) return {};
  return result.responses.reduce<IeltsListeningAnswerMap>((map, response) => {
    map[response.questionNumber] = response.response;
    return map;
  }, {});
}

function getResponseStatus(response?: IeltsListeningResponseResult): 'neutral' | 'correct' | 'wrong' | 'unanswered' {
  if (!response) return 'neutral';
  if (response.response.length === 0) return 'unanswered';
  return response.isCorrect ? 'correct' : 'wrong';
}

function getPaperControlClass(status: ReturnType<typeof getResponseStatus>, answered: boolean) {
  if (status === 'correct')
    return 'border-apple-green bg-apple-green/95 text-white shadow-[0_10px_22px_rgba(111,186,44,0.22)]';
  if (status === 'wrong')
    return 'border-apple-red bg-apple-red/95 text-white shadow-[0_10px_22px_rgba(224,90,90,0.20)]';
  if (status === 'unanswered')
    return 'border-apple-red bg-white text-apple-red shadow-[0_10px_22px_rgba(224,90,90,0.12)]';
  if (answered) return 'border-apple-orange bg-white text-text-primary shadow-[0_10px_22px_rgba(245,195,28,0.16)]';
  return 'border-apple-orange/45 bg-white/92 text-text-primary shadow-[0_8px_18px_rgba(31,45,75,0.12)]';
}

function hotspotStyle(hotspot: IeltsListeningPaperHotspot): CSSProperties {
  return {
    left: `${hotspot.x * 100}%`,
    top: `${hotspot.y * 100}%`,
    width: `${Math.max(hotspot.width * 100, hotspot.inputKind === 'choice' ? 8 : 11)}%`,
    minHeight: `${Math.max(hotspot.height * 100, 3)}%`,
  };
}

function PaperHotspotControl({
  question,
  group,
  value,
  response,
  disabled,
  onChange,
}: {
  question: IeltsListeningQuestion;
  group: IeltsListeningQuestionGroup;
  value: IeltsListeningAnswerValue;
  response?: IeltsListeningResponseResult;
  disabled: boolean;
  onChange: (value: IeltsListeningAnswerValue) => void;
}) {
  if (!question.paperHotspot) return null;

  const normalized = normalizeIeltsAnswerValue(value);
  const answered = normalized.length > 0;
  const status = getResponseStatus(response);
  const controlClass = getPaperControlClass(status, answered);
  const options = question.options.length > 0 ? question.options : group.options;
  const title = response
    ? `第 ${question.number} 题：你的答案 ${response.response.join(', ') || '未答'}；正确答案 ${response.correctAnswer.join(' / ')}`
    : `第 ${question.number} 题`;

  if (question.paperHotspot.inputKind === 'choice' && options.length > 0) {
    return (
      <div className="absolute z-10" style={hotspotStyle(question.paperHotspot)} title={title}>
        <div className="flex flex-wrap gap-1 rounded-xl bg-white/82 p-1 shadow-[0_6px_14px_rgba(31,45,75,0.12)] backdrop-blur">
          {options.map((option) => {
            const selected = normalized.includes(option.key.toLowerCase());
            return (
              <button
                key={option.key}
                type="button"
                disabled={disabled}
                onClick={() => onChange(option.key)}
                className={cx(
                  'flex h-7 min-w-7 items-center justify-center rounded-lg border px-2 text-[11px] font-black transition-colors',
                  selected ? controlClass : 'border-[#d7deea] bg-white text-text-secondary',
                  disabled && 'cursor-default',
                )}
              >
                {option.key}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <input
      aria-label={`Question ${question.number}`}
      disabled={disabled}
      title={title}
      value={typeof value === 'string' ? value : normalized.join(' ')}
      onChange={(event) => onChange(event.target.value)}
      className={cx(
        'absolute z-10 rounded-lg border px-2 py-1 text-[12px] font-black outline-none transition-colors backdrop-blur placeholder:text-text-secondary/55',
        controlClass,
        disabled && 'cursor-default opacity-95',
      )}
      style={hotspotStyle(question.paperHotspot)}
      placeholder={String(question.number)}
    />
  );
}

function PaperSectionViewer({
  section,
  answers,
  result,
  disabled,
  onAnswerChange,
}: {
  section: IeltsListeningSection;
  answers: IeltsListeningAnswerMap;
  result: IeltsListeningAttemptResult | null;
  disabled: boolean;
  onAnswerChange: (questionNumber: number, value: IeltsListeningAnswerValue) => void;
}) {
  const questionsByPage = new Map<string, { question: IeltsListeningQuestion; group: IeltsListeningQuestionGroup }[]>();
  const responsesByQuestion = new Map(result?.responses.map((response) => [response.questionNumber, response]) ?? []);

  for (const group of section.groups) {
    for (const question of group.questions) {
      const pageKey = question.paperHotspot?.pageKey;
      if (!pageKey) continue;
      questionsByPage.set(pageKey, [...(questionsByPage.get(pageKey) ?? []), { question, group }]);
    }
  }

  return (
    <div className="space-y-5">
      {section.paperPages.map((page) => (
        <div
          key={page.pageKey}
          className="relative overflow-hidden rounded-[18px] border border-[#dfe6f1] bg-white shadow-[0_18px_44px_rgba(14,26,56,0.07)]"
        >
          <img
            src={page.imageUrl}
            alt={`Cambridge IELTS listening paper page ${page.pdfPage}`}
            className="block w-full select-none"
            draggable={false}
          />
          {(questionsByPage.get(page.pageKey) ?? []).map(({ question, group }) => (
            <PaperHotspotControl
              key={question.id}
              question={question}
              group={group}
              value={answers[question.number]}
              response={responsesByQuestion.get(question.number)}
              disabled={disabled}
              onChange={(value) => onAnswerChange(question.number, value)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function hasCompletePaperOverlay(section: IeltsListeningSection) {
  const questions = getQuestionsForSection(section);
  return section.paperPages.length > 0 && questions.length > 0 && questions.every((question) => question.paperHotspot);
}

function ResultPanel({
  result,
  test,
  onReset,
}: {
  result: IeltsListeningAttemptResult;
  test: IeltsListeningTestDetail;
  onReset: () => void;
}) {
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const questions = getIeltsListeningQuestions(test);
  const responseByQuestion = new Map(result.responses.map((response) => [response.questionNumber, response]));
  const summary = summarizeIeltsListeningResult(result.responses, result.totalQuestions);
  const filteredQuestions = questions.filter((question) => {
    const response = responseByQuestion.get(question.number);
    if (filter === 'wrong') return Boolean(response && response.response.length > 0 && !response.isCorrect);
    if (filter === 'unanswered') return !response || response.response.length === 0;
    return true;
  });

  const filterOptions: { key: ReviewFilter; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: questions.length },
    { key: 'wrong', label: '错题', count: summary.wrongCount },
    { key: 'unanswered', label: '未答', count: summary.unansweredCount },
  ];

  return (
    <div className="rounded-[34px] border border-white/70 bg-white/84 p-6 shadow-[0_18px_44px_rgba(14,26,56,0.08)]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-text-secondary">
            Cambridge {result.bookNumber} · Listening Test {result.testNumber}
          </p>
          <h2 className="mt-3 text-3xl font-black text-text-primary">
            本次得分 {result.score} / {result.totalQuestions}
          </h2>
          <p className="mt-2 text-sm font-bold text-text-secondary">用时 {formatElapsedTime(result.elapsedSeconds)}</p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-apple-orange px-5 py-3 text-sm font-black text-white"
        >
          <RotateCcw className="h-4 w-4" />
          再练一次
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <div className="rounded-[22px] bg-[#f5f7fb] p-4">
          <p className="text-xs font-bold text-text-secondary">正确</p>
          <p className="mt-1 text-2xl font-black text-apple-green">{summary.correctCount}</p>
        </div>
        <div className="rounded-[22px] bg-[#f5f7fb] p-4">
          <p className="text-xs font-bold text-text-secondary">错误</p>
          <p className="mt-1 text-2xl font-black text-apple-red">{summary.wrongCount}</p>
        </div>
        <div className="rounded-[22px] bg-[#f5f7fb] p-4">
          <p className="text-xs font-bold text-text-secondary">未答</p>
          <p className="mt-1 text-2xl font-black text-text-primary">{summary.unansweredCount}</p>
        </div>
        <div className="rounded-[22px] bg-[#f5f7fb] p-4">
          <p className="text-xs font-bold text-text-secondary">正确率</p>
          <p className="mt-1 text-2xl font-black text-text-primary">{summary.accuracyPercent}%</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {filterOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            className={cx(
              'rounded-2xl px-4 py-2 text-sm font-black transition-colors',
              filter === option.key ? 'bg-apple-orange text-white' : 'bg-[#f1f4f9] text-text-secondary',
            )}
          >
            {option.label} {option.count}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {filteredQuestions.map((question) => {
          const response = responseByQuestion.get(question.number);
          const correct = response?.isCorrect ?? false;
          return (
            <div
              key={question.id}
              className={cx(
                'rounded-[22px] border p-4',
                correct ? 'border-apple-green/25 bg-apple-green/6' : 'border-apple-red/20 bg-apple-red/5',
              )}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cx(
                    'flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black',
                    correct ? 'bg-apple-green text-white' : 'bg-apple-red text-white',
                  )}
                >
                  {question.number}
                </span>
                <p className="font-black text-text-primary">{question.prompt || `Question ${question.number}`}</p>
              </div>
              <div className="mt-3 grid gap-2 text-sm font-bold text-text-secondary md:grid-cols-2">
                <p>你的答案：{response?.response.join(', ') || '未答'}</p>
                <p>正确答案：{response?.correctAnswer.join(' / ') || question.answer.join(' / ')}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function IeltsListeningTestView() {
  const { testId } = useParams();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const attemptId = searchParams.get('attempt');
  const [test, setTest] = useState<IeltsListeningTestDetail | null>(null);
  const [answers, setAnswers] = useState<IeltsListeningAnswerMap>({});
  const [selectedSection, setSelectedSection] = useState(1);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [now, setNow] = useState(() => Date.now());
  const [flaggedNumbers, setFlaggedNumbers] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<IeltsListeningAttemptResult | null>(null);
  const timeoutSubmitAttempted = useRef(false);

  useEffect(() => {
    if (!testId || !userId || attemptId) return;
    const draft = readDraft(userId, testId);
    if (!draft) return;
    setStartedAt(draft.startedAt);
    setAnswers(draft.answers);
    setSelectedSection(draft.selectedSection);
    setFlaggedNumbers(draft.flags ?? []);
  }, [attemptId, testId, userId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!testId) return;
      setIsLoading(true);
      setErrorMsg('');
      try {
        const detail = await fetchIeltsListeningTestDetail(testId);
        if (cancelled) return;
        if (!detail) {
          setErrorMsg('找不到这套雅思听力。');
          return;
        }
        setTest(detail);
        setSelectedSection((current) =>
          detail.sections.some((section) => section.number === current) ? current : (detail.sections[0]?.number ?? 1),
        );
      } catch (error) {
        if (!cancelled) setErrorMsg(error instanceof Error ? error.message : String(error));
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
    let cancelled = false;
    async function loadAttempt() {
      if (!attemptId || !userId) {
        if (!attemptId) setResult(null);
        return;
      }

      setIsLoading(true);
      setErrorMsg('');
      try {
        const attempt = await fetchIeltsListeningAttemptResult(userId, attemptId);
        if (cancelled) return;
        if (!attempt) {
          setErrorMsg('找不到这次听力记录。');
          return;
        }
        setResult(attempt);
        setAnswers(answerMapFromResult(attempt));
      } catch (error) {
        if (!cancelled) setErrorMsg(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadAttempt();
    return () => {
      cancelled = true;
    };
  }, [attemptId, userId]);

  useEffect(() => {
    if (!testId || !userId || result || attemptId) return;
    writeDraft(userId, testId, {
      startedAt,
      answers,
      selectedSection,
      flags: flaggedNumbers,
    });
  }, [answers, attemptId, flaggedNumbers, result, selectedSection, startedAt, testId, userId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const questions = useMemo(() => (test ? getIeltsListeningQuestions(test) : []), [test]);
  const selectedSectionData =
    test?.sections.find((section) => section.number === selectedSection) ?? test?.sections[0] ?? null;
  const elapsedSeconds = clampIeltsElapsedSeconds((now - new Date(startedAt).getTime()) / 1000, TEST_DURATION_SECONDS);
  const remainingSeconds = Math.max(0, TEST_DURATION_SECONDS - elapsedSeconds);
  const flaggedSet = useMemo(() => new Set(flaggedNumbers), [flaggedNumbers]);
  const displayAnswers = result ? answerMapFromResult(result) : answers;
  const answeredCount = questions.filter((question) => isAnswered(displayAnswers[question.number])).length;
  const isReviewMode = Boolean(result);

  const setAnswer = useCallback((questionNumber: number, value: IeltsListeningAnswerValue) => {
    setAnswers((current) => ({ ...current, [questionNumber]: value }));
  }, []);

  const toggleFlag = useCallback((questionNumber: number) => {
    setFlaggedNumbers((current) =>
      current.includes(questionNumber)
        ? current.filter((item) => item !== questionNumber)
        : [...current, questionNumber].sort((left, right) => left - right),
    );
  }, []);

  const submitAttempt = useCallback(async () => {
    if (!test || !userId || !testId || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const nextResult = await submitIeltsListeningAttempt({
        userId,
        test,
        answers,
        startedAt,
        elapsedSeconds,
      });
      clearDraft(userId, testId);
      setResult(nextResult);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [answers, elapsedSeconds, isSubmitting, startedAt, test, testId, userId]);

  useEffect(() => {
    if (!test || result || isSubmitting || timeoutSubmitAttempted.current || remainingSeconds > 0) return;
    timeoutSubmitAttempted.current = true;
    void submitAttempt();
  }, [isSubmitting, remainingSeconds, result, submitAttempt, test]);

  const handleReset = () => {
    if (!testId || !userId) return;
    clearDraft(userId, testId);
    setAnswers({});
    setFlaggedNumbers([]);
    setStartedAt(new Date().toISOString());
    setSelectedSection(1);
    setResult(null);
    timeoutSubmitAttempted.current = false;
    navigate(`/app/ielts-listening/test/${testId}`, { replace: true });
  };

  if (!testId) return <Navigate to="/app/ielts-listening" replace />;
  if (isLoading) return <IeltsListeningLoadingShell label="正在读取雅思听力套题" />;
  if (errorMsg && !test)
    return <IeltsListeningErrorShell message={errorMsg} onBack={() => navigate('/app/ielts-listening')} />;
  if (!test)
    return <IeltsListeningErrorShell message="找不到这套雅思听力。" onBack={() => navigate('/app/ielts-listening')} />;

  return (
    <div className="min-h-full bg-[#edf3ff] px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-8">
      <div className="mx-auto w-full max-w-[1540px] space-y-6">
        <header className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/app/ielts-listening')}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-white text-text-primary shadow-[0_14px_30px_rgba(31,45,75,0.10)] transition-transform active:scale-95"
              aria-label="返回雅思听力列表"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
                Cambridge {test.bookNumber} · Listening · Test {test.testNumber}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3 overflow-x-auto pb-1 xl:pb-0">
            {isReviewMode ? (
              <div className="inline-flex h-16 shrink-0 items-center gap-3 rounded-[18px] bg-white px-5 text-xl font-black tracking-[0.08em] text-text-primary shadow-[0_14px_30px_rgba(31,45,75,0.08)]">
                <Check className="h-5 w-5 text-apple-green" />
                <span>{result?.score ?? 0}</span>
                <span className="text-text-secondary">/</span>
                <span className="text-text-secondary">{result?.totalQuestions ?? questions.length}</span>
              </div>
            ) : (
              <div
                className={cx(
                  'inline-flex h-16 shrink-0 items-center gap-3 rounded-[18px] bg-white px-5 text-xl font-black tracking-[0.08em] text-text-primary shadow-[0_14px_30px_rgba(31,45,75,0.08)]',
                  remainingSeconds <= 180 && 'text-apple-red',
                )}
              >
                <Clock3 className="h-5 w-5 text-text-secondary" />
                <span>{formatElapsedTime(remainingSeconds)}</span>
                <span className="text-xs font-black tracking-[0.08em] text-text-secondary">剩余</span>
              </div>
            )}
            <div className="inline-flex h-16 shrink-0 items-center gap-3 rounded-[18px] bg-white px-5 text-xl font-black tracking-[0.12em] text-text-primary shadow-[0_14px_30px_rgba(31,45,75,0.08)]">
              <PenLine className="h-5 w-5 text-text-secondary" />
              <span>{String(answeredCount).padStart(2, '0')}</span>
              <span className="text-text-secondary">/</span>
              <span className="text-text-secondary">{questions.length}</span>
            </div>
            {isReviewMode ? (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex h-16 shrink-0 items-center gap-3 rounded-[18px] bg-apple-orange px-6 text-base font-black text-white shadow-[0_16px_34px_rgba(245,195,28,0.24)]"
              >
                <RotateCcw className="h-5 w-5" />
                再练一次
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void submitAttempt();
                }}
                disabled={isSubmitting}
                className="inline-flex h-16 shrink-0 items-center gap-3 rounded-[18px] bg-apple-orange px-6 text-base font-black text-white shadow-[0_16px_34px_rgba(245,195,28,0.24)] disabled:opacity-70"
              >
                {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                交卷
              </button>
            )}
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
            <section className="rounded-[28px] bg-white p-5 shadow-[0_14px_30px_rgba(31,45,75,0.08)]">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black text-text-primary">Section {selectedSectionData?.number}</h3>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-text-secondary">
                  Questions {(selectedSection - 1) * 10 + 1}-{selectedSection * 10}
                </p>
              </div>
              {selectedSectionData?.audioUrl ? (
                <audio
                  key={selectedSectionData.audioUrl}
                  controls
                  className="mt-4 w-full"
                  src={selectedSectionData.audioUrl}
                >
                  <track kind="captions" />
                </audio>
              ) : (
                <div className="mt-4 rounded-2xl bg-[#fff4df] p-4 text-sm font-bold text-text-secondary">
                  当前 Section 还没有音频 URL。
                </div>
              )}
              <div className="mt-4 grid grid-cols-4 gap-2">
                {test.sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setSelectedSection(section.number)}
                    className={cx(
                      'rounded-2xl px-3 py-3 text-sm font-black transition-colors',
                      selectedSection === section.number
                        ? 'bg-apple-orange text-white'
                        : 'bg-[#f3f5fa] text-text-secondary',
                    )}
                  >
                    S{section.number}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] bg-white p-5 shadow-[0_14px_30px_rgba(31,45,75,0.08)]">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-black text-text-secondary">答题进度</p>
                <div className="flex items-center gap-3 text-xs font-bold text-text-secondary">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-apple-orange" />
                    已答
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[#ff9500]" />
                    标记
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-10 gap-2">
                {questions.map((question) => {
                  const answered = isAnswered(displayAnswers[question.number]);
                  const flagged = flaggedSet.has(question.number);
                  return (
                    <button
                      key={question.id}
                      type="button"
                      onClick={() => setSelectedSection(question.sectionNumber)}
                      className={cx(
                        'relative flex h-[42px] w-[42px] items-center justify-center rounded-xl border text-sm font-black transition-all',
                        answered
                          ? 'border-apple-orange bg-apple-orange text-white'
                          : 'border-[#dce3ee] bg-white text-text-secondary',
                      )}
                    >
                      {question.number}
                      {flagged && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#ff9500]" />}
                    </button>
                  );
                })}
              </div>
            </section>
          </aside>

          <main className="space-y-5">
            {selectedSectionData && hasCompletePaperOverlay(selectedSectionData) ? (
              <PaperSectionViewer
                section={selectedSectionData}
                answers={displayAnswers}
                result={result}
                disabled={isReviewMode}
                onAnswerChange={setAnswer}
              />
            ) : (
              <>
                {selectedSectionData && (
                  <section className="rounded-[30px] border border-white/70 bg-white/84 p-6 shadow-[0_18px_44px_rgba(14,26,56,0.07)]">
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-apple-orange">
                          Section {selectedSectionData.number}
                        </p>
                        <h3 className="mt-2 text-2xl font-black text-text-primary">
                          Questions {(selectedSectionData.number - 1) * 10 + 1}-{selectedSectionData.number * 10}
                        </h3>
                      </div>
                    </div>

                    <div className="max-h-[360px] overflow-y-auto rounded-[24px] bg-[#f7f9fd] p-5 font-serif text-base font-medium leading-8 text-[#25252a] whitespace-pre-wrap">
                      {selectedSectionData.instructions}
                    </div>
                  </section>
                )}

                {selectedSectionData?.groups.map((group) => (
                  <section
                    key={group.id}
                    className="space-y-4 rounded-[30px] border border-white/70 bg-white/84 p-6 shadow-[0_18px_44px_rgba(14,26,56,0.07)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="rounded-lg bg-apple-orange/10 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-apple-orange">
                        {group.type.replaceAll('_', ' ')}
                      </p>
                      <p className="text-sm font-black tracking-[0.12em] text-text-primary">
                        Questions {group.rangeStart}-{group.rangeEnd}
                      </p>
                    </div>

                    <div className="space-y-4">
                      {group.questions.map((question) => {
                        const answered = isAnswered(displayAnswers[question.number]);
                        const flagged = flaggedSet.has(question.number);
                        return (
                          <div key={question.id} className="rounded-[24px] border border-[#e5ebf5] bg-white p-5">
                            <div className="mb-4 flex items-start gap-4">
                              <div
                                className={cx(
                                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-base font-black',
                                  answered ? 'bg-apple-orange text-white' : 'bg-[#f0f3f9] text-text-secondary',
                                )}
                              >
                                {question.number}
                              </div>
                              <p className="min-w-0 flex-1 text-base font-black leading-7 text-text-primary">
                                {question.prompt || `Question ${question.number}`}
                              </p>
                              <button
                                type="button"
                                onClick={() => toggleFlag(question.number)}
                                className={cx(
                                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors',
                                  flagged ? 'bg-[#fff4df] text-[#ff9500]' : 'bg-[#f3f5fa] text-text-secondary',
                                )}
                                aria-label={`标记第 ${question.number} 题`}
                              >
                                <Flag className="h-5 w-5" />
                              </button>
                            </div>
                            <QuestionInput
                              question={question}
                              group={group}
                              value={displayAnswers[question.number]}
                              disabled={isReviewMode}
                              onChange={(value) => setAnswer(question.number, value)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </>
            )}

            {result && <ResultPanel result={result} test={test} onReset={handleReset} />}
          </main>
        </div>
      </div>
    </div>
  );
}
