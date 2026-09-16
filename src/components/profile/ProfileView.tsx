import { useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Activity, CalendarDays, CheckCircle2, Flame, LogOut, TrendingUp } from 'lucide-react';
import type { ActivityDay, UserStats } from '../../types';
import { cx } from '../shared/LearningUI';

type TrendRange = 7 | 14 | 30;

interface ProfileViewProps {
  user: User | null;
  stats: UserStats;
  onSignOut: () => void;
}

const trendRanges: { label: string; value: TrendRange }[] = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 14 天', value: 14 },
  { label: '最近 30 天', value: 30 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function toDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addUtcDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function formatMonthDay(dateKey: string) {
  const date = parseDateKey(dateKey);
  return `${date.getUTCMonth() + 1}.${date.getUTCDate()}`;
}

function formatMonthLabel(dateKey: string) {
  return `${parseDateKey(dateKey).getUTCMonth() + 1}月`;
}

function totalActivity(day: ActivityDay) {
  return day.learnedWordCount + day.reviewWordCount;
}

function getActivityTone(total: number) {
  if (total <= 0) return 'bg-[#ebedf0] border-black/[0.04]';
  if (total < 5) return 'bg-[#9be9a8] border-[#78d68b]';
  if (total < 15) return 'bg-[#40c463] border-[#2fb552]';
  if (total < 30) return 'bg-[#30a14e] border-[#2a9046]';
  return 'bg-[#216e39] border-[#1d5f32]';
}

function getFallbackActivityDays(days: ActivityDay[]) {
  if (days.length > 0) return days;

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0));
  return Array.from({ length: 365 }, (_, index) => {
    const date = addUtcDays(todayUtc, index - 364);
    const dateKey = toDateKey(date);
    return {
      date: dateKey,
      weekdayLabel: '',
      shortDateLabel: formatMonthDay(dateKey),
      status: 'gap' as const,
      reviewWordCount: 0,
      learnedWordCount: 0,
      attemptCount: 0,
      correctAttemptCount: 0,
      accuracy: null,
    };
  });
}

function buildHeatmapWeeks(days: ActivityDay[]): (ActivityDay | null)[][] {
  const normalizedDays = getFallbackActivityDays(days);
  const dayByDate = new Map<string, ActivityDay>(normalizedDays.map((day): [string, ActivityDay] => [day.date, day]));
  const firstDate = parseDateKey(normalizedDays[0].date);
  const lastDate = parseDateKey(normalizedDays[normalizedDays.length - 1].date);
  const mondayIndex = (firstDate.getUTCDay() + 6) % 7;
  const gridStart = addUtcDays(firstDate, -mondayIndex);
  const totalGridDays = Math.floor((lastDate.getTime() - gridStart.getTime()) / DAY_MS) + 1;
  const weekCount = Math.ceil(totalGridDays / 7);

  return Array.from({ length: weekCount }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => {
      const date = addUtcDays(gridStart, weekIndex * 7 + dayIndex);
      return dayByDate.get(toDateKey(date)) ?? null;
    }),
  );
}

function summarizeActivity(days: ActivityDay[]) {
  return days.reduce(
    (summary, day) => {
      const total = totalActivity(day);
      if (total > 0 || day.status !== 'gap') {
        summary.activeDays += 1;
      }
      summary.learned += day.learnedWordCount;
      summary.reviewed += day.reviewWordCount;
      summary.attempts += day.attemptCount;
      summary.correct += day.correctAttemptCount;
      return summary;
    },
    { activeDays: 0, learned: 0, reviewed: 0, attempts: 0, correct: 0 },
  );
}

function TrendChart({ days }: { days: ActivityDay[] }) {
  const chartWidth = days.length > 14 ? 900 : 720;
  const chartHeight = 260;
  const left = 42;
  const right = 56;
  const top = 28;
  const bottom = 44;
  const innerWidth = chartWidth - left - right;
  const innerHeight = chartHeight - top - bottom;
  const maxTotal = Math.max(1, ...days.map(totalActivity));
  const step = innerWidth / days.length;
  const barWidth = Math.max(8, Math.min(22, step * 0.54));
  const labelEvery = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 5;
  const accuracyPoints = days
    .map((day, index) => {
      if (day.accuracy === null) return null;
      return {
        x: left + index * step + step / 2,
        y: top + ((100 - day.accuracy) / 100) * innerHeight,
      };
    })
    .filter((point): point is { x: number; y: number } => point !== null);
  const accuracyPath = accuracyPoints.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');

  return (
    <div className="overflow-x-auto pb-2">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="h-[260px] min-w-[720px]"
        style={{ width: chartWidth }}
        role="img"
        aria-label="每日学习趋势"
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = top + ratio * innerHeight;
          return (
            <g key={ratio}>
              <line x1={left} x2={chartWidth - right} y1={y} y2={y} stroke="rgba(47,38,29,0.08)" strokeWidth="1" />
              <text x={left - 10} y={y + 4} textAnchor="end" className="fill-[#8b7a66] text-[11px] font-bold">
                {Math.round(maxTotal * (1 - ratio))}
              </text>
            </g>
          );
        })}

        {days.map((day, index) => {
          const x = left + index * step + (step - barWidth) / 2;
          const reviewHeight = (day.reviewWordCount / maxTotal) * innerHeight;
          const learnedHeight = (day.learnedWordCount / maxTotal) * innerHeight;
          const learnedY = top + innerHeight - learnedHeight;
          const reviewY = learnedY - reviewHeight;
          const shouldLabel = index % labelEvery === 0 || index === days.length - 1;

          return (
            <g key={day.date}>
              <rect x={x} y={reviewY} width={barWidth} height={reviewHeight} rx="4" fill="#34C759">
                <title>{`${day.date} 复习 ${day.reviewWordCount} 词`}</title>
              </rect>
              <rect x={x} y={learnedY} width={barWidth} height={learnedHeight} rx="4" fill="#007AFF">
                <title>{`${day.date} 新学 ${day.learnedWordCount} 词`}</title>
              </rect>
              {shouldLabel && (
                <text
                  x={left + index * step + step / 2}
                  y={chartHeight - 15}
                  textAnchor="middle"
                  className="fill-[#8b7a66] text-[11px] font-bold"
                >
                  {formatMonthDay(day.date)}
                </text>
              )}
            </g>
          );
        })}

        {accuracyPoints.length > 1 && (
          <polyline
            points={accuracyPath}
            fill="none"
            stroke="#FF9500"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {accuracyPoints.map((point) => (
          <circle
            key={`${point.x}:${point.y}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="#FF9500"
            stroke="white"
            strokeWidth="2"
          />
        ))}
        <text x={chartWidth - right + 10} y={top + 4} className="fill-[#c06d00] text-[11px] font-black">
          100%
        </text>
        <text x={chartWidth - right + 10} y={top + innerHeight + 4} className="fill-[#c06d00] text-[11px] font-black">
          0%
        </text>
      </svg>
    </div>
  );
}

function ActivityHeatmap({ days }: { days: ActivityDay[] }) {
  const weeks = useMemo(() => buildHeatmapWeeks(days), [days]);
  const monthLabels = weeks.map((week, index) => {
    const firstVisibleDay = week.find((day) => day !== null);
    if (!firstVisibleDay) return '';
    const parsed = parseDateKey(firstVisibleDay.date);
    return parsed.getUTCDate() <= 7 || index === 0 ? formatMonthLabel(firstVisibleDay.date) : '';
  });

  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-max">
        <div className="ml-8 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks.length}, 12px)` }}>
          {monthLabels.map((label, index) => (
            <div key={`${label}:${index}`} className="h-4 text-[10px] font-bold text-[#8b7a66]">
              {label}
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <div className="grid w-6 grid-rows-7 gap-[3px] text-[10px] font-bold text-[#8b7a66]">
            <span />
            <span>二</span>
            <span />
            <span>四</span>
            <span />
            <span>六</span>
            <span />
          </div>
          <div
            className="grid grid-flow-col gap-[3px]"
            style={{
              gridTemplateColumns: `repeat(${weeks.length}, 12px)`,
              gridTemplateRows: 'repeat(7, 12px)',
            }}
          >
            {weeks.flatMap((week, weekIndex) =>
              week.map((day, dayIndex) => (
                <div
                  key={`${weekIndex}:${dayIndex}:${day?.date ?? 'empty'}`}
                  className={cx(
                    'h-3 w-3 rounded-[3px] border',
                    day ? getActivityTone(totalActivity(day)) : 'border-transparent bg-transparent',
                  )}
                  title={
                    day
                      ? `${day.date} · 新学 ${day.learnedWordCount} · 复习 ${day.reviewWordCount} · 正确率 ${day.accuracy ?? '--'}%`
                      : undefined
                  }
                />
              )),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricPill({ icon: Icon, label, value }: { icon: typeof Flame; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-black/[0.04] bg-white/60 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.04] text-[#2f261d]">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#8b7a66]">{label}</p>
          <p className="mt-1 text-2xl font-black tracking-tight text-[#2f261d]">{value}</p>
        </div>
      </div>
    </div>
  );
}

export function ProfileView({ user, stats, onSignOut }: ProfileViewProps) {
  const [trendRange, setTrendRange] = useState<TrendRange>(14);
  const activityDays = useMemo(() => getFallbackActivityDays(stats.activityDays), [stats.activityDays]);
  const trendDays = useMemo(() => activityDays.slice(-trendRange), [activityDays, trendRange]);
  const yearlySummary = useMemo(() => summarizeActivity(activityDays), [activityDays]);
  const trendSummary = useMemo(() => summarizeActivity(trendDays), [trendDays]);
  const yearlyAccuracy =
    yearlySummary.attempts > 0 ? Math.round((yearlySummary.correct / yearlySummary.attempts) * 100) : null;
  const trendAccuracy =
    trendSummary.attempts > 0 ? Math.round((trendSummary.correct / trendSummary.attempts) * 100) : null;
  const hasLearningActivity =
    yearlySummary.activeDays > 0 ||
    yearlySummary.learned > 0 ||
    yearlySummary.reviewed > 0 ||
    yearlySummary.attempts > 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricPill icon={Flame} label="连续学习" value={`${stats.streak} 天`} />
        <MetricPill icon={CalendarDays} label="年度学习" value={`${yearlySummary.activeDays} 天`} />
        <MetricPill icon={Activity} label="新学单词" value={`${yearlySummary.learned}`} />
        <MetricPill
          icon={CheckCircle2}
          label="年度正确率"
          value={yearlyAccuracy === null ? '--' : `${yearlyAccuracy}%`}
        />
      </section>

      {!hasLearningActivity ? (
        <section className="glass px-6 py-14 text-center md:px-10 md:py-20">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-apple-blue">Learning record</p>
          <h3 className="mt-3 text-2xl font-black tracking-tight text-text-primary">暂无学习记录</h3>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-text-secondary">
            完成学习后，可查看每日新学词数、复习词数、正确率与年度学习记录。
          </p>
        </section>
      ) : (
        <>
          <section className="glass rounded-[34px] p-5 md:p-7">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-apple-blue">Learning Trend</p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-text-primary">每日学习趋势</h3>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-2xl bg-white/70 px-4 py-3 text-sm font-black text-[#2f261d]">
                  <TrendingUp className="h-4 w-4 text-apple-orange" />
                  {trendAccuracy === null ? '正确率 --' : `正确率 ${trendAccuracy}%`}
                </div>
                <select
                  value={trendRange}
                  onChange={(event) => setTrendRange(Number(event.target.value) as TrendRange)}
                  className="rounded-2xl border border-black/[0.06] bg-white/80 px-4 py-3 text-sm font-black text-[#2f261d] outline-none transition-colors focus:border-apple-blue/40"
                >
                  {trendRanges.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] bg-white/55 p-4">
                <p className="text-xs font-black text-text-secondary">新学</p>
                <p className="mt-1 text-2xl font-black text-apple-blue">{trendSummary.learned}</p>
              </div>
              <div className="rounded-[22px] bg-white/55 p-4">
                <p className="text-xs font-black text-text-secondary">复习</p>
                <p className="mt-1 text-2xl font-black text-apple-green">{trendSummary.reviewed}</p>
              </div>
              <div className="rounded-[22px] bg-white/55 p-4">
                <p className="text-xs font-black text-text-secondary">作答</p>
                <p className="mt-1 text-2xl font-black text-apple-orange">{trendSummary.attempts}</p>
              </div>
            </div>

            <div className="mt-5 rounded-[28px] border border-black/[0.04] bg-white/58 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-4 text-xs font-black text-text-secondary">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-apple-blue" />
                  新学
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-apple-green" />
                  复习
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-apple-orange" />
                  正确率
                </span>
              </div>
              <TrendChart days={trendDays} />
            </div>
          </section>

          <section className="glass rounded-[34px] p-5 md:p-7">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-apple-green">Activity Heatmap</p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-text-primary">年度学习记录</h3>
              </div>
              <div className="flex items-center gap-2 text-xs font-black text-text-secondary">
                <span>少</span>
                {[0, 2, 8, 20, 35].map((value) => (
                  <span key={value} className={cx('h-3 w-3 rounded-[3px] border', getActivityTone(value))} />
                ))}
                <span>多</span>
              </div>
            </div>
            <div className="mt-6 rounded-[28px] border border-black/[0.04] bg-white/58 p-4">
              <ActivityHeatmap days={activityDays} />
            </div>
          </section>
        </>
      )}

      <section className="glass relative overflow-hidden rounded-[36px] p-6 md:p-8">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex h-24 w-24 items-center justify-center rounded-[30px] bg-apple-blue text-4xl font-black text-white shadow-lg">
              {(user?.email?.[0] ?? 'L').toUpperCase()}
            </div>
            <h2 className="mt-6 text-4xl font-black text-text-primary prose-serif">
              {(user?.user_metadata.full_name as string | undefined) ?? '当前账号'}
            </h2>
            <p className="mt-3 text-base text-text-secondary">{user?.email ?? '邮箱暂不可用'}</p>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-apple-red/8 px-6 py-4 text-base font-black text-apple-red transition-all hover:bg-apple-red/12 active:scale-95"
          >
            退出当前账号
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </section>
    </div>
  );
}
