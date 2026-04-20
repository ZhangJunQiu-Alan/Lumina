import { motion } from 'motion/react';
import { ArrowRight, Calendar, CheckCircle2, Lock, RotateCcw, Trophy, Zap } from 'lucide-react';
import { UserStats } from '../../types';
import { LuminaLogo } from '../brand/LuminaLogo';
import { LEARNING_ROUND_LABELS } from '../../lib/learningSession';
import { StatCard } from './StatCard';

interface HomeViewProps {
  stats: UserStats;
  onStart: () => void;
  isLoading?: boolean;
}

const TodayPlan = ({
  reviewCount,
  reviewDone,
  hasResumeCandidate,
}: {
  reviewCount: number;
  reviewDone: boolean;
  hasResumeCandidate: boolean;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="glass rounded-apple-lg p-6 jelly-shadow"
    >
      <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-4">今天先走哪一步</p>
      <div className="flex items-center gap-3">
        {/* Step 1: Review */}
        <div
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-bold transition-colors ${
            reviewDone
              ? 'bg-apple-green/10 text-apple-green'
              : reviewCount > 0
              ? 'bg-apple-red/10 text-apple-red'
              : 'bg-apple-green/10 text-apple-green'
          }`}
        >
          {reviewDone || reviewCount === 0 ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <RotateCcw className="w-4 h-4" />
          )}
          {reviewDone || reviewCount === 0
            ? '到期的已经清掉'
            : `先处理 ${reviewCount} 个到期词`}
        </div>

        <ArrowRight className="w-4 h-4 text-text-secondary flex-shrink-0" />

        {/* Step 2: New session */}
        <div
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-bold transition-colors ${
            reviewDone || reviewCount === 0
              ? 'bg-apple-blue/10 text-apple-blue'
              : 'bg-black/5 text-text-secondary'
          }`}
        >
          {reviewDone || reviewCount === 0 ? (
            <Zap className="w-4 h-4" />
          ) : (
            <Lock className="w-4 h-4" />
          )}
          {hasResumeCandidate ? '接上上一组' : '开下一组'}
        </div>
      </div>
    </motion.div>
  );
};

export const HomeView = ({ stats, onStart, isLoading = false }: HomeViewProps) => {
  const reviewDone = stats.todayReviewCount === 0;
  const resumeCandidate = stats.resumeCandidate;
  const resumeCopy = resumeCandidate
    ? resumeCandidate.round === 'article'
      ? '文章巩固 · 接着上次继续'
      : `${LEARNING_ROUND_LABELS[resumeCandidate.round]} · 接着第 ${resumeCandidate.currentIndex + 1} 个词`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-4xl mx-auto space-y-6"
    >
      {/* Header */}
      <header className="flex justify-between items-start">
        <div>
          <LuminaLogo
            size={38}
            markClassName="h-10 w-10"
            wordmarkClassName="h-8 md:h-10"
          />
          <p className="text-text-secondary font-medium mt-1">今天先做什么，系统已经按记忆状态替你排好了。</p>
        </div>
        <div className="glass px-4 py-2 rounded-2xl flex items-center gap-2 jelly-shadow">
          <Calendar className="w-4 h-4 text-apple-orange" />
          <span className="text-sm font-bold">轨迹 {stats.streak} 天</span>
        </div>
      </header>

      {/* Today's Plan */}
      <TodayPlan
        reviewCount={stats.todayReviewCount}
        reviewDone={reviewDone}
        hasResumeCandidate={Boolean(resumeCandidate)}
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-5">
        <StatCard
          icon={RotateCcw}
          iconColor="text-apple-red"
          iconBg="bg-apple-red/10"
          value={stats.todayReviewCount}
          label="到期词"
          index={0}
        />
        <StatCard
          icon={Zap}
          iconColor="text-apple-blue"
          iconBg="bg-apple-blue/10"
          value={stats.todayNewGroups}
          label="今日推进"
          index={1}
        />
        <StatCard
          icon={Trophy}
          iconColor="text-apple-green"
          iconBg="bg-apple-green/10"
          value={stats.totalLearned}
          label="已稳定"
          index={2}
        />
      </div>

      {/* Primary CTA */}
      <motion.button
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        onClick={onStart}
        disabled={isLoading}
        className="w-full py-8 bg-apple-blue text-white rounded-apple-lg jelly-shadow flex flex-col items-center justify-center gap-2 group hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
      >
        <span className="text-2xl font-black flex items-center gap-3">
          {isLoading
            ? '正在接回今天这一轮'
            : stats.todayReviewCount > 0
            ? '先处理到期复习'
            : resumeCandidate
            ? '接上上一组'
            : '开始下一组'}
          <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
        </span>
        <span className="text-sm font-medium opacity-80">
          {stats.todayReviewCount > 0
            ? resumeCandidate
              ? `先把这 ${stats.todayReviewCount} 个到期词处理掉，再回到上次那组。`
              : `先把这 ${stats.todayReviewCount} 个到期词处理掉，后面系统再带你往前走。`
            : resumeCopy
            ? resumeCopy
            : '30 个词，3 轮判断，最后再用一段短文收口。'}
        </span>
      </motion.button>
    </motion.div>
  );
};
