import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { shake, spring } from '../../../lib/motion';
import { Loader2, Volume2 } from 'lucide-react';
import type { Word, PronunciationLocale, RoundType } from '../../../types';
import type { ClozePrompt } from '../../../lib/cloze';
import type { WordClickHandler } from '../../shared/ClickableText';
import { cx } from '../../shared/LearningUI';
import { AnswerFeedbackCard } from '../Round1Cards';
import { Round2ClozePrompt } from '../Round2ClozePrompt';

export interface DictationRecallViewProps {
  type: RoundType;
  viewedWord: Word;
  currentWord: Word;
  viewedClozePrompt: ClozePrompt | null;
  clozePrompt: ClozePrompt | null;
  viewedClozeFullSentence?: string;
  viewedClozeSentenceAudioKey?: string;
  viewedClozeWordInfoText?: string | null;
  displayedInputValue: string;
  displayedClozePhonetic?: string;
  viewedExpectedInput: string;
  lookupTargetWords: ReadonlySet<string>;
  openPopover: WordClickHandler;
  canPlayExampleAudio: boolean;
  activeExampleKey: string | null;
  audioLocale: PronunciationLocale;
  activePronunciationLocale: PronunciationLocale | null;
  onPlayAudioLocale: (locale: PronunciationLocale) => void;
  onPlayExampleSentence: (sentence: string, key: string) => void;
  primaryPos: string;
  isViewingHistory: boolean;
  showAnswer: boolean;
  isWrong: boolean;
  lastWrongInput: string;
  canToggleDictationPhonetic: boolean;
  dictationPhoneticVisible: boolean;
  onToggleDictationPhonetic: () => void;
  contentAreaClassName: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputValue: string;
  onInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  isSubmittingAttempt: boolean;
  expectedInputLength: number;
  submitErrorBanner: React.ReactNode;
}

export const DictationRecallView: React.FC<DictationRecallViewProps> = ({
  type,
  viewedWord,
  currentWord,
  viewedClozePrompt,
  clozePrompt,
  viewedClozeFullSentence,
  viewedClozeSentenceAudioKey,
  viewedClozeWordInfoText,
  displayedInputValue,
  displayedClozePhonetic,
  viewedExpectedInput,
  lookupTargetWords,
  openPopover,
  canPlayExampleAudio,
  activeExampleKey,
  audioLocale,
  activePronunciationLocale,
  onPlayAudioLocale,
  onPlayExampleSentence,
  primaryPos,
  isViewingHistory,
  showAnswer,
  isWrong,
  lastWrongInput,
  canToggleDictationPhonetic,
  dictationPhoneticVisible,
  onToggleDictationPhonetic,
  contentAreaClassName,
  inputRef,
  inputValue,
  onInput,
  onSubmit,
  isSubmittingAttempt,
  expectedInputLength,
  submitErrorBanner,
}) => {
  const phoneticToggleHideLabel = type === 'review' ? '隐藏复习轮音标' : '隐藏 Round 3 音标';
  const phoneticToggleShowLabel = type === 'review' ? '显示复习轮音标' : '显示 Round 3 音标';
  const phoneticToggleActiveClass =
    type === 'round3'
      ? 'border-[#2563eb]/18 bg-[#eaf2ff]/95 text-[#2563eb] hover:bg-[#dbeafe]'
      : 'border-apple-blue/18 bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/15';
  const phoneticToggleSwitchClass = type === 'round3' ? 'bg-[#2563eb]' : 'bg-apple-blue';

  const dictationPhoneticToggle = canToggleDictationPhonetic ? (
    <button
      type="button"
      aria-pressed={dictationPhoneticVisible}
      aria-label={dictationPhoneticVisible ? phoneticToggleHideLabel : phoneticToggleShowLabel}
      title={dictationPhoneticVisible ? '隐藏音标' : '显示音标'}
      onClick={(event) => {
        event.stopPropagation();
        onToggleDictationPhonetic();
      }}
      className={cx(
        'absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black tracking-[0.12em] shadow-[0_12px_28px_rgba(14,26,56,0.08)] backdrop-blur-xl transition-all active:scale-[0.98] sm:left-5 sm:top-5',
        dictationPhoneticVisible
          ? phoneticToggleActiveClass
          : 'border-black/6 bg-white/76 text-text-secondary/70 hover:bg-white hover:text-text-secondary',
      )}
    >
      音标
      <span
        aria-hidden="true"
        className={cx(
          'inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors',
          dictationPhoneticVisible ? phoneticToggleSwitchClass : 'bg-black/15',
        )}
      >
        <span
          className={cx(
            'h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
            dictationPhoneticVisible ? 'translate-x-3' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  ) : null;

  const replayControls = (
    <div className="mx-auto mb-8 flex flex-wrap items-center justify-center gap-2.5">
      {(['uk', 'us'] as const).map((loc) => (
        <button
          key={`${type}-replay-${loc}`}
          type="button"
          onClick={() => onPlayAudioLocale(loc)}
          className={cx(
            'flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-black tracking-[0.14em] transition-all',
            audioLocale === loc
              ? type === 'round3'
                ? 'bg-[#2563eb] text-white shadow-[0_12px_24px_rgba(37,99,235,0.18)]'
                : 'bg-apple-blue text-white shadow-[0_12px_24px_rgba(25,200,185,0.18)]'
              : type === 'round3'
                ? 'bg-[#eaf2ff] text-[#2563eb] hover:bg-[#dbeafe]'
                : 'bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/15',
          )}
        >
          {activePronunciationLocale === loc ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
          再听 {loc.toUpperCase()}
        </button>
      ))}
    </div>
  );

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onClick={() => {
        if (!isViewingHistory) {
          inputRef.current?.focus();
        }
      }}
    >
      {dictationPhoneticToggle}
      <div className={cx(contentAreaClassName, 'py-8')}>
        <div className="flex min-h-full flex-col justify-center text-center">
          {replayControls}
          <motion.div animate={!isViewingHistory && showAnswer && isWrong ? shake : { x: 0 }}>
            {viewedClozePrompt ? (
              <Round2ClozePrompt
                prompt={viewedClozePrompt}
                inputValue={displayedInputValue}
                phonetic={displayedClozePhonetic}
                targetWords={lookupTargetWords}
                onWordClick={openPopover}
                canPlaySentenceAudio={canPlayExampleAudio && Boolean(viewedClozeFullSentence)}
                isSentencePlaying={activeExampleKey === viewedClozeSentenceAudioKey}
                sentenceAudioLocale={audioLocale}
                wordInfoText={viewedClozeWordInfoText}
                onPlaySentence={() => {
                  if (!viewedClozeFullSentence || !viewedClozeSentenceAudioKey) return;
                  onPlayExampleSentence(viewedClozeFullSentence, viewedClozeSentenceAudioKey);
                }}
              />
            ) : (
              <div className="mx-auto max-w-3xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-text-secondary">
                  {type === 'review' ? '根据发音写出单词' : '根据提示写出单词'}
                </p>
                <p className="mt-5 text-4xl font-black leading-tight text-text-primary md:text-5xl">
                  {viewedWord.chinese_definition}
                </p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-text-secondary">
                    {primaryPos}
                  </span>
                </div>
                <div
                  className={cx(
                    'mt-7 inline-flex items-baseline gap-1.5 rounded-md px-4 py-2 text-2xl md:text-3xl',
                    type === 'round3' ? 'bg-[#eaf2ff] text-[#2563eb]' : 'bg-apple-blue/10 text-apple-blue/80',
                  )}
                >
                  {Array.from({ length: viewedExpectedInput.length }, (_, i) => (
                    <motion.span
                      key={`${i}:${displayedInputValue[i] ?? ''}`}
                      initial={displayedInputValue[i] ? { y: -6, opacity: 0.4 } : false}
                      animate={{ y: 0, opacity: 1 }}
                      transition={spring.snappy}
                      className="inline-block min-w-[0.9ch] text-center font-mono"
                    >
                      {displayedInputValue[i] ?? '_'}
                    </motion.span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>

          <div className="mt-6 space-y-3">
            {isViewingHistory ? (
              <AnswerFeedbackCard word={viewedWord} clozePrompt={viewedClozePrompt} />
            ) : (
              <>
                <AnimatePresence>
                  {showAnswer && (
                    <AnswerFeedbackCard
                      word={currentWord}
                      clozePrompt={clozePrompt}
                      isWrong={isWrong}
                      wrongInput={lastWrongInput}
                    />
                  )}
                </AnimatePresence>
                {submitErrorBanner}
              </>
            )}
          </div>
        </div>
      </div>

      {!isViewingHistory && (
        <form onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={onInput}
            disabled={isSubmittingAttempt || showAnswer}
            maxLength={expectedInputLength}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="absolute left-1/2 top-1/2 h-px w-px -translate-x-1/2 -translate-y-1/2 opacity-0"
            aria-label="拼写输入"
          />
        </form>
      )}
    </div>
  );
};
