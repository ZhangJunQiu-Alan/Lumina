import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
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
  IeltsListeningAttemptSummary,
  IeltsListeningBookSummary,
  IeltsReadingAttemptSummary,
  IeltsReadingBookSummary,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import { fetchIeltsListeningBooks, fetchRecentIeltsListeningAttempts } from '../../lib/ieltsListeningApi';
import { fetchIeltsReadingBooks, fetchRecentIeltsReadingAttempts } from '../../lib/ieltsReadingApi';
import { formatElapsedTime } from '../../lib/ieltsReadingScoring';
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
    description: '3 篇文章、40 道题、60 分钟。提升阅读理解与快速定位能力。',
    actionLabel: '进入阅读训练',
    accent: 'teal',
  },
  {
    key: 'listening',
    icon: Headphones,
    title: 'Listening',
    titleZh: '听力',
    description: '4 个 Section、40 道题、30 分钟。提升听力理解与信息捕捉能力。',
    actionLabel: '进入听力训练',
    accent: 'amber',
  },
  {
    key: 'writing',
    icon: PenLine,
    title: 'Writing',
    titleZh: '写作',
    description: 'Task 1 + Task 2。AI 批改、结构反馈和表达提升即将开放。',
    actionLabel: '即将开放',
    accent: 'violet',
    disabled: true,
  },
  {
    key: 'speaking',
    icon: MessageCircle,
    title: 'Speaking',
    titleZh: '口语',
    description: '3 个 Part 全真模拟。AI 口语练习与发音反馈即将开放。',
    actionLabel: '即将开放',
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

function getModuleProgress(model: IeltsDashboardModel, key: DisplayModuleKey) {
  if (key === 'reading') return model.reading;
  if (key === 'listening') return model.listening;
  return null;
}

function getModuleRoute(key: DisplayModuleKey) {
  if (key === 'reading') return '/app/ielts-reading';
  if (key === 'listening') return '/app/ielts-listening';
  return null;
}

function DashboardLoadingShell() {
  return (
    <div className="mx-auto w-full max-w-[1480px] rounded-[34px] border border-white/70 bg-white/74 p-5 shadow-[0_24px_70px_rgba(107,92,67,0.10)] sm:p-8">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.42fr)]">
        <div className="space-y-5">
          <div className="h-4 w-44 animate-pulse rounded-full bg-black/8" />
          <div className="h-12 w-full max-w-xl animate-pulse rounded-[18px] bg-black/8" />
          <div className="h-5 w-full max-w-2xl animate-pulse rounded-full bg-black/7" />
          <div className="flex flex-wrap gap-4 pt-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-[76px] w-56 animate-pulse rounded-[22px] bg-black/6" />
            ))}
          </div>
        </div>
        <div className="h-[188px] animate-pulse rounded-[28px] bg-black/6" />
      </div>
      <div className="mt-9 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-[300px] animate-pulse rounded-[28px] bg-black/6" />
        ))}
      </div>
      <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="h-72 animate-pulse rounded-[28px] bg-black/6" />
        <div className="h-72 animate-pulse rounded-[28px] bg-black/6" />
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
    <div className="flex min-h-[76px] min-w-[218px] items-center gap-3 rounded-[22px] border border-white/72 bg-white/70 px-4 py-3 shadow-[0_12px_30px_rgba(107,92,67,0.07)]">
      <div className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px]', classes.icon)}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <p className={cx('text-sm font-black', classes.title)}>{title}</p>
        <p className="mt-0.5 text-xs font-bold text-text-secondary">{subtitle}</p>
      </div>
    </div>
  );
}

function StatsPanel({ model }: { model: IeltsDashboardModel }) {
  const currentBandLabel = model.currentBand === null ? '--' : formatBand(model.currentBand);
  const gapLabel =
    model.currentBand === null
      ? '完成一次练习后生成'
      : model.targetScore > model.currentBand
        ? `距目标分 ${formatBand(model.targetScore - model.currentBand)} 分`
        : '已达到当前目标';
  const ringStyle = {
    '--ielts-progress': `${model.overallProgressPercent * 3.6}deg`,
  } as CSSProperties;

  return (
    <section className="rounded-[28px] border border-[#eadfce] bg-[#fffaf0]/72 p-5 shadow-[0_18px_42px_rgba(107,92,67,0.08)]">
      <div className="grid gap-5 sm:grid-cols-3 sm:divide-x sm:divide-[#e5d8c6]">
        <div className="px-1 sm:px-4">
          <div className="flex items-center gap-2 text-text-secondary">
            <Target className="h-5 w-5" />
            <p className="text-sm font-black">目标分数</p>
          </div>
          <p className="mt-4 text-5xl font-black tracking-tight text-[#2d2a2a]">
            {formatBand(model.targetScore)}
            <span className="ml-2 text-lg text-text-secondary">分</span>
          </p>
          <p className="mt-4 text-sm font-bold text-text-secondary">冲刺高分</p>
        </div>
        <div className="px-1 sm:px-5">
          <div className="flex items-center gap-2 text-text-secondary">
            <BarChart3 className="h-5 w-5" />
            <p className="text-sm font-black">当前水平</p>
          </div>
          <p className="mt-4 text-5xl font-black tracking-tight text-[#2d2a2a]">
            {currentBandLabel}
            <span className="ml-2 text-lg text-text-secondary">{model.currentBand === null ? '' : '分'}</span>
          </p>
          <p className="mt-4 text-sm font-bold text-text-secondary">{gapLabel}</p>
        </div>
        <div className="px-1 sm:px-5">
          <div className="flex items-center gap-2 text-text-secondary">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-sm font-black">学习进度</p>
          </div>
          <div className="mt-3 flex items-center gap-5">
            <div
              className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-[conic-gradient(#19c8b9_var(--ielts-progress),rgba(18,25,43,0.08)_0deg)] p-2"
              style={ringStyle}
              aria-label={`学习进度 ${model.overallProgressPercent}%`}
            >
              <div className="flex h-full w-full items-center justify-center rounded-full bg-[#fffaf0] text-2xl font-black text-[#2d2a2a]">
                {model.overallProgressPercent}%
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-text-secondary">已完成</p>
              <p className="mt-2 text-sm font-black text-text-primary">
                {model.completedPracticeCount} / {model.availablePracticeCount} 练习
              </p>
            </div>
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
      : '题库导入后可练习'
    : '功能开放后可练习';
  const secondaryLabel = progress
    ? progress.attemptCount > 0
      ? `${progress.attemptCount} 次练习记录`
      : progress.totalTests > 0
        ? `${progress.questionCount} 道真题待练`
        : '暂无可用题库'
    : '即将开放';

  return (
    <article className="rounded-[28px] border border-white/72 bg-white/78 p-6 shadow-[0_18px_44px_rgba(107,92,67,0.08)]">
      <div className="flex items-start gap-4">
        <div className={cx('flex h-[66px] w-[66px] shrink-0 items-center justify-center rounded-[22px]', classes.icon)}>
          <config.icon className="h-9 w-9" />
        </div>
        <div className="min-w-0">
          <h3 className={cx('text-xl font-black leading-7', classes.title)}>{config.title}</h3>
          <p className="mt-1 text-lg font-black leading-6 text-text-primary">{config.titleZh}</p>
        </div>
      </div>

      <p className="mt-7 min-h-[52px] text-sm font-bold leading-7 text-text-secondary">{config.description}</p>

      <div className="mt-7">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-black text-text-secondary">
          <span>{progressLabel}</span>
          <span className="text-text-secondary/45">·</span>
          <span>{secondaryLabel}</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-[#efe9df]">
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
          'mt-7 flex min-h-14 w-full items-center justify-center gap-3 rounded-full px-5 text-sm font-black transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-58',
          isUnavailable ? 'bg-[#eee7dc] text-text-secondary' : classes.button,
          !isUnavailable && classes.buttonShadow,
        )}
      >
        {isUnavailable ? (config.disabled ? '即将开放' : '题库导入后开放') : config.actionLabel}
        {!isUnavailable && <ArrowRight className="h-5 w-5" />}
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
    recentAttempts[0]?.moduleKey === 'listening'
      ? '/app/ielts-listening'
      : model.reading.totalTests > 0
        ? '/app/ielts-reading'
        : '/app/ielts-listening';

  return (
    <section className="rounded-[28px] border border-white/72 bg-white/78 p-5 shadow-[0_18px_44px_rgba(107,92,67,0.08)]">
      <div className="flex items-center justify-between gap-4 border-b border-black/6 pb-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-5 w-5 text-text-secondary" />
          <h3 className="text-xl font-black text-text-primary">最近练习</h3>
        </div>
        {recentAttempts.length > 0 && (
          <button
            type="button"
            onClick={() => onNavigate(fallbackRoute)}
            className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-black text-text-secondary hover:bg-black/5"
          >
            查看全部
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {recentAttempts.length === 0 ? (
        <div className="mt-5 rounded-[24px] border border-dashed border-black/10 bg-white/52 p-6 text-sm font-bold leading-7 text-text-secondary">
          还没有完成过雅思阅读或听力训练。完成第一套后，这里会显示得分、用时和复盘入口。
        </div>
      ) : (
        <div className="mt-3 divide-y divide-black/6">
          {recentAttempts.map((attempt) => {
            const Icon = attempt.moduleKey === 'reading' ? BookOpenCheck : Headphones;
            const iconClass = attempt.moduleKey === 'reading' ? ACCENT_CLASSES.teal.icon : ACCENT_CLASSES.amber.icon;
            const scoreClass = attempt.accuracyPercent >= 70 ? 'text-apple-blue' : 'text-apple-orange';

            return (
              <div key={attempt.id} className="flex items-center gap-4 py-4">
                <div className={cx('flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px]', iconClass)}>
                  <Icon className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-text-primary">
                    剑{attempt.bookNumber} · Test {attempt.testNumber} · {attempt.moduleLabel}
                  </p>
                  <p className="mt-1 text-xs font-bold text-text-secondary">
                    完成时间：{formatDate(attempt.submittedAt)} · 用时 {formatElapsedTime(attempt.elapsedSeconds)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-bold text-text-secondary">正确率</p>
                  <p className={cx('mt-1 text-lg font-black', scoreClass)}>{attempt.accuracyPercent}%</p>
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
    <section className="rounded-[28px] border border-white/72 bg-white/78 p-5 shadow-[0_18px_44px_rgba(107,92,67,0.08)]">
      <div className="flex items-center gap-3 border-b border-black/6 pb-4">
        <Star className="h-5 w-5 text-text-secondary" />
        <h3 className="text-xl font-black text-text-primary">推荐下一步</h3>
      </div>

      <div className="mt-5 rounded-[24px] border border-black/6 bg-white/72 p-5">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[26px] bg-apple-blue/10 text-apple-blue">
              <Target className="h-14 w-14" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xl font-black leading-7 text-text-primary">{recommendation.title}</h4>
              <p className="mt-2 text-sm font-bold leading-6 text-text-secondary">{recommendation.description}</p>
              {recommendation.estimatedMinutes && (
                <span className="mt-3 inline-flex rounded-full bg-apple-orange/12 px-3 py-1 text-xs font-black text-[#b58111]">
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
              'inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full px-6 text-sm font-black transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#eee7dc] disabled:text-text-secondary',
              canStart && accent.button,
              canStart && accent.buttonShadow,
            )}
          >
            {recommendation.ctaLabel}
            {canStart && <ArrowRight className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm font-bold text-text-secondary">
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          每天至少完成 1 套真题练习
        </span>
        <span className="inline-flex items-center gap-2">
          <Star className="h-4 w-4" />
          错题本每周复盘，巩固薄弱点
        </span>
        <span className="inline-flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          口语练习建议每周 3 次以上
        </span>
      </div>
    </section>
  );
}

export function IeltsHomeView() {
  const navigate = useNavigate();
  const { user, isAuthLoading } = useAuth();
  const { preferences, isLoading: isPreferencesLoading, loadError, reloadPreferences } = useLearningPreferences();
  const [dashboardData, setDashboardData] = useState<DashboardData>(EMPTY_DASHBOARD_DATA);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const loadDashboard = useCallback(async () => {
    if (!user) {
      setDashboardData(EMPTY_DASHBOARD_DATA);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    try {
      const [readingBooks, listeningBooks, readingAttempts, listeningAttempts] = await Promise.all([
        fetchIeltsReadingBooks(),
        fetchIeltsListeningBooks(),
        fetchRecentIeltsReadingAttempts(user.id, { limit: null }),
        fetchRecentIeltsListeningAttempts(user.id, { limit: null }),
      ]);
      setDashboardData({ readingBooks, listeningBooks, readingAttempts, listeningAttempts });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [user]);

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

  if (isAuthLoading || isLoading || isPreferencesLoading) return <DashboardLoadingShell />;

  if (errorMsg || loadError) {
    return (
      <DashboardErrorShell
        message={errorMsg || loadError}
        onRetry={() => {
          void reloadPreferences();
          void loadDashboard();
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1480px] rounded-[34px] border border-white/74 bg-white/76 p-5 shadow-[0_24px_70px_rgba(107,92,67,0.10)] sm:p-8">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(430px,0.42fr)] xl:items-center">
        <header>
          <p className="text-xs font-black uppercase tracking-[0.36em] text-text-secondary">Cambridge IELTS</p>
          <h2 className="mt-4 text-4xl font-black leading-tight tracking-tight text-text-primary sm:text-5xl">
            剑桥雅思真题训练
          </h2>
          <p className="mt-4 max-w-3xl text-base font-bold leading-8 text-text-secondary">
            系统练习四大模块，熟悉考试题型与节奏，科学提升雅思能力。
          </p>
          <div className="mt-7 flex flex-wrap gap-4">
            <CapabilityBadge icon={Target} title="贴近真实" subtitle="剑桥 4-18 官方真题" accent="teal" />
            <CapabilityBadge icon={BarChart3} title="智能分析" subtitle="AI 批改与弱点诊断" accent="amber" />
            <CapabilityBadge icon={Sparkles} title="高效提分" subtitle="个性化学习路径" accent="violet" />
          </div>
        </header>

        <StatsPanel model={model} />
      </div>

      <section className="mt-9 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {MODULE_CARD_CONFIGS.map((config) => (
          <PracticeModuleCard key={config.key} config={config} model={model} onNavigate={navigate} />
        ))}
      </section>

      <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <RecentPracticePanel model={model} onNavigate={navigate} />
        <RecommendationPanel model={model} onNavigate={navigate} />
      </div>
    </div>
  );
}
