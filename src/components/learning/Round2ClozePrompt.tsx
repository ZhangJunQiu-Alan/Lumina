import React from 'react';
import { ClozePrompt, CLOZE_BLANK } from '../../lib/cloze';

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

function renderBlankedSentence(sentence: string, expectedForm: string, inputValue: string) {
  const parts = sentence.split(CLOZE_BLANK);
  const nodes: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      nodes.push(
        <span
          key={`blank-${i}`}
          className="mx-1.5 inline-flex items-baseline gap-1.5 align-baseline rounded-md bg-apple-blue/10 px-3 py-1 text-apple-blue/80"
          aria-label="blank"
        >
          {renderSlots(expectedForm, inputValue)}
        </span>,
      );
    }
    nodes.push(<span key={`text-${i}`}>{part}</span>);
  });
  return nodes;
}

export const Round2ClozePrompt = ({ prompt, inputValue }: { prompt: ClozePrompt; inputValue: string }) => (
  <div className="mx-auto max-w-3xl">
    <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-text-secondary/60">
      根据语境复现单词
    </p>

    <p className="mt-5 text-2xl font-black leading-[1.5] text-text-primary md:text-[1.95rem] md:leading-[1.55]">
      {renderBlankedSentence(prompt.blankedSentence, prompt.expectedForm, inputValue)}
    </p>

    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
      <span className="rounded-full bg-apple-blue/12 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-apple-blue">
        {prompt.formLabel}
      </span>
    </div>

    {prompt.translation && (
      <p className="mt-4 text-sm leading-6 text-text-secondary md:text-base md:leading-7">
        {prompt.translation}
      </p>
    )}
  </div>
);
