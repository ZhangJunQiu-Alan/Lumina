import React from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { ClozePrompt, CLOZE_BLANK } from '../../lib/cloze';
import type { PronunciationLocale } from '../../types';
import { ClickableText, type WordClickHandler } from '../shared/ClickableText';

function renderSlots(expectedForm: string, inputValue: string) {
  return Array.from({ length: expectedForm.length }, (_, i) => (
    <span
      key={i}
      className="inline-block min-w-[0.9ch] text-center font-mono"
    >
      {inputValue[i] ?? '_'}
    </span>
  ));
}

function renderBlankedSentence(
  sentence: string,
  expectedForm: string,
  inputValue: string,
  onWordClick?: WordClickHandler,
  targetWords?: ReadonlySet<string>,
) {
  const parts = sentence.split(CLOZE_BLANK);
  const nodes: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      nodes.push(
        <span
          key={`blank-${i}`}
          className="mx-1.5 inline-flex items-baseline gap-1.5 align-baseline rounded-md bg-[#eaf2ff] px-3 py-1 text-[#2563eb]"
          aria-label="blank"
        >
          {renderSlots(expectedForm, inputValue)}
        </span>,
      );
    }
    nodes.push(
      <span key={`text-${i}`}>
        {onWordClick ? (
          <ClickableText
            text={part}
            targetWords={targetWords}
            onWordClick={onWordClick}
            stopPropagation
          />
        ) : part}
      </span>,
    );
  });
  return nodes;
}

export const Round2ClozePrompt = ({
  prompt,
  inputValue,
  targetWords,
  onWordClick,
  canPlaySentenceAudio = false,
  isSentencePlaying = false,
  onPlaySentence,
  sentenceAudioLocale = 'uk',
}: {
  prompt: ClozePrompt;
  inputValue: string;
  targetWords?: ReadonlySet<string>;
  onWordClick?: WordClickHandler;
  canPlaySentenceAudio?: boolean;
  isSentencePlaying?: boolean;
  onPlaySentence?: () => void;
  sentenceAudioLocale?: PronunciationLocale;
}) => (
  <div className="mx-auto max-w-3xl">
    <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-text-secondary/60">
      根据语境复现单词
    </p>

    <p className="mt-5 text-2xl font-black leading-[1.5] text-text-primary md:text-[1.95rem] md:leading-[1.55]">
      {renderBlankedSentence(
        prompt.blankedSentence,
        prompt.expectedForm,
        inputValue,
        onWordClick,
        targetWords,
      )}
    </p>

    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
      <span className="rounded-full bg-[#eaf2ff] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[#2563eb]">
        {prompt.formLabel}
      </span>
      {onPlaySentence && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPlaySentence();
          }}
          disabled={!canPlaySentenceAudio}
          aria-label={isSentencePlaying ? '停止朗读完整例句' : '播放完整例句'}
          title={isSentencePlaying ? '停止朗读完整例句' : '播放完整例句'}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#eaf2ff] px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-[#2563eb] transition-colors hover:bg-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[#eaf2ff]"
        >
          {isSentencePlaying
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Volume2 className="h-3.5 w-3.5" />}
          完整句 {sentenceAudioLocale.toUpperCase()}
        </button>
      )}
    </div>

    {prompt.translation && (
      <p className="mt-4 text-sm leading-6 text-text-secondary md:text-base md:leading-7">
        {prompt.translation}
      </p>
    )}
  </div>
);
