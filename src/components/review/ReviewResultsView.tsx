import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, Trophy } from 'lucide-react';
import { MemoryState, ReviewSummaryItem } from '../../types';

interface ReviewResultsViewProps {
  items: ReviewSummaryItem[];
  onBackHome: () => void;
}

const memoryStateLabel: Record<MemoryState, string> = {
  new: '新词',
  fuzzy: '模糊',
  slow_recall: '慢回忆',
  stable_recall: '稳回忆',
  mastered: '掌握',
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
  const upgradedCount = items.filter((item) => (
    !item.transition.graduated
    && getRank(item.transition.to) > getRank(item.transition.from)
  )).length;
  const downgradedCount = items.filter((item) => (
    item.transition.from !== null
    && !item.transition.graduated
    && getRank(item.transition.to) < getRank(item.transition.from)
  )).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-4xl mx-auto space-y-6"
    >
      <div className="glass rounded-apple-lg p-10 jelly-shadow">
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">状态更新</p>
            <h2 className="mt-2 text-3xl font-black">这一轮已经判完了</h2>
            <p className="mt-3 text-sm text-text-secondary">
              一共过了 {items.length} 个词 · 更稳了 {upgradedCount} 个 · 还要再见 {downgradedCount} 个 · 可以先放下 {graduatedCount} 个
            </p>
          </div>
          <div className="w-16 h-16 rounded-2xl bg-apple-green/10 text-apple-green flex items-center justify-center">
            <Trophy className="w-8 h-8" />
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
            className="glass rounded-2xl p-6 jelly-shadow flex items-center justify-between gap-4"
          >
            <div>
              <p className="text-xl font-black">{item.word}</p>
              <p className="mt-1 text-sm text-text-secondary">{item.chineseDefinition}</p>
            </div>

            <div className="flex items-center gap-3 text-sm font-bold">
              <span className="rounded-full bg-black/5 px-3 py-1 text-text-secondary">
                {item.transition.from ? memoryStateLabel[item.transition.from] : '刚接进系统'}
              </span>
              <ArrowRight className="w-4 h-4 text-text-secondary" />
              <span className={`rounded-full px-3 py-1 ${
                item.transition.graduated
                  ? 'bg-apple-green/10 text-apple-green'
                  : 'bg-apple-blue/10 text-apple-blue'
              }`}>
                {memoryStateLabel[item.transition.to]}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      <button
        type="button"
        onClick={onBackHome}
        className="w-full py-5 bg-apple-blue text-white font-black text-lg rounded-2xl flex items-center justify-center gap-3 hover:scale-[1.01] active:scale-[0.99] transition-all jelly-shadow"
      >
        <CheckCircle2 className="w-5 h-5" />
        回首页看今天下一步
      </button>
    </motion.div>
  );
};
