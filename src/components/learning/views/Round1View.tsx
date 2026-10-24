import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { PronunciationLocale, Word } from '../../../types';
import type { WordClickHandler } from '../../shared/ClickableText';
import { cx, PronunciationControls, WordSenseList } from '../../shared/LearningUI';
import {
  Round1ConfusingCard,
  Round1LookupText,
  Round1MemoryTipCard,
  Round1MorphologyCard,
  Round1RelationsCard,
} from '../Round1Cards';

export interface Round1ViewProps {
  viewedWord: Word;
  displayedPhonetic: string;
  audioLocale: PronunciationLocale;
  activePronunciationLocale: PronunciationLocale | null;
  onPlayAudio: (locale: PronunciationLocale) => void;
  lookupTargetWords?: ReadonlySet<string>;
  openPopover?: WordClickHandler;
  round1MemoryTip?: string | null;
  hasRound1InfoCards: boolean;
  showRound1MorphologyCard: boolean;
  showRound1RelationsCard: boolean;
  showRound1ContextCard: boolean;
  activeExampleKey: string | null;
  canPlayExampleAudio: boolean;
  onPlayExampleSentence: (sentence: string, key: string) => void;
  isViewingHistory: boolean;
  contentAreaClassName: string;
  round1InputDockClassName: string;
  inputField: React.ReactNode;
  submitErrorBanner: React.ReactNode;
}

export const Round1View: React.FC<Round1ViewProps> = ({
  viewedWord,
  displayedPhonetic,
  audioLocale,
  activePronunciationLocale,
  onPlayAudio,
  lookupTargetWords,
  openPopover,
  round1MemoryTip,
  hasRound1InfoCards,
  showRound1MorphologyCard,
  showRound1RelationsCard,
  showRound1ContextCard,
  activeExampleKey,
  canPlayExampleAudio,
  onPlayExampleSentence,
  isViewingHistory,
  contentAreaClassName,
  round1InputDockClassName,
  inputField,
  submitErrorBanner,
}) => {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cx(contentAreaClassName, 'pb-4 sm:pb-5')}>
        <div className="space-y-3 sm:space-y-4">
          <div
            className={cx(
              'grid gap-3 lg:items-start lg:gap-8',
              round1MemoryTip ? 'lg:grid-cols-[minmax(0,1fr)_minmax(300px,30vw)]' : 'lg:grid-cols-1',
            )}
          >
            <div className="min-w-0 space-y-3 sm:space-y-4">
              <PronunciationControls
                phonetic={displayedPhonetic}
                audioLocale={audioLocale}
                activePronunciationLocale={activePronunciationLocale}
                size="small"
                onPlay={onPlayAudio}
              />

              <div
                className={cx(
                  'flex min-w-0 flex-col gap-2',
                  round1MemoryTip ? '2xl:flex-row 2xl:items-start 2xl:gap-6' : 'lg:flex-row lg:items-start lg:gap-6',
                )}
              >
                <div className={cx('min-w-0', round1MemoryTip ? '2xl:flex-shrink-0' : 'lg:flex-shrink-0')}>
                  <p className="max-w-full text-[clamp(1.296rem,7.2vw,3.024rem)] font-black leading-tight tracking-tight text-text-primary [overflow-wrap:anywhere]">
                    <Round1LookupText
                      text={viewedWord.word}
                      targetWords={lookupTargetWords}
                      onWordClick={openPopover}
                    />
                  </p>
                  {viewedWord.ner_entities.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {viewedWord.ner_entities.map((entity, index) => (
                        <span
                          key={`${viewedWord.id}-ner-${index}`}
                          className="rounded-full bg-[#eef2ff] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#4f46e5]"
                        >
                          专有名词 · {entity.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  className={cx(
                    'min-w-0',
                    round1MemoryTip
                      ? '2xl:min-w-[18rem] 2xl:max-w-[680px] 2xl:flex-1 2xl:pt-1'
                      : 'lg:min-w-[18rem] lg:max-w-[680px] lg:flex-1 lg:pt-1',
                  )}
                >
                  <WordSenseList word={viewedWord} size="small" />
                </div>
              </div>
            </div>

            {round1MemoryTip && (
              <div className="flex justify-end">
                <Round1MemoryTipCard
                  memoryTip={round1MemoryTip}
                  targetWords={lookupTargetWords}
                  onWordClick={openPopover}
                />
              </div>
            )}
          </div>

          {hasRound1InfoCards && (
            <div className="fluid-grid">
              {showRound1MorphologyCard && (
                <Round1MorphologyCard word={viewedWord} targetWords={lookupTargetWords} onWordClick={openPopover} />
              )}
              {showRound1RelationsCard && (
                <Round1RelationsCard word={viewedWord} targetWords={lookupTargetWords} onWordClick={openPopover} />
              )}
              {showRound1ContextCard && (
                <Round1ConfusingCard
                  word={viewedWord}
                  activeExampleKey={activeExampleKey}
                  canPlayExampleAudio={canPlayExampleAudio}
                  exampleLocale={audioLocale}
                  onPlayExample={onPlayExampleSentence}
                  targetWords={lookupTargetWords}
                  onWordClick={openPopover}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div className={round1InputDockClassName}>
        <div className="mx-auto w-full max-w-[1200px]">
          {isViewingHistory ? (
            <div className="flex min-h-[50px] items-center justify-between gap-3 rounded-[22px] border border-[#10B981]/15 bg-[#10B981]/10 px-5 text-[#10B981] shadow-[0_12px_32px_rgba(16,185,129,0.08)]">
              <div className="flex min-w-0 items-center gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="truncate text-sm font-black sm:text-base">已通过</span>
              </div>
              <span className="truncate text-xl font-black sm:text-2xl">{viewedWord.word}</span>
            </div>
          ) : (
            <>
              <div className="min-w-0">{inputField}</div>
              {submitErrorBanner && <div className="mt-2">{submitErrorBanner}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
