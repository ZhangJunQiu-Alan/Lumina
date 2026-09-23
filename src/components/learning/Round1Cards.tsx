// Presentational Round-1 cards and session-shell chrome extracted from
// LearningEngine.tsx. These are stateless render helpers — all data and
// callbacks arrive via props.
import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { PronunciationLocale, RoundType, Word } from '../../types';
import { ExampleSentenceList } from '../shared/ExampleSentenceList';
import { cx, RoundIndicator, SessionProgress, WordSenseList } from '../shared/LearningUI';
import { ClickableText } from '../shared/ClickableText';
import { type ClozePrompt } from '../../lib/cloze';
import {
  getRelationDetailText,
  getRound1ExampleItems,
  getRound1WordItems,
  hasDisplayText,
  round1RelationDetailClassName,
  round1RelationWordClassName,
  trimDisplayText,
  type Round1LookupProps,
} from './learningEngineUtils';

export const AnswerFeedbackCard = ({
  word,
  clozePrompt,
  isWrong = false,
  wrongInput = null,
}: {
  word: Word;
  clozePrompt: ClozePrompt | null;
  isWrong?: boolean;
  wrongInput?: string | null;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 18 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 10 }}
    className={cx(
      'mx-auto w-fit max-w-full rounded-[22px] px-5 py-4 text-left font-bold text-white shadow-xl',
      isWrong ? 'bg-apple-red shadow-apple-red/20' : 'bg-[#10B981] shadow-[#10B981]/20',
    )}
  >
    <div className="flex items-start gap-4">
      <div className="mt-1 flex-shrink-0">
        {isWrong ? <XCircle className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
      </div>
      <div className="space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest opacity-70">
            {isWrong ? '答案有误 · 正确答案如下' : '回答正确'}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <p className="text-lg font-black leading-none md:text-xl">
              {clozePrompt ? clozePrompt.expectedForm : word.word}
            </p>
            {clozePrompt && clozePrompt.expectedForm !== clozePrompt.baseForm && (
              <p className="text-xs font-medium opacity-70">原形 · {clozePrompt.baseForm}</p>
            )}
            {isWrong && wrongInput && (
              <p className="text-sm font-medium line-through opacity-60">你的答案：{wrongInput}</p>
            )}
          </div>
        </div>
        <div className="[&_p]:text-white [&_span]:bg-white/16 [&_span]:text-white/90">
          <WordSenseList word={word} compact />
        </div>
      </div>
    </div>
  </motion.div>
);

export const Round1LookupText = ({
  text,
  targetWords,
  onWordClick,
  targetClassName,
}: {
  text: string;
  targetClassName?: string;
} & Round1LookupProps) =>
  onWordClick ? (
    <ClickableText
      text={text}
      targetWords={targetWords}
      onWordClick={onWordClick}
      stopPropagation
      targetClassName={targetClassName}
    />
  ) : (
    <>{text}</>
  );

export const Round1MorphologyCard = ({ word, targetWords, onWordClick }: { word: Word } & Round1LookupProps) => {
  const morphologySummary = trimDisplayText(word.morphology.summaryZh);
  const derivedWords = getRound1WordItems(word.derivedWords);
  const title = '单词拆解';

  if (!morphologySummary && derivedWords.length === 0) return null;

  return (
    <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-4 sm:p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
      <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.24em] text-text-secondary">{title}</p>
      {morphologySummary && (
        <div className="mt-2 rounded-[16px] border border-white/85 bg-white/75 px-3 py-2 sm:mt-3 sm:rounded-[18px] sm:px-4 sm:py-3">
          <p className="text-sm sm:text-[15px] leading-7 text-text-primary">
            <Round1LookupText text={morphologySummary} targetWords={targetWords} onWordClick={onWordClick} />
          </p>
        </div>
      )}

      {derivedWords.length > 0 && (
        <div className={morphologySummary ? 'mt-4' : 'mt-3'}>
          <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">派生词</p>
          <div className="mt-2 sm:mt-3 space-y-2">
            {derivedWords.map((item) => {
              const itemWord = trimDisplayText(item.word);
              const detailText = getRelationDetailText(item);

              return (
                <div
                  key={`${word.id}-derived-${itemWord}`}
                  className="rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
                >
                  <p className="text-base sm:text-[18px] font-black text-text-primary">
                    <Round1LookupText text={itemWord} targetWords={targetWords} onWordClick={onWordClick} />
                  </p>
                  {detailText && (
                    <p className="mt-1.5 text-[13px] sm:text-[15px] leading-relaxed text-text-secondary">
                      <Round1LookupText text={detailText} targetWords={targetWords} onWordClick={onWordClick} />
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export const Round1RelationsCard = ({ word, targetWords, onWordClick }: { word: Word } & Round1LookupProps) => {
  const synonyms = getRound1WordItems(word.synonyms, 2);
  const antonyms = getRound1WordItems(word.antonyms, 2);

  if (synonyms.length === 0 && antonyms.length === 0) return null;

  return (
    <section className="h-full min-w-0 rounded-[24px] border border-white/80 bg-white/60 p-4 sm:p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
      <div
        className={cx(
          'grid min-w-0 gap-4',
          synonyms.length > 0 && antonyms.length > 0 ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'sm:grid-cols-1',
        )}
      >
        {synonyms.length > 0 && (
          <div className="min-w-0">
            <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">
              近义词
            </p>
            <div className="mt-2 sm:mt-3 space-y-2">
              {synonyms.map((item) => {
                const itemWord = trimDisplayText(item.word);
                const detailText = getRelationDetailText(item);

                return (
                  <div
                    key={`${word.id}-synonym-${itemWord}`}
                    className="min-w-0 rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
                  >
                    <p className={round1RelationWordClassName}>
                      <Round1LookupText text={itemWord} targetWords={targetWords} onWordClick={onWordClick} />
                    </p>
                    {detailText && (
                      <p className={round1RelationDetailClassName}>
                        <Round1LookupText text={detailText} targetWords={targetWords} onWordClick={onWordClick} />
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {antonyms.length > 0 && (
          <div className="min-w-0">
            <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">
              反义词
            </p>
            <div className="mt-2 sm:mt-3 space-y-2">
              {antonyms.map((item) => {
                const itemWord = trimDisplayText(item.word);
                const detailText = getRelationDetailText(item);

                return (
                  <div
                    key={`${word.id}-antonym-${itemWord}`}
                    className="min-w-0 rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
                  >
                    <p className={round1RelationWordClassName}>
                      <Round1LookupText text={itemWord} targetWords={targetWords} onWordClick={onWordClick} />
                    </p>
                    {detailText && (
                      <p className={round1RelationDetailClassName}>
                        <Round1LookupText text={detailText} targetWords={targetWords} onWordClick={onWordClick} />
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export const Round1ConfusingCard = ({
  word,
  activeExampleKey,
  canPlayExampleAudio,
  exampleLocale,
  onPlayExample,
  targetWords,
  onWordClick,
}: {
  word: Word;
  activeExampleKey: string | null;
  canPlayExampleAudio: boolean;
  exampleLocale: PronunciationLocale;
  onPlayExample: (sentence: string, key: string) => void;
} & Round1LookupProps) => {
  const confusingPairs = getRound1WordItems(word.confusingPairs);
  const confusingPairsWithDifference = confusingPairs.filter((pair) => hasDisplayText(pair.difference));
  const exampleItems = getRound1ExampleItems(word);
  const currentWordKey = word.word.trim().toLowerCase();

  if (confusingPairsWithDifference.length === 0 && exampleItems.length === 0) return null;

  return (
    <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-4 sm:p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
      <div className="space-y-4 sm:space-y-5">
        {confusingPairsWithDifference.length > 0 && (
          <div>
            <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.24em] text-text-secondary">
              易混词义对比
            </p>
            <div className="mt-2 sm:mt-3 space-y-2">
              {confusingPairsWithDifference.map((pair, index) => {
                const pairWord = trimDisplayText(pair.word);
                const difference = trimDisplayText(pair.difference);
                const comparisonWords = new Set([currentWordKey, pairWord.toLowerCase()].filter(Boolean));

                return (
                  <div
                    key={`${word.id}-confusion-${pairWord}-${index}`}
                    className="rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
                  >
                    {difference && (
                      <p className="text-[13px] sm:text-[16px] leading-relaxed text-text-secondary">
                        <Round1LookupText
                          text={difference}
                          targetWords={comparisonWords}
                          onWordClick={onWordClick}
                          targetClassName="bg-transparent text-lg font-black text-text-primary hover:bg-apple-blue/10 sm:text-xl"
                        />
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {exampleItems.length > 0 && (
          <div className={cx(confusingPairsWithDifference.length > 0 && 'border-t border-black/6 pt-4 sm:pt-5')}>
            <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">例句</p>
            <div className="mt-2">
              <ExampleSentenceList
                items={exampleItems}
                locale={exampleLocale}
                activeExampleKey={activeExampleKey}
                canPlayAudio={canPlayExampleAudio}
                onPlayExample={({ sentence, key }) => {
                  onPlayExample(sentence, key);
                }}
                emptyMessage=""
                targetWords={targetWords}
                onWordClick={onWordClick}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export const Round1MemoryTipCard = ({
  memoryTip,
  targetWords,
  onWordClick,
}: { memoryTip: string } & Round1LookupProps) => (
  <aside className="flex min-h-[92px] rounded-[18px] border border-apple-blue/15 bg-apple-blue/8 px-4 py-3 sm:px-5 sm:py-4 lg:min-h-[88px] lg:max-h-[132px] lg:w-full lg:max-w-[430px] lg:self-start lg:overflow-y-auto">
    <div className="my-auto min-w-0">
      <p className="text-[11px] sm:text-[12px] font-bold uppercase tracking-[0.22em] text-apple-blue">记忆提示</p>
      <p className="mt-1.5 text-[13px] sm:text-sm leading-6 text-text-primary">
        <Round1LookupText text={memoryTip} targetWords={targetWords} onWordClick={onWordClick} />
      </p>
    </div>
  </aside>
);

export const InputSessionShell = ({
  type,
  currentIndex,
  queueLength,
  sessionLeadingAction,
  sessionActions,
  main,
}: {
  type: RoundType;
  currentIndex: number;
  queueLength: number;
  sessionLeadingAction?: React.ReactNode;
  sessionActions?: React.ReactNode;
  main: React.ReactNode;
}) => (
  <div className="input-session-shell mx-auto flex h-full min-h-0 w-full flex-col gap-3 sm:gap-4">
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)] items-center sm:grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] sm:gap-3">
      <div className="hidden sm:block" />
      <div className="flex min-w-0 items-center gap-3">
        {sessionLeadingAction && <div className="shrink-0">{sessionLeadingAction}</div>}
        <RoundIndicator type={type} className="min-w-0 shrink-0" showConnector={false} />
        <SessionProgress currentIndex={currentIndex} queueLength={queueLength} type={type} className="min-w-0 flex-1" />
        {sessionActions && <div className="flex h-6 shrink-0 items-center justify-end">{sessionActions}</div>}
      </div>
      <div className="hidden sm:block" />
    </header>

    <div className="input-session-shell__body min-w-0 flex-1 min-h-0">{main}</div>
  </div>
);

export function renderProgressBar(currentIndex: number, queueLength: number) {
  const safeLength = Math.max(queueLength, 1);
  const completedRatio = Math.min(Math.max(currentIndex / safeLength, 0), 1);
  const currentRatio = Math.min(Math.max((currentIndex + 1) / safeLength, 0), 1);

  return (
    <div className="mt-auto flex w-full max-w-3xl items-center gap-3 px-4 pb-6 sm:gap-4 sm:pb-8">
      <div className="shrink-0 whitespace-nowrap text-xs font-bold uppercase tracking-widest text-text-secondary">
        第 {currentIndex + 1} / {queueLength} 个词
      </div>
      <div className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-black/5">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#0ea5e9]/30 transition-all"
          style={{ width: `${completedRatio * 100}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#0ea5e9] transition-all"
          style={{ width: `${currentRatio * 100}%` }}
        />
      </div>
    </div>
  );
}
