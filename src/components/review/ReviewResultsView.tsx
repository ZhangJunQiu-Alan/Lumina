import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, Trophy } from 'lucide-react';
import { MemoryState, ReviewSummaryItem } from '../../types';
import { IslandButton } from '../shared/AnimalPrimitives';

interface ReviewResultsViewProps {
  items: ReviewSummaryItem[];
  onBackHome: () => void;
}

const memoryStateLabel: Record<MemoryState, string> = {
  new: '新词',
  fuzzy: '待巩固',
  slow_recall: '回忆较慢',
  stable_recall: '回忆稳定',
  mastered: '已掌握',
};

export const ReviewResultsView = ({ items, onBackHome }: ReviewResultsViewProps) => {
  const getRank = (state: MemoryState | null) => {
    switch (state) {
      case 'new':
        return 0;
      case 'fuzzy':
        return 1;
      case 'slow_recall':
        return 2;
      case 'stable_recall':
        return 3;
      case 'mastered':
        return 4;
      default:
        return -1;
    }
  };

  const graduatedCount = items.filter((item) => item.transition.graduated).length;
  const upgradedCount = items.filter(
    (item) => !item.transition.graduated && getRank(item.transition.to) > getRank(item.transition.from),
  ).length;
  const downgradedCount = items.filter(
    (item) =>
      item.transition.from !== null &&
      !item.transition.graduated &&
      getRank(item.transition.to) < getRank(item.transition.from),
  ).length;
  const confirmedCount = items.filter(
    (item) => item.transition.from !== null && item.transition.from === item.transition.to,
  ).length;

  if (items.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-2xl">
        <div className="glass rounded-[28px] p-6 text-center jelly-shadow sm:p-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
            <Trophy className="h-7 w-7" />
          </div>
          <p className="mt-6 text-xs font-bold uppercase tracking-widest text-text-secondary">状态更新</p>
          <h2 className="mt-2 text-2xl font-black text-text-primary sm:text-3xl">暂无本轮结果</h2>
          <p className="mx-auto mt-3 max-w-md text-sm font-bold leading-6 text-text-secondary">
            完成一轮词汇学习或复习后，这里会展示每个词的记忆状态变化。
          </p>
          <IslandButton
            htmlType="button"
            onClick={onBackHome}
            tone="mint"
            size="large"
            icon={<ArrowRight className="h-5 w-5" />}
            className="mt-7"
          >
            回首页开始学习
          </IslandButton>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-4xl space-y-6"
    >
      <div className="glass rounded-[28px] p-6 jelly-shadow sm:p-10">
        <div className="flex items-start justify-between gap-4 sm:items-center sm:gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">状态更新</p>
            <h2 className="mt-2 text-3xl font-black">本轮已完成</h2>
            <p className="mt-3 text-sm text-text-secondary">
              共 {items.length} 词 · 状态提升 {upgradedCount} 个 · 状态保持 {confirmedCount} 个 · 状态下降{' '}
              {downgradedCount} 个 · 掌握 {graduatedCount} 个
            </p>
          </div>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-apple-green/10 text-apple-green sm:h-16 sm:w-16">
            <Trophy className="h-7 w-7 sm:h-8 sm:w-8" />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {items.map((item, index) => (
          <motion.div
            key={item.wordId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            className="glass flex flex-col gap-4 rounded-2xl p-5 jelly-shadow sm:flex-row sm:items-center sm:justify-between sm:p-6"
          >
            <div>
              <p className="text-xl font-black">{item.word}</p>
              <p className="mt-1 text-sm text-text-secondary">{item.chineseDefinition}</p>
            </div>

            {item.transition.from === item.transition.to ? (
              <div className="flex items-center gap-3 text-sm font-bold">
                <span className="rounded-full bg-apple-blue/10 px-3 py-1 text-apple-blue">
                  {memoryStateLabel[item.transition.to]}确认
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm font-bold">
                <span className="rounded-full bg-black/5 px-3 py-1 text-text-secondary">
                  {item.transition.from ? memoryStateLabel[item.transition.from] : '刚加入'}
                </span>
                <ArrowRight className="w-4 h-4 text-text-secondary" />
                <span
                  className={`rounded-full px-3 py-1 ${
                    item.transition.graduated
                      ? 'bg-apple-green/10 text-apple-green'
                      : 'bg-apple-blue/10 text-apple-blue'
                  }`}
                >
                  {memoryStateLabel[item.transition.to]}
                </span>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      <IslandButton
        htmlType="button"
        onClick={onBackHome}
        block
        tone="mint"
        size="large"
        icon={<CheckCircle2 className="w-5 h-5" />}
      >
        返回今日学习
      </IslandButton>
    </motion.div>
  );
};
