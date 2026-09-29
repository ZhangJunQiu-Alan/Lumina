import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { slideIn } from '../../../lib/motion';
import { ChevronRight, Loader2, Volume2, XCircle } from 'lucide-react';
import type { PronunciationLocale, Word } from '../../../types';
import { ExampleSentenceList } from '../../shared/ExampleSentenceList';
import { cx, RoundIndicator, WordSenseList } from '../../shared/LearningUI';
import { renderProgressBar } from '../Round1Cards';
import { Round2ChoiceView, type Round2ChoiceOption, type Round2ChoiceSelection } from './Round2ChoiceView';

export interface Round2ViewProps {
  viewedWord: Word;
  viewIndex: number;
  cardDirection: 1 | -1;
  audioLocale: PronunciationLocale;
  activePronunciationLocale: PronunciationLocale | null;
  displayedPhonetic: string;
  onPlayAudio: (locale: PronunciationLocale) => void;
  canPlayExampleAudio: boolean;
  activeExampleKey: string | null;
  onPlayExampleSentence: (sentence: string, key: string) => void;
  hasRound2ChoiceOptions: boolean;
  round2ChoiceOptions: Round2ChoiceOption[];
  activeRound2ChoiceSelection: Round2ChoiceSelection | null;
  isRound2ChoiceRevealed: boolean;
  isViewingHistory: boolean;
  onSelectRound2Choice: (option: Round2ChoiceOption) => void;
  shouldShowRound3Answer: boolean;
  round3ExampleSentence: string;
  round3ExampleKey: string;
  showAnswer: boolean;
  isSubmittingAttempt: boolean;
  submitErrorBanner: React.ReactNode;
  onRound3PrimaryAction: () => void;
  onRound3Unknown: () => void;
  onCardTouchStart: (e: React.TouchEvent) => void;
  onCardTouchEnd: (e: React.TouchEvent) => void;
  onCardTouchCancel: () => void;
  sessionLeadingAction?: React.ReactNode;
  sessionActions?: React.ReactNode;
  displayProgressIndex: number;
  progressQueueLength: number;
  leftNavigationButton: React.ReactNode;
  rightNavigationButton: React.ReactNode;
  wordActionMenu: React.ReactNode;
  actionFeedbackToast: React.ReactNode;
  reportIssueSheet: React.ReactNode;
}

export const Round2View: React.FC<Round2ViewProps> = ({
  viewedWord,
  viewIndex,
  cardDirection,
  audioLocale,
  activePronunciationLocale,
  displayedPhonetic,
  onPlayAudio,
  canPlayExampleAudio,
  activeExampleKey,
  onPlayExampleSentence,
  hasRound2ChoiceOptions,
  round2ChoiceOptions,
  activeRound2ChoiceSelection,
  isRound2ChoiceRevealed,
  isViewingHistory,
  onSelectRound2Choice,
  shouldShowRound3Answer,
  round3ExampleSentence,
  round3ExampleKey,
  showAnswer,
  isSubmittingAttempt,
  submitErrorBanner,
  onRound3PrimaryAction,
  onRound3Unknown,
  onCardTouchStart,
  onCardTouchEnd,
  onCardTouchCancel,
  sessionLeadingAction,
  sessionActions,
  displayProgressIndex,
  progressQueueLength,
  leftNavigationButton,
  rightNavigationButton,
  wordActionMenu,
  actionFeedbackToast,
  reportIssueSheet,
}) => {
  return (
    <div className="relative w-full max-w-4xl mx-auto flex h-full min-h-0 flex-col items-center">
      {wordActionMenu}
      {actionFeedbackToast}
      {reportIssueSheet}
      <div className="flex w-full max-w-3xl items-center gap-2">
        {sessionLeadingAction && <div className="shrink-0">{sessionLeadingAction}</div>}
        <RoundIndicator type="round2" className="min-w-0 flex-1" />
        {sessionActions}
      </div>
      <div className="grid w-full flex-1 min-h-0 grid-cols-[minmax(0,1fr)] items-stretch gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-3">
        <div className="hidden items-center sm:flex">{leftNavigationButton}</div>

        <motion.div
          key={`${viewedWord.id}:${viewIndex}`}
          {...slideIn(cardDirection)}
          onTouchStart={onCardTouchStart}
          onTouchEnd={onCardTouchEnd}
          onTouchCancel={onCardTouchCancel}
          style={{ touchAction: 'pan-y' }}
          className="w-full flex min-h-0 flex-col items-center justify-center py-6 sm:min-h-[500px]"
        >
          <motion.div
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex items-center gap-2 mb-8"
          >
            <span className="bg-[#0ea5e9] text-white px-4 py-1 rounded-lg text-sm font-bold shadow-[0_8px_18px_rgba(14,165,233,0.18)]">
              {displayedPhonetic}
            </span>
            {(['uk', 'us'] as const).map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => onPlayAudio(loc)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                  audioLocale === loc
                    ? 'bg-[#0ea5e9] text-white shadow-[0_8px_18px_rgba(14,165,233,0.16)]'
                    : 'bg-[#e0f2fe] text-[#0284c7] hover:bg-[#bae6fd]'
                }`}
              >
                {activePronunciationLocale === loc ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Volume2 className="w-3 h-3" />
                )}
                {loc.toUpperCase()}
              </button>
            ))}
          </motion.div>

          <div className="mb-4 max-w-full text-center text-6xl font-black leading-tight text-text-primary sm:text-7xl [overflow-wrap:anywhere]">
            {viewedWord.word}
          </div>
          <div className="text-sm font-bold text-text-secondary uppercase tracking-widest mb-8">
            {viewedWord.pos_tags[0]}
          </div>

          {hasRound2ChoiceOptions ? (
            <Round2ChoiceView
              options={round2ChoiceOptions}
              activeSelection={activeRound2ChoiceSelection}
              isRevealed={isRound2ChoiceRevealed}
              isViewingHistory={isViewingHistory}
              onSelect={onSelectRound2Choice}
            />
          ) : (
            <>
              <AnimatePresence>
                {shouldShowRound3Answer && (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-4 text-center"
                  >
                    <div className="[&_span]:bg-black/5">
                      <WordSenseList word={viewedWord} centered />
                    </div>
                    {round3ExampleSentence && (
                      <div className="mx-auto mt-4 w-full max-w-xl">
                        <ExampleSentenceList
                          items={[
                            {
                              key: round3ExampleKey,
                              sentence: round3ExampleSentence,
                            },
                          ]}
                          locale={audioLocale}
                          activeExampleKey={activeExampleKey}
                          canPlayAudio={canPlayExampleAudio}
                          onPlayExample={({ sentence, key }) => {
                            onPlayExampleSentence(sentence, key);
                          }}
                          emptyMessage="暂无例句。"
                          variant="inline"
                        />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {!shouldShowRound3Answer && (
                <p className="text-text-secondary/40 text-sm mt-8">先自己判断，再决定要不要展开答案。</p>
              )}
            </>
          )}

          {hasRound2ChoiceOptions && !isRound2ChoiceRevealed && (
            <p className="text-text-secondary/40 text-sm mt-8">选择最贴近的中文释义。</p>
          )}
        </motion.div>

        <div className="hidden items-center sm:flex">{rightNavigationButton}</div>
      </div>

      {renderProgressBar(displayProgressIndex, progressQueueLength)}

      <div className="w-full max-w-3xl space-y-3 px-4 pb-4 sm:pb-8">
        {submitErrorBanner}
        {hasRound2ChoiceOptions ? (
          <>
            {activeRound2ChoiceSelection && !isViewingHistory && (
              <button
                type="button"
                onClick={onRound3PrimaryAction}
                disabled={isSubmittingAttempt}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0ea5e9] px-5 py-4 font-bold text-white shadow-[0_16px_34px_rgba(14,165,233,0.22)] transition-all hover:scale-[1.01] hover:bg-[#0284c7] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-[#0ea5e9]"
              >
                继续下一个词
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
            {isViewingHistory && (
              <button
                type="button"
                disabled
                className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-[#0ea5e9] px-5 py-4 font-bold text-white opacity-50"
              >
                回看中
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
          </>
        ) : (
          <div
            className={cx(
              'grid gap-3',
              showAnswer && !isViewingHistory ? 'sm:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]' : 'grid-cols-1',
            )}
          >
            {showAnswer && !isViewingHistory && (
              <button
                type="button"
                onClick={onRound3Unknown}
                disabled={isSubmittingAttempt}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-apple-red/20 bg-apple-red/10 px-5 py-4 font-bold text-apple-red transition-all hover:scale-[1.01] hover:bg-apple-red/15 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                {isSubmittingAttempt ? <Loader2 className="h-5 w-5 animate-spin" /> : <XCircle className="h-5 w-5" />}
                不认识
              </button>
            )}
            <button
              type="button"
              onClick={onRound3PrimaryAction}
              disabled={isViewingHistory || isSubmittingAttempt}
              className="w-full py-4 bg-[#0ea5e9] text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-[0_16px_34px_rgba(14,165,233,0.22)] hover:scale-[1.01] hover:bg-[#0284c7] active:scale-[0.99] transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-[#0ea5e9]"
            >
              {isViewingHistory
                ? '回看中'
                : isSubmittingAttempt
                  ? '正在保存…'
                  : showAnswer
                    ? '继续下一个词'
                    : '展开释义'}
              {isSubmittingAttempt ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
