import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Headphones,
  MessageCircle,
  PenLine,
  Sparkles,
  Star,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type {
  IeltsTargetScore,
  IeltsListeningAttemptSummary,
  IeltsListeningBookSummary,
  IeltsReadingAttemptSummary,
  IeltsReadingBookSummary,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import { IELTS_LISTENING_ENABLED } from '../../lib/aiFeatures';
import { fetchIeltsListeningBooks, fetchRecentIeltsListeningAttempts } from '../../lib/ieltsListeningApi';
import { fetchIeltsReadingBooks, fetchRecentIeltsReadingAttempts } from '../../lib/ieltsReadingApi';
import { formatElapsedTime } from '../../lib/ieltsReadingScoring';
import { IELTS_TARGET_SCORE_OPTIONS } from '../../lib/learningPreferences';
import { cx } from '../shared/LearningUI';
import { buildIeltsDashboardModel, type IeltsDashboardModel, type IeltsDashboardModuleKey } from './ieltsDashboard';

type DisplayModuleKey = IeltsDashboardModuleKey | 'writing' | 'speaking';
type Accent = 'teal' | 'amber' | 'violet' | 'coral';

interface DashboardData {
  readingBooks: IeltsReadingBookSummary[];
  listeningBooks: IeltsListeningBookSummary[];
  readingAttempts: IeltsReadingAttemptSummary[];
  listeningAttempts: IeltsListeningAttemptSummary[];
}

interface ModuleCardConfig {
  key: DisplayModuleKey;
  icon: LucideIcon;
  title: string;
  titleZh: string;
  description: string;
  actionLabel: string;
  accent: Accent;
  disabled?: boolean;
}

const EMPTY_DASHBOARD_DATA: DashboardData = {
  readingBooks: [],
  listeningBooks: [],
  readingAttempts: [],
  listeningAttempts: [],
};

const MODULE_CARD_CONFIGS: ModuleCardConfig[] = [
  {
    key: 'reading',
    icon: BookOpenCheck,
    title: 'Academic Reading',
    titleZh: '学术阅读',
    description: '每套 3 篇文章、40 道题，限时 60 分钟。支持答案回看。',
    actionLabel: '进入阅读训练',
    accent: 'teal',
  },
  ...(IELTS_LISTENING_ENABLED
    ? [
        {
          key: 'listening' as const,
          icon: Headphones,
          title: 'Listening',
          titleZh: '听力',
          description: '每套 4 个 Section、40 道题，限时 30 分钟。提供音频与答案回看。',
          actionLabel: '进入听力训练',
          accent: 'amber' as const,
        },
      ]
    : []),
  {
    key: 'writing',
    icon: PenLine,
    title: 'Writing',
    titleZh: '写作',
    description: '写作练习与反馈功能尚未开放。',
    actionLabel: '尚未开放',
    accent: 'violet',
    disabled: true,
  },
  {
    key: 'speaking',
    icon: MessageCircle,
    title: 'Speaking',
    titleZh: '口语',
    description: '口语练习与发音反馈功能尚未开放。',
    actionLabel: '尚未开放',
    accent: 'coral',
    disabled: true,
  },
];

const ACCENT_CLASSES: Record<
  Accent,
  {
    icon: string;
    title: string;
    bar: string;
    button: string;
    buttonShadow: string;
  }
> = {
  teal: {
    icon: 'bg-apple-blue/12 text-apple-blue',
    title: 'text-apple-blue',
    bar: 'bg-apple-blue',
    button: 'bg-apple-blue text-white',
    buttonShadow: 'shadow-[0_16px_34px_rgba(25,200,185,0.22)]',
  },
  amber: {
    icon: 'bg-apple-orange/15 text-apple-orange',
    title: 'text-apple-orange',
    bar: 'bg-apple-orange',
    button: 'bg-apple-orange text-white',
    buttonShadow: 'shadow-[0_16px_34px_rgba(245,195,28,0.24)]',
  },
  violet: {
    icon: 'bg-apple-indigo/14 text-apple-indigo',
    title: 'text-apple-indigo',
    bar: 'bg-apple-indigo',
    button: 'bg-apple-indigo text-white',
    buttonShadow: 'shadow-[0_16px_34px_rgba(136,157,240,0.22)]',
  },
  coral: {
    icon: 'bg-apple-red/12 text-apple-red',
    title: 'text-apple-red',
    bar: 'bg-apple-red',
    button: 'bg-apple-red text-white',
    buttonShadow: 'shadow-[0_16px_34px_rgba(224,90,90,0.22)]',
  },
};

interface DashboardOverview {
  practiceDays: number;
  averageAccuracyPercent: number | null;
  averageHours: number | null;
  practiceDaysDelta: number | null;
  accuracyDelta: number | null;
  hoursDelta: number | null;
  trendPoints: Array<number | null>;
}

function formatBand(score: number) {
  return score.toFixed(1);
}

function formatDate(value: string) {
  if (!value) return '刚刚完成';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getAttemptTime(attempt: IeltsDashboardModel['recentAttempts'][number]) {
  return Date.parse(attempt.submittedAt) || 0;
}

function getAttemptDayKey(attempt: IeltsDashboardModel['recentAttempts'][number]) {
  const time = getAttemptTime(attempt);
  if (!time) return '';
  return new Date(time).toISOString().slice(0, 10);
}

function getWindowAttempts(
  attempts: IeltsDashboardModel['recentAttempts'],
  anchorTime: number,
  startOffsetDays: number,
  endOffsetDays: number,
) {
  const dayMs = 24 * 60 * 60 * 1000;
  const startTime = anchorTime - startOffsetDays * dayMs;
  const endTime = anchorTime - endOffsetDays * dayMs;
  return attempts.filter((attempt) => {
    const time = getAttemptTime(attempt);
    return time > startTime && time <= endTime;
  });
}

function averageAccuracy(attempts: IeltsDashboardModel['recentAttempts']) {
  const scoredAttempts = attempts.filter((attempt) => attempt.totalQuestions > 0);
  if (scoredAttempts.length === 0) return null;
  return Math.round(
    (scoredAttempts.reduce((sum, attempt) => sum + attempt.score / attempt.totalQuestions, 0) / scoredAttempts.length) *
      100,
  );
}

function averageHours(attempts: IeltsDashboardModel['recentAttempts']) {
  if (attempts.length === 0) return null;
  return attempts.reduce((sum, attempt) => sum + attempt.elapsedSeconds, 0) / attempts.length / 3600;
}

function uniquePracticeDays(attempts: IeltsDashboardModel['recentAttempts']) {
  return new Set(attempts.map(getAttemptDayKey).filter(Boolean)).size;
}

function buildTrendPoints(attempts: IeltsDashboardModel['recentAttempts']) {
  const chronological = attempts
    .filter((attempt) => attempt.totalQuestions > 0)
    .slice()
    .sort((left, right) => getAttemptTime(left) - getAttemptTime(right))
    .slice(-4);

  return Array.from({ length: 4 }, (_, index) => chronological[index]?.accuracyPercent ?? null);
}

function buildDashboardOverview(model: IeltsDashboardModel): DashboardOverview {
  const attempts = model.recentAttempts;
  if (attempts.length === 0) {
    return {
      practiceDays: 0,
      averageAccuracyPercent: null,
      averageHours: null,
      practiceDaysDelta: null,
      accuracyDelta: null,
      hoursDelta: null,
      trendPoints: [null, null, null, null],
    };
  }

  const anchorTime = Math.max(...attempts.map(getAttemptTime));
  const currentWindow = getWindowAttempts(attempts, anchorTime, 30, 0);
  const previousWindow = getWindowAttempts(attempts, anchorTime, 60, 30);
  const currentDays = uniquePracticeDays(currentWindow);
  const previousDays = uniquePracticeDays(previousWindow);
  const currentAccuracy = averageAccuracy(currentWindow);
  const previousAccuracy = averageAccuracy(previousWindow);
  const currentHours = averageHours(currentWindow);
  const previousHours = averageHours(previousWindow);

  return {
    practiceDays: uniquePracticeDays(attempts),
    averageAccuracyPercent: averageAccuracy(attempts),
    averageHours: averageHours(attempts),
    practiceDaysDelta: previousWindow.length > 0 ? currentDays - previousDays : null,
    accuracyDelta:
      currentAccuracy !== null && previousAccuracy !== null ? Math.round(currentAccuracy - previousAccuracy) : null,
    hoursDelta:
      currentHours !== null && previousHours !== null ? Number((currentHours - previousHours).toFixed(1)) : null,
    trendPoints: buildTrendPoints(attempts),
  };
}

function formatSignedNumber(value: number, suffix = '') {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}${suffix}`;
}

function formatOverviewDelta(value: number | null, suffix = '') {
  if (value === null) return '开始记录';
  if (value === 0) return '持平';
  return `较上期 ${formatSignedNumber(value, suffix)}`;
}

function getModuleProgress(model: IeltsDashboardModel, key: DisplayModuleKey) {
  if (key === 'reading') return model.reading;
  if (key === 'listening') return model.listening;
  return null;
}

function getModuleRoute(key: DisplayModuleKey) {
  if (key === 'reading') return '/app/ielts-reading';
  if (key === 'listening' && IELTS_LISTENING_ENABLED) return '/app/ielts-listening';
  return null;
}

function DashboardLoadingShell() {
  return (
    <div className="-mx-3 w-[calc(100%+1.5rem)] max-w-[1480px] overflow-x-clip rounded-none border-0 bg-transparent p-0 shadow-none sm:mx-auto sm:w-full">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(430px,0.38fr)] xl:items-center xl:gap-7">
        <div className="space-y-3 sm:space-y-4">
          <div className="h-8 w-60 animate-pulse rounded-[14px] bg-black/8 sm:h-10 sm:w-full sm:max-w-md" />
          <div className="h-4 w-full max-w-xs animate-pulse rounded-full bg-black/7 sm:max-w-xl" />
          <div className="hidden flex-wrap gap-3 pt-2 sm:flex">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-[62px] w-[186px] animate-pulse rounded-[18px] bg-black/6" />
            ))}
          </div>
        </div>
        <div className="h-[94px] animate-pulse rounded-[18px] bg-black/6 sm:h-[154px] sm:rounded-[24px]" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:mt-7 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-[170px] animate-pulse rounded-[18px] bg-black/6 sm:h-[238px] sm:rounded-[24px]"
          />
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:mt-5 sm:gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="h-36 animate-pulse rounded-[18px] bg-black/6 sm:h-56 sm:rounded-[24px]" />
        <div className="h-36 animate-pulse rounded-[18px] bg-black/6 sm:h-56 sm:rounded-[24px]" />
      </div>
    </div>
  );
}

function DashboardErrorShell({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center">
      <div className="rounded-[34px] border border-white/70 bg-white/84 p-8 text-center shadow-[0_24px_70px_rgba(107,92,67,0.12)]">
        <AlertCircle className="mx-auto h-11 w-11 text-apple-red" />
        <h2 className="mt-4 text-2xl font-black text-text-primary">雅思总览暂时不可用</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-7 text-text-secondary">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-apple-blue px-5 py-3 text-sm font-black text-white shadow-[0_16px_34px_rgba(25,200,185,0.22)]"
        >
          重新读取
        </button>
      </div>
    </div>
  );
}

function CapabilityBadge({
  icon: Icon,
  title,
  subtitle,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  accent: Accent;
}) {
  const classes = ACCENT_CLASSES[accent];
  return (
    <div className="flex min-h-[62px] min-w-[186px] items-center gap-3 rounded-[18px] border border-white/72 bg-white/70 px-3.5 py-2.5 shadow-[0_10px_24px_rgba(107,92,67,0.06)]">
      <div className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]', classes.icon)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className={cx('text-[13px] font-black leading-5', classes.title)}>{title}</p>
        <p className="mt-0.5 text-[11px] font-bold leading-4 text-text-secondary">{subtitle}</p>
      </div>
    </div>
  );
}

function TargetScorePicker({
  value,
  isSaving,
  error,
  onChange,
}: {
  value: IeltsTargetScore;
  isSaving: boolean;
  error: string;
  onChange: (score: IeltsTargetScore) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wheelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const selectedElement = wheelRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    selectedElement?.scrollIntoView({ block: 'center' });
  }, [isOpen, value]);

  const handleSelect = async (score: IeltsTargetScore) => {
    if (isSaving) return;

    if (score === value) {
      setIsOpen(false);
      return;
    }

    try {
      await onChange(score);
      setIsOpen(false);
    } catch {
      // The inline error below is set by the parent save handler.
    }
  };

  return (
    <div ref={rootRef} className="relative flex min-h-[124px] min-w-0 px-2 sm:min-h-[134px] sm:px-3">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="group flex h-full w-full flex-col rounded-[18px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-apple-blue/35"
      >
        <div className="flex h-8 items-start gap-1.5 text-text-secondary sm:gap-2">
          <Target className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          <p className="min-w-0 text-[10px] font-black leading-4 sm:text-xs">目标分数</p>
        </div>
        <div className="flex min-h-[58px] flex-1 items-center">
          <p className="text-[28px] font-black leading-none tracking-tight text-[#2d2a2a] sm:text-[38px] xl:text-[42px]">
            {formatBand(value)}
            <span className="ml-1 text-xs text-text-secondary sm:text-base">分</span>
          </p>
        </div>
        <p
          className={cx(
            'min-h-8 text-[10px] font-bold leading-4 sm:text-xs',
            error ? 'text-apple-red' : 'text-text-secondary',
          )}
        >
          {error || (isSaving ? '保存中...' : '点击修改目标分数')}
        </p>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[216px] overflow-hidden rounded-[24px] border border-[#eadfce] bg-[#fffaf0]/98 p-3 shadow-[0_22px_46px_rgba(83,65,37,0.16)] backdrop-blur sm:w-[238px]">
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-xs font-black text-text-primary">调整目标分</p>
            {isSaving && <p className="text-[10px] font-black text-text-secondary">保存中</p>}
          </div>

          <div className="relative overflow-hidden rounded-[20px] bg-white/56">
            <div className="pointer-events-none absolute inset-x-2 top-1/2 z-10 h-11 -translate-y-1/2 rounded-[18px] border border-apple-blue/20 bg-apple-blue/10" />
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-12 bg-gradient-to-b from-[#fffaf0] to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-12 bg-gradient-to-t from-[#fffaf0] to-transparent" />
            <div
              ref={wheelRef}
              role="listbox"
              aria-label="雅思目标分"
              className="relative z-30 max-h-[172px] snap-y snap-mandatory overflow-y-auto overflow-x-hidden px-2 py-14 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0"
            >
              {IELTS_TARGET_SCORE_OPTIONS.map((score) => {
                const isSelected = score === value;
                return (
                  <button
                    key={score}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected ? 'true' : undefined}
                    disabled={isSaving}
                    onClick={() => void handleSelect(score)}
                    className={cx(
                      'flex h-11 w-full snap-center items-center justify-center rounded-[16px] text-xl font-black transition-all disabled:cursor-wait',
                      isSelected ? 'scale-110 text-[#2d2a2a]' : 'text-text-secondary/62 hover:text-text-primary',
                    )}
                  >
                    {formatBand(score)}
                    <span className="ml-1 text-xs font-black text-text-secondary">分</span>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="px-1 pt-2 text-[10px] font-bold leading-4 text-text-secondary">
            上下滚动选择目标分，点击当前行保存。
          </p>
        </div>
      )}
    </div>
  );
}

function StatsPanel({
  model,
  targetScore,
  isTargetScoreSaving,
  targetScoreError,
  onTargetScoreChange,
}: {
  model: IeltsDashboardModel;
  targetScore: IeltsTargetScore;
  isTargetScoreSaving: boolean;
  targetScoreError: string;
  onTargetScoreChange: (score: IeltsTargetScore) => Promise<void>;
}) {
  const currentBandLabel = model.currentBand === null ? '--' : formatBand(model.currentBand);
  const gapLabel = model.currentBand === null ? '完成练习后生成' : '正确率 × 9，仅作练习参考';
  const ringStyle = {
    '--ielts-progress': `${model.overallProgressPercent * 3.6}deg`,
  } as CSSProperties;

  return (
    <section className="rounded-[18px] border border-[#eadfce] bg-[#fffaf0]/78 p-3 shadow-[0_10px_26px_rgba(107,92,67,0.07)] sm:rounded-[24px] sm:p-4 sm:shadow-[0_14px_34px_rgba(107,92,67,0.07)]">
      <div className="grid grid-cols-3 divide-x divide-[#e5d8c6]">
        <TargetScorePicker
          value={targetScore}
          isSaving={isTargetScoreSaving}
          error={targetScoreError}
          onChange={onTargetScoreChange}
        />
        <div className="flex min-h-[124px] min-w-0 flex-col px-3 sm:min-h-[134px] sm:px-4">
          <div className="flex h-8 items-start gap-1.5 text-text-secondary sm:gap-2">
            <BarChart3 className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <p className="min-w-0 text-[10px] font-black leading-4 sm:text-xs">练习参考值</p>
          </div>
          <div className="flex min-h-[58px] flex-1 items-center">
            <p className="text-[28px] font-black leading-none tracking-tight text-[#2d2a2a] sm:text-[38px] xl:text-[42px]">
              {currentBandLabel}
              <span className="ml-1 text-xs text-text-secondary sm:text-base">
                {model.currentBand === null ? '' : '分'}
              </span>
            </p>
          </div>
          <p className="min-h-8 text-[10px] font-bold leading-4 text-text-secondary sm:text-xs">{gapLabel}</p>
        </div>
        <div className="flex min-h-[124px] min-w-0 flex-col px-2 sm:min-h-[134px] sm:px-3">
          <div className="flex h-8 items-start justify-center gap-1.5 text-text-secondary sm:gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <p className="min-w-0 text-[10px] font-black leading-4 sm:text-xs">学习进度</p>
          </div>
          <div className="flex min-h-[58px] flex-1 items-center justify-center">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[conic-gradient(#19c8b9_var(--ielts-progress),rgba(18,25,43,0.08)_0deg)] p-1.5 sm:h-20 sm:w-20 sm:p-1.5 xl:h-[86px] xl:w-[86px]"
              style={ringStyle}
              aria-label={`学习进度 ${model.overallProgressPercent}%`}
            >
              <div className="flex h-full w-full items-center justify-center rounded-full bg-[#fffaf0] text-base font-black text-[#2d2a2a] sm:text-xl">
                {model.overallProgressPercent}%
              </div>
            </div>
          </div>
          <div className="min-h-8 min-w-0 text-center">
            <p className="text-[10px] font-bold leading-4 text-text-secondary sm:text-xs">已完成</p>
            <p className="whitespace-nowrap text-[10px] font-black leading-4 text-text-secondary sm:text-xs sm:text-text-primary">
              {model.completedPracticeCount} / {model.availablePracticeCount} 练习
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PracticeModuleCard({
  config,
  model,
  onNavigate,
}: {
  config: ModuleCardConfig;
  model: IeltsDashboardModel;
  onNavigate: (route: string) => void;
}) {
  const classes = ACCENT_CLASSES[config.accent];
  const progress = getModuleProgress(model, config.key);
  const route = getModuleRoute(config.key);
  const isUnavailable = config.disabled || (progress?.totalTests ?? 0) === 0;
  const progressLabel = progress
    ? progress.totalTests > 0
      ? `进度 ${progress.progressPercent}% · ${progress.completedTests} / ${progress.totalTests} 套`
      : '暂无可用套题'
    : '功能开放后可练习';
  const secondaryLabel = progress
    ? progress.attemptCount > 0
      ? `${progress.attemptCount} 次练习记录`
      : progress.totalTests > 0
        ? `${progress.questionCount} 道真题待练`
        : '暂无可用题库'
    : '尚未开放';

  if (config.disabled) {
    return (
      <article className="rounded-[18px] border border-black/6 bg-white/58 p-3 sm:rounded-[24px] sm:p-4">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div
            className={cx(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] opacity-70 sm:h-11 sm:w-11 sm:rounded-[15px]',
              classes.icon,
            )}
          >
            <config.icon className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-black text-text-primary sm:text-base">{config.titleZh}</h3>
            <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-text-secondary sm:text-[11px]">
              {config.title}
            </p>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 text-[11px] font-bold leading-[18px] text-text-secondary sm:text-xs sm:leading-5">
          {config.description}
        </p>
        <span className="mt-3 inline-flex rounded-full bg-black/5 px-3 py-1.5 text-[10px] font-black text-text-secondary sm:text-[11px]">
          尚未开放
        </span>
      </article>
    );
  }

  return (
    <article className="rounded-[18px] border border-white/72 bg-white/82 p-3 shadow-[0_10px_24px_rgba(107,92,67,0.07)] sm:rounded-[24px] sm:p-4 sm:shadow-[0_14px_34px_rgba(107,92,67,0.07)]">
      <div className="flex items-start gap-2.5 sm:gap-3">
        <div
          className={cx(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] sm:h-12 sm:w-12 sm:rounded-[16px]',
            classes.icon,
          )}
        >
          <config.icon className="h-6 w-6 sm:h-7 sm:w-7" />
        </div>
        <div className="min-w-0">
          <h3 className={cx('truncate text-sm font-black leading-5 sm:text-base sm:leading-6', classes.title)}>
            {config.title}
          </h3>
          <p className="text-sm font-black leading-5 text-text-primary sm:text-[15px] sm:leading-5">{config.titleZh}</p>
        </div>
      </div>

      <p className="mt-3 min-h-[54px] text-[11px] font-bold leading-[18px] text-text-secondary sm:mt-4 sm:min-h-[40px] sm:text-xs sm:leading-5">
        {config.description}
      </p>

      <div className="mt-3 sm:mt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-black text-text-secondary sm:gap-x-3 sm:text-xs">
          <span>{progressLabel}</span>
          <span className="text-text-secondary/45">·</span>
          <span>{secondaryLabel}</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-[#efe9df] sm:mt-3 sm:h-2">
          <div
            className={cx('h-full rounded-full transition-all', isUnavailable ? 'bg-text-secondary/20' : classes.bar)}
            style={{ width: `${progress?.progressPercent ?? 0}%` }}
          />
        </div>
      </div>

      <button
        type="button"
        disabled={isUnavailable || !route}
        onClick={() => {
          if (route) onNavigate(route);
        }}
        className={cx(
          'mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-3 text-[12px] font-black transition-transform active:scale-[0.98] disabled:cursor-not-allowed sm:mt-4 sm:min-h-11 sm:gap-2.5 sm:px-4 sm:text-xs',
          isUnavailable
            ? config.disabled
              ? `${classes.button} opacity-55`
              : 'bg-[#eee7dc] text-text-secondary'
            : classes.button,
          (config.disabled || !isUnavailable) && classes.buttonShadow,
        )}
      >
        {isUnavailable ? (config.disabled ? '尚未开放' : '暂无套题') : config.actionLabel}
        {!isUnavailable && <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />}
      </button>
    </article>
  );
}

function RecentPracticePanel({
  model,
  onNavigate,
}: {
  model: IeltsDashboardModel;
  onNavigate: (route: string) => void;
}) {
  const recentAttempts = model.recentAttempts.slice(0, 3);
  const fallbackRoute =
    IELTS_LISTENING_ENABLED && recentAttempts[0]?.moduleKey === 'listening'
      ? '/app/ielts-listening'
      : '/app/ielts-reading';

  return (
    <section className="rounded-[18px] border border-white/72 bg-white/82 p-3 shadow-[0_10px_24px_rgba(107,92,67,0.07)] sm:rounded-[24px] sm:p-4 sm:shadow-[0_14px_34px_rgba(107,92,67,0.07)]">
      <div className="flex items-center justify-between gap-4 border-b border-black/6 pb-3 sm:pb-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <ClipboardList className="h-4 w-4 text-text-secondary sm:h-5 sm:w-5" />
          <h3 className="text-base font-black text-text-primary sm:text-lg">最近练习</h3>
        </div>
        {recentAttempts.length > 0 && (
          <button
            type="button"
            onClick={() => onNavigate(fallbackRoute)}
            className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-xs font-black text-text-secondary hover:bg-black/5 sm:min-h-10 sm:px-3 sm:text-sm"
          >
            查看全部
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {recentAttempts.length === 0 ? (
        <div className="mt-3 rounded-[16px] border border-dashed border-black/10 bg-white/52 p-4 text-xs font-bold leading-6 text-text-secondary sm:mt-5 sm:rounded-[24px] sm:p-6 sm:text-sm sm:leading-7">
          还没有完成过雅思阅读训练。完成第一套后，这里会显示得分、用时和复盘入口。
        </div>
      ) : (
        <div className="mt-1 divide-y divide-black/6 sm:mt-3">
          {recentAttempts.map((attempt) => {
            const Icon = attempt.moduleKey === 'reading' ? BookOpenCheck : Headphones;
            const iconClass = attempt.moduleKey === 'reading' ? ACCENT_CLASSES.teal.icon : ACCENT_CLASSES.amber.icon;
            const scoreClass = attempt.accuracyPercent >= 70 ? 'text-apple-blue' : 'text-apple-orange';

            return (
              <div key={attempt.id} className="flex items-center gap-3 py-3 sm:gap-4 sm:py-4">
                <div
                  className={cx(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] sm:h-14 sm:w-14 sm:rounded-[18px]',
                    iconClass,
                  )}
                >
                  <Icon className="h-5 w-5 sm:h-7 sm:w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black text-text-primary sm:text-sm">
                    剑{attempt.bookNumber} · Test {attempt.testNumber} · {attempt.moduleLabel}
                  </p>
                  <p className="mt-1 truncate text-[10px] font-bold text-text-secondary sm:text-xs">
                    完成时间：{formatDate(attempt.submittedAt)} · 用时 {formatElapsedTime(attempt.elapsedSeconds)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-bold text-text-secondary sm:text-xs">正确率</p>
                  <p className={cx('mt-1 text-sm font-black sm:text-lg', scoreClass)}>{attempt.accuracyPercent}%</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RecommendationPanel({
  model,
  onNavigate,
}: {
  model: IeltsDashboardModel;
  onNavigate: (route: string) => void;
}) {
  const recommendation = model.recommendation;
  const canStart = Boolean(recommendation.route);
  const accent = recommendation.moduleKey === 'listening' ? ACCENT_CLASSES.amber : ACCENT_CLASSES.teal;

  return (
    <section className="rounded-[18px] border border-white/72 bg-white/82 p-3 shadow-[0_10px_24px_rgba(107,92,67,0.07)] sm:rounded-[24px] sm:p-4 sm:shadow-[0_14px_34px_rgba(107,92,67,0.07)]">
      <div className="flex items-center gap-2 border-b border-black/6 pb-3 sm:gap-3 sm:pb-4">
        <Star className="h-4 w-4 text-text-secondary sm:h-5 sm:w-5" />
        <h3 className="text-base font-black text-text-primary sm:text-lg">推荐下一步</h3>
      </div>

      <div className="mt-3 rounded-[18px] border border-black/6 bg-white/72 p-3 sm:mt-4 sm:rounded-[20px] sm:p-4">
        <div className="flex items-center justify-between gap-3 md:gap-5">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <div className="flex h-[66px] w-[66px] shrink-0 items-center justify-center rounded-[20px] bg-apple-blue/10 text-apple-blue sm:h-20 sm:w-20 sm:rounded-[22px]">
              <Target className="h-10 w-10 sm:h-12 sm:w-12" />
            </div>
            <div className="min-w-0">
              <h4 className="line-clamp-2 text-sm font-black leading-5 text-text-primary sm:text-lg sm:leading-6">
                {recommendation.title}
              </h4>
              <p className="mt-1 line-clamp-2 text-[11px] font-bold leading-[18px] text-text-secondary sm:mt-2 sm:text-[13px] sm:leading-5">
                {recommendation.description}
              </p>
              {recommendation.estimatedMinutes && (
                <span className="mt-2 inline-flex rounded-full bg-apple-orange/12 px-2.5 py-1 text-[10px] font-black text-[#b58111] sm:mt-3 sm:px-3 sm:text-xs">
                  预计用时 {recommendation.estimatedMinutes} 分钟
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={!canStart}
            onClick={() => {
              if (recommendation.route) onNavigate(recommendation.route);
            }}
            className={cx(
              'inline-flex min-h-10 shrink-0 items-center justify-center gap-1 rounded-full px-4 text-xs font-black transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#eee7dc] disabled:text-text-secondary sm:min-h-11 sm:gap-2 sm:px-5 sm:text-[13px]',
              canStart && accent.button,
              canStart && accent.buttonShadow,
            )}
          >
            <span className="hidden sm:inline">{recommendation.ctaLabel}</span>
            <span className="sm:hidden">{recommendation.kind === 'none' ? '暂无' : '开始练习'}</span>
            {canStart && <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />}
          </button>
        </div>
      </div>

      <div className="mt-4 hidden flex-wrap gap-x-8 gap-y-3 text-sm font-bold text-text-secondary sm:flex">
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          为答题和复盘分别安排时间
        </span>
        <span className="inline-flex items-center gap-2">
          <Star className="h-4 w-4" />
          从练习记录回看错题
        </span>
        <span className="inline-flex items-center gap-2">
          <Clock3 className="h-4 w-4" />用 60 分钟限时阅读检查时间分配
        </span>
      </div>
    </section>
  );
}

function OverviewMetric({
  icon: Icon,
  label,
  value,
  unit,
  delta,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  delta: string;
}) {
  return (
    <div className="rounded-[16px] bg-white/62 px-3 py-4 text-center shadow-[0_8px_18px_rgba(107,92,67,0.04)] sm:rounded-[18px] sm:px-4 sm:py-3">
      <Icon className="mx-auto h-4 w-4 text-text-secondary sm:h-5 sm:w-5" />
      <p className="mt-3 text-[11px] font-bold text-text-secondary sm:text-xs">{label}</p>
      <p className="mt-2 text-2xl font-black leading-none text-[#2d2a2a] sm:text-3xl">
        {value}
        {unit && <span className="ml-1 text-xs text-text-secondary sm:text-sm">{unit}</span>}
      </p>
      <p className="mt-3 text-[10px] font-black text-apple-green sm:text-xs">{delta}</p>
    </div>
  );
}

function AccuracyTrendChart({ points }: { points: Array<number | null> }) {
  const validIndexes = points
    .map((point, index) => ({ point, index }))
    .filter((entry): entry is { point: number; index: number } => typeof entry.point === 'number');
  const chartPoints = validIndexes.map(({ point, index }) => {
    const x = 14 + index * 36;
    const y = 86 - (point / 100) * 62;
    return { x, y };
  });
  const line = chartPoints.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <div className="rounded-[16px] bg-white/54 p-3 sm:rounded-[18px] sm:p-4">
      <p className="text-[11px] font-black text-text-primary sm:text-[13px]">正确率趋势（近 4 次）</p>
      <div className="mt-2 h-28 sm:h-24">
        {chartPoints.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-[14px] border border-dashed border-black/10 text-[11px] font-bold text-text-secondary">
            完成练习后生成趋势
          </div>
        ) : (
          <svg viewBox="0 0 130 100" role="img" aria-label="近四次练习正确率趋势" className="h-full w-full">
            <line x1="12" y1="24" x2="124" y2="24" stroke="rgba(114,93,66,0.12)" strokeWidth="1" />
            <line x1="12" y1="55" x2="124" y2="55" stroke="rgba(114,93,66,0.12)" strokeWidth="1" />
            <line x1="12" y1="86" x2="124" y2="86" stroke="rgba(114,93,66,0.12)" strokeWidth="1" />
            {chartPoints.length > 1 && (
              <polyline points={line} fill="none" stroke="#19c8b9" strokeWidth="4" strokeLinecap="round" />
            )}
            {chartPoints.map((point) => (
              <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="4.5" fill="#19c8b9" />
            ))}
            {['W1', 'W2', 'W3', 'W4'].map((label, index) => (
              <text key={label} x={14 + index * 36} y="98" textAnchor="middle" fontSize="8" fill="#9f927d">
                {label}
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

function LearningDataPanel({ model }: { model: IeltsDashboardModel }) {
  const overview = buildDashboardOverview(model);
  const accuracyValue =
    overview.averageAccuracyPercent === null ? '--' : String(Math.round(overview.averageAccuracyPercent));
  const averageHoursValue = overview.averageHours === null ? '--' : overview.averageHours.toFixed(1);

  return (
    <section className="rounded-[18px] border border-white/72 bg-white/82 p-3 shadow-[0_10px_24px_rgba(107,92,67,0.07)] sm:rounded-[24px] sm:p-4 sm:shadow-[0_14px_34px_rgba(107,92,67,0.07)]">
      <div className="flex items-center gap-2 pb-3 sm:gap-3 sm:pb-4">
        <BarChart3 className="h-4 w-4 text-text-secondary sm:h-5 sm:w-5" />
        <h3 className="text-base font-black text-text-primary sm:text-lg">学习数据概览</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <OverviewMetric
            icon={CalendarDays}
            label="练习天数"
            value={String(overview.practiceDays)}
            unit="天"
            delta={formatOverviewDelta(overview.practiceDaysDelta)}
          />
          <OverviewMetric
            icon={Target}
            label="平均正确率"
            value={accuracyValue}
            unit={overview.averageAccuracyPercent === null ? undefined : '%'}
            delta={formatOverviewDelta(overview.accuracyDelta, '%')}
          />
          <OverviewMetric
            icon={Clock3}
            label="平均每次时长"
            value={averageHoursValue}
            unit={overview.averageHours === null ? undefined : '小时'}
            delta={formatOverviewDelta(overview.hoursDelta, 'h')}
          />
        </div>
        <AccuracyTrendChart points={overview.trendPoints} />
      </div>
    </section>
  );
}

function StudyAdvicePanel() {
  const advice = [
    '根据可用时间选择套题，预留答题与复盘时间。',
    '从练习记录回看错题，对照原文检查答题依据。',
    '需要模拟考试时，可选择 60 分钟限时阅读。',
  ];

  return (
    <section className="rounded-[18px] border border-white/72 bg-white/82 p-3 shadow-[0_10px_24px_rgba(107,92,67,0.07)] sm:rounded-[24px] sm:p-4 sm:shadow-[0_14px_34px_rgba(107,92,67,0.07)]">
      <div className="flex items-center gap-2 pb-2 sm:gap-3 sm:pb-3">
        <Sparkles className="h-4 w-4 text-text-secondary sm:h-5 sm:w-5" />
        <h3 className="text-base font-black text-text-primary sm:text-lg">学习建议</h3>
      </div>
      <div className="divide-y divide-black/6">
        {advice.map((item) => (
          <div key={item} className="flex items-center gap-3 py-3 text-xs font-bold text-text-secondary sm:text-sm">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-text-secondary/70 sm:h-4 sm:w-4" />
            <span className="min-w-0 flex-1">{item}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-text-secondary/70" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function IeltsHomeView() {
  const navigate = useNavigate();
  const { user, isAuthLoading } = useAuth();
  const userId = user?.id ?? null;
  const {
    preferences,
    isLoading: isPreferencesLoading,
    loadError,
    savePreferences,
    reloadPreferences,
  } = useLearningPreferences();
  const [dashboardData, setDashboardData] = useState<DashboardData>(EMPTY_DASHBOARD_DATA);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isTargetScoreSaving, setIsTargetScoreSaving] = useState(false);
  const [targetScoreError, setTargetScoreError] = useState('');

  const loadDashboard = useCallback(async () => {
    if (!userId) {
      setDashboardData(EMPTY_DASHBOARD_DATA);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    try {
      const [readingBooks, listeningBooks, readingAttempts, listeningAttempts] = await Promise.all([
        fetchIeltsReadingBooks(),
        IELTS_LISTENING_ENABLED ? fetchIeltsListeningBooks() : Promise.resolve([]),
        fetchRecentIeltsReadingAttempts(userId, { limit: null }),
        IELTS_LISTENING_ENABLED ? fetchRecentIeltsListeningAttempts(userId, { limit: null }) : Promise.resolve([]),
      ]);
      setDashboardData({ readingBooks, listeningBooks, readingAttempts, listeningAttempts });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (isAuthLoading) return;
    void loadDashboard();
  }, [isAuthLoading, loadDashboard]);

  const model = useMemo(
    () =>
      buildIeltsDashboardModel({
        ...dashboardData,
        targetScore: preferences.ieltsTargetScore,
      }),
    [dashboardData, preferences.ieltsTargetScore],
  );

  const handleTargetScoreChange = useCallback(
    async (score: IeltsTargetScore) => {
      if (score === preferences.ieltsTargetScore) return;

      setIsTargetScoreSaving(true);
      setTargetScoreError('');
      try {
        await savePreferences({ ieltsTargetScore: score });
      } catch (error) {
        const message = error instanceof Error ? error.message : '目标分保存失败';
        setTargetScoreError(message);
        throw error;
      } finally {
        setIsTargetScoreSaving(false);
      }
    },
    [preferences.ieltsTargetScore, savePreferences],
  );

  if (isAuthLoading || isLoading || isPreferencesLoading) return <DashboardLoadingShell />;

  const blockingPreferencesError = loadError && !targetScoreError && !isTargetScoreSaving;

  if (errorMsg || blockingPreferencesError) {
    return (
      <DashboardErrorShell
        message={errorMsg || loadError}
        onRetry={() => {
          setTargetScoreError('');
          void reloadPreferences();
          void loadDashboard();
        }}
      />
    );
  }

  return (
    <div className="-mx-3 w-[calc(100%+1.5rem)] max-w-[1480px] overflow-x-clip rounded-none border-0 bg-transparent p-0 shadow-none sm:mx-auto sm:w-full">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(430px,0.38fr)] xl:items-center xl:gap-7">
        <header>
          <h2 className="text-[28px] font-black leading-tight tracking-tight text-text-primary sm:text-4xl xl:text-[42px]">
            剑桥雅思真题训练
          </h2>
          <p className="mt-2 max-w-3xl text-xs font-bold leading-6 text-text-secondary sm:mt-3 sm:text-sm sm:leading-7">
            选择套题开始练习，提交后查看答案、正确率和用时。
          </p>
          <div className="mt-6 hidden flex-wrap gap-3 sm:flex">
            <CapabilityBadge icon={Target} title="套题练习" subtitle="按剑桥分册选择" accent="teal" />
            <CapabilityBadge icon={BarChart3} title="题型统计" subtitle="查看各题型正确率" accent="amber" />
            <CapabilityBadge icon={Sparkles} title="练习记录" subtitle="查看得分与用时" accent="violet" />
          </div>
        </header>

        <StatsPanel
          model={model}
          targetScore={preferences.ieltsTargetScore}
          isTargetScoreSaving={isTargetScoreSaving}
          targetScoreError={targetScoreError}
          onTargetScoreChange={handleTargetScoreChange}
        />
      </div>

      <section className="mt-3 grid grid-cols-2 gap-3 sm:mt-7 sm:gap-4 xl:grid-cols-4">
        {MODULE_CARD_CONFIGS.map((config) => (
          <PracticeModuleCard key={config.key} config={config} model={model} onNavigate={navigate} />
        ))}
      </section>

      <div className="mt-3 grid gap-3 sm:mt-5 sm:gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <RecentPracticePanel model={model} onNavigate={navigate} />
        <RecommendationPanel model={model} onNavigate={navigate} />
      </div>

      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <LearningDataPanel model={model} />
        <StudyAdvicePanel />
      </div>
    </div>
  );
}
