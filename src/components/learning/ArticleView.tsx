import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BookOpen } from 'lucide-react';
import type { ArticleSentence, Word } from '../../types';

interface ArticleViewProps {
  sentences: ArticleSentence[];
  words: Word[];
  onFinish: () => void | Promise<void>;
}

function normalizeArticleToken(token: string) {
  return token
    .replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/gi, '')
    .toLowerCase();
}

export const ArticleView = ({ sentences, words, onFinish }: ArticleViewProps) => {
  const targetWords = useMemo(
    () => new Set(words.map((word) => word.word.trim().toLowerCase()).filter(Boolean)),
    [words],
  );
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    setRevealedCount(0);
  }, [sentences]);

  const allTranslated = sentences.length > 0 && revealedCount >= sentences.length;
  const translateButtonLabel = allTranslated
    ? '已全部翻译'
    : revealedCount > 0
        ? '翻译下一句'
        : '逐句翻译';

  const renderHighlightedSentence = useCallback((sentence: string, sentenceIndex: number) => (
    sentence.split(/(\s+)/).map((part, partIndex) => {
      if (/^\s+$/.test(part)) return part;

      const cleanWord = normalizeArticleToken(part);
      const isTarget = targetWords.has(cleanWord);
      return (
        <span
          key={`${sentenceIndex}-${partIndex}-${part}`}
          className={isTarget ? 'bg-apple-blue/10 text-apple-blue font-bold px-1 rounded transition-colors hover:bg-apple-blue/20 cursor-default' : ''}
        >
          {part}
        </span>
      );
    })
  ), [targetWords]);

  const handleRevealNext = useCallback(() => {
    setRevealedCount((current) => Math.min(current + 1, sentences.length));
  }, [sentences.length]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="w-full max-w-4xl mx-auto py-12"
    >
      <div className="glass rounded-apple-lg p-10 md:p-16 jelly-shadow relative">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-apple-green rounded-2xl flex items-center justify-center shadow-lg shadow-apple-green/20">
              <BookOpen className="text-white w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight">最后用短文收口</h2>
              <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">把这一组放回语境里</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={handleRevealNext}
              disabled={allTranslated || sentences.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-apple-blue/15 bg-apple-blue/10 px-6 py-4 font-black text-apple-blue transition-all hover:scale-[1.02] hover:bg-apple-blue/15 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              {translateButtonLabel}
            </button>
            <button
              onClick={onFinish}
              className="px-8 py-4 bg-apple-blue text-white font-black rounded-2xl shadow-xl shadow-apple-blue/25 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              这段读完了，回到今天路线
            </button>
          </div>
        </div>
        <div className="space-y-6 text-xl font-medium leading-[1.85] text-gray-800 selection:bg-apple-blue/10">
          {sentences.map((sentence, index) => (
            <div key={`${sentence.en}-${index}`} className="space-y-2">
              <p>
                {renderHighlightedSentence(sentence.en, index)}
              </p>
              {index < revealedCount && (
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="border-l-4 border-apple-blue/25 pl-4 text-lg font-bold leading-[1.75] text-text-secondary"
                >
                  {sentence.zh}
                </motion.p>
              )}
            </div>
          ))}
          {sentences.length === 0 && (
            <p className="text-text-secondary">
              这篇短文暂时没有内容。
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
};
