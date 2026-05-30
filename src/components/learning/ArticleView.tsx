import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BookOpen, CheckCircle2, Languages } from 'lucide-react';
import type { ArticleSentence, Word } from '../../types';
import { useWordPopover } from '../../contexts/WordPopoverContext';
import { ClickableText } from '../shared/ClickableText';
import { IslandButton } from '../shared/AnimalPrimitives';

interface ArticleViewProps {
  sentences: ArticleSentence[];
  words: Word[];
  onFinish: () => void | Promise<void>;
}

export const ArticleView = ({ sentences, words, onFinish }: ArticleViewProps) => {
  const { openPopover } = useWordPopover();
  const targetWords = useMemo(
    () => new Set(words.map((word) => word.word.trim().toLowerCase()).filter(Boolean)),
    [words],
  );
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    setRevealedCount(0);
  }, [sentences]);

  const allTranslated = sentences.length > 0 && revealedCount >= sentences.length;
  const translateButtonLabel = allTranslated ? '已全部翻译' : revealedCount > 0 ? '翻译下一句' : '逐句翻译';
  const revealedProgressLabel = `${Math.min(revealedCount, sentences.length)} / ${sentences.length}`;

  const handleRevealNext = useCallback(() => {
    setRevealedCount((current) => Math.min(current + 1, sentences.length));
  }, [sentences.length]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-[1400px] py-6 sm:py-7"
    >
      <div className="grid w-full gap-4 xl:grid-cols-[minmax(0,1fr)_180px] xl:items-start">
        <div className="glass relative min-w-0 rounded-apple-lg p-6 sm:p-8 lg:p-10 xl:p-12">
          <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-apple-green shadow-lg shadow-apple-green/20">
                <BookOpen className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-black tracking-tight">最后用短文收口</h2>
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">把这一组放回语境里</p>
              </div>
            </div>
            <IslandButton
              htmlType="button"
              onClick={onFinish}
              tone="mint"
              size="large"
              icon={<CheckCircle2 className="h-5 w-5" />}
            >
              这段读完了，回到今日学习
            </IslandButton>
          </div>

          <div className="space-y-6 text-lg font-medium leading-[1.85] text-gray-800 selection:bg-apple-blue/10 sm:text-xl">
            {sentences.map((sentence, index) => (
              <div key={`${sentence.en}-${index}`} className="space-y-2">
                <p>
                  <ClickableText text={sentence.en} targetWords={targetWords} onWordClick={openPopover} />
                </p>
                {index < revealedCount && (
                  <motion.p
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border-l-4 border-apple-blue/25 pl-4 text-base font-bold leading-[1.75] text-text-secondary sm:text-lg"
                  >
                    {sentence.zh}
                  </motion.p>
                )}
              </div>
            ))}
            {sentences.length === 0 && <p className="text-text-secondary">这篇短文暂时没有内容。</p>}
          </div>
        </div>

        <aside className="sticky top-3 z-20 order-first xl:order-last xl:top-6">
          <div className="glass flex items-center gap-3 rounded-[24px] p-2 shadow-[0_18px_42px_rgba(14,26,56,0.08)] xl:flex-col xl:items-stretch xl:p-3">
            <IslandButton
              htmlType="button"
              onClick={handleRevealNext}
              disabled={allTranslated || sentences.length === 0}
              className="min-h-14 flex-1 xl:w-full xl:flex-none"
              tone="mint"
              icon={<Languages className="h-5 w-5 shrink-0" />}
            >
              <span className="truncate">{translateButtonLabel}</span>
            </IslandButton>
            <div className="hidden h-px w-full bg-black/6 xl:block" />
            <div className="shrink-0 rounded-[16px] bg-white/65 px-3 py-2 text-center text-xs font-black text-text-secondary xl:w-full">
              {revealedProgressLabel}
            </div>
          </div>
        </aside>
      </div>
    </motion.div>
  );
};
