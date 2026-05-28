import React from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { PronunciationLocale, RoundType, Word } from '../../types';

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function getDisplaySenses(word: Word) {
  const grouped = new Map<string, string[]>();

  for (const sense of word.senses) {
    const pos = sense.pos.trim() || '未标注';
    const meaning = sense.meaning_zh.trim();

    if (!meaning) continue;

    const bucket = grouped.get(pos) ?? [];
    if (!bucket.includes(meaning)) {
      bucket.push(meaning);
    }
    grouped.set(pos, bucket);
  }

  if (grouped.size > 0) {
    return Array.from(grouped.entries()).map(([pos, meanings]) => ({
      pos,
      meaning: meanings.join('；'),
    }));
  }

  return [{
    pos: word.pos_tags[0] ?? '未标注',
    meaning: word.chinese_definition || '暂无释义',
  }];
}

export const WordSenseList = ({
  word,
  centered = false,
  compact = false,
  size = 'default',
}: {
  word: Word;
  centered?: boolean;
  compact?: boolean;
  size?: 'default' | 'small';
}) => {
  const senses = getDisplaySenses(word);

  return (
    <div className={cx('space-y-2 sm:space-y-3', centered && 'flex flex-col items-center')}>
      {senses.map((sense, index) => (
        <div
          key={`${word.id}-sense-${sense.pos}-${index}`}
          className={cx('flex flex-wrap items-start gap-2 sm:gap-3', centered && 'justify-center')}
        >
          <span
            className={cx(
              'rounded-full bg-black/5 px-2 py-0.5 sm:px-3 sm:py-1 font-bold uppercase tracking-[0.22em] text-text-secondary',
              size === 'small' ? 'text-[8px] sm:text-[9px]' : 'text-[10px] sm:text-[11px]',
            )}
          >
            {sense.pos}
          </span>
          <p
            className={cx(
              'min-w-[10rem] text-text-primary',
              compact
                ? 'flex-1 text-sm font-bold leading-6'
                : size === 'small'
                  ? 'flex-1 text-[0.8rem] font-black leading-snug sm:text-[0.92rem] md:text-[1.16rem]'
                  : 'flex-1 text-[1rem] font-black leading-snug sm:text-[1.15rem] md:text-[1.45rem]',
              centered && 'text-center',
            )}
          >
            {sense.meaning}
          </p>
        </div>
      ))}
    </div>
  );
};

export const RoundIndicator = ({ type, className }: { type: RoundType; className?: string }) => {
  const labels: Record<RoundType, string> = {
    review: '先处理到期复习',
    round1: '第一轮：先对上词形和意思',
    round2: '第二轮：在语境里想起来',
    round3: '第三轮：先判断，再确认',
    article: '最后用短文收口',
  };
  const colors: Record<RoundType, string> = {
    review: 'bg-apple-red',
    round1: 'bg-apple-indigo',
    round2: 'bg-apple-blue',
    round3: 'bg-apple-teal',
    article: 'bg-apple-green',
  };
  return (
    <div className={cx('flex min-w-0 items-center gap-2 sm:gap-3', className)}>
      <div className={`min-w-0 max-w-[36vw] truncate whitespace-nowrap px-3 py-1 sm:max-w-none sm:px-4 sm:py-1.5 ${colors[type]} text-white text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-full shadow-lg`}>
        {labels[type]}
      </div>
      <div className="h-px flex-1 bg-black/5" />
    </div>
  );
};

export const SessionProgress = ({
  currentIndex,
  queueLength,
}: {
  currentIndex: number;
  queueLength: number;
}) => (
  <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap rounded-full border border-white/70 bg-white/70 px-3 py-1.5 shadow-[0_14px_40px_rgba(14,26,56,0.08)] backdrop-blur-xl sm:gap-3 sm:px-4 sm:py-2">
    <div className="text-xs font-black tracking-[0.16em] text-text-primary sm:text-sm">
      {String(currentIndex + 1).padStart(2, '0')} / {String(queueLength).padStart(2, '0')}
    </div>
    <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-text-secondary sm:text-[10px]">
      这一轮进度
    </span>
  </div>
);

export const PronunciationControls = ({
  phonetic,
  audioLocale,
  activePronunciationLocale,
  onPlay,
  size = 'default',
}: {
  phonetic: string;
  audioLocale: 'uk' | 'us';
  activePronunciationLocale: PronunciationLocale | null;
  onPlay: (locale: 'uk' | 'us') => void;
  size?: 'default' | 'small';
}) => (
  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
    <span
      className={cx(
        'rounded-xl sm:rounded-2xl bg-apple-blue px-3 py-1.5 sm:px-4 sm:py-2 font-black tracking-tight text-white shadow-[0_12px_30px_rgba(25,200,185,0.18)]',
        size === 'small' ? 'text-[13px] sm:text-[14px]' : 'text-base sm:text-lg',
      )}
    >
      {phonetic || '暂无音标'}
    </span>
    {(['uk', 'us'] as const).map((loc) => (
      <button
        key={loc}
        type="button"
        onClick={() => onPlay(loc)}
        className={cx(
          'flex items-center gap-1.5 rounded-xl sm:rounded-2xl px-2.5 py-1.5 sm:px-3 sm:py-2 font-black tracking-wide transition-all',
          size === 'small' ? 'text-[8px] sm:text-[10px]' : 'text-[10px] sm:text-xs',
          audioLocale === loc
            ? 'bg-apple-blue text-white shadow-[0_10px_24px_rgba(25,200,185,0.16)]'
            : 'bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/15',
        )}
      >
        {activePronunciationLocale === loc
          ? <Loader2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 animate-spin" />
          : <Volume2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
        {loc.toUpperCase()}
      </button>
    ))}
  </div>
);
