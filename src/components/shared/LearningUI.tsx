import React from 'react';
import { Loader2, Sparkles, Volume2 } from 'lucide-react';
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

  return [
    {
      pos: word.pos_tags[0] ?? '未标注',
      meaning: word.chinese_definition || '暂无释义',
    },
  ];
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

export const RoundIndicator = ({
  type,
  className,
  showConnector = true,
}: {
  type: RoundType;
  className?: string;
  showConnector?: boolean;
}) => {
  const labels: Record<RoundType, string> = {
    review: '先处理到期复习',
    round1: '记忆',
    round2: '回忆',
    round3: '听写',
    article: '最后用短文收口',
  };
  const colors: Record<RoundType, string> = {
    review: 'bg-apple-red',
    round1: 'bg-[#4f46e5]',
    round2: 'bg-[#0ea5e9]',
    round3: 'bg-[#2563eb]',
    article: 'bg-apple-green',
  };
  return (
    <div className={cx('flex min-w-0 items-center gap-2 sm:gap-3', className)}>
      <div
        className={`inline-flex h-6 min-w-0 max-w-[36vw] items-center truncate whitespace-nowrap px-3 sm:max-w-none ${colors[type]} text-white text-[9px] font-black uppercase tracking-widest rounded-full shadow-lg`}
      >
        {labels[type]}
      </div>
      {showConnector && <div className="h-px flex-1 bg-black/5" />}
    </div>
  );
};

export const SessionProgress = ({
  currentIndex,
  queueLength,
  type = 'round1',
  className,
}: {
  currentIndex: number;
  queueLength: number;
  type?: RoundType;
  className?: string;
}) => {
  const safeLength = Math.max(queueLength, 1);
  const displayIndex = queueLength > 0 ? Math.min(currentIndex + 1, queueLength) : 0;
  const progress = Math.min(Math.max(displayIndex / safeLength, 0), 1);
  const progressPercent = progress * 100;
  const isComplete = queueLength > 0 && displayIndex >= queueLength;
  const fillColors: Record<RoundType, string> = {
    review: 'from-apple-red/70 to-apple-red',
    round1: 'from-[#8b5cf6] via-[#6366f1] to-[#4f46e5]',
    round2: 'from-[#67e8f9] via-[#38bdf8] to-[#0ea5e9]',
    round3: 'from-[#60a5fa] via-[#3b82f6] to-[#2563eb]',
    article: 'from-apple-green/70 to-apple-green',
  };

  return (
    <div
      className={cx('relative h-6 w-full', className)}
      role="progressbar"
      aria-label={`这一轮进度 ${displayIndex} / ${queueLength}`}
      aria-valuemin={0}
      aria-valuemax={queueLength}
      aria-valuenow={displayIndex}
    >
      <div className="absolute inset-0 overflow-hidden rounded-full bg-[#cfd7e2] shadow-inner">
        <div
          className={cx(
            'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r shadow-[0_0_10px_rgba(79,70,229,0.35)] transition-all duration-500 ease-out',
            fillColors[type],
          )}
          style={{
            width: `${progressPercent}%`,
            minWidth: progressPercent > 0 ? '1.5rem' : undefined,
          }}
        />
        <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-black/6" />
      </div>
      <div
        className={cx(
          'absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors duration-300',
          isComplete
            ? 'border-[#f0b64c] bg-[#fff8df] text-[#d78918] shadow-[0_6px_14px_rgba(215,137,24,0.18)]'
            : 'border-[#9aa3af] bg-[#f4f6f8] text-[#5f6873] shadow-[0_4px_10px_rgba(63,70,82,0.12)]',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2.6} />
      </div>
    </div>
  );
};

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
        'rounded-xl sm:rounded-2xl bg-[#4f46e5] font-black tracking-tight text-white shadow-[0_12px_30px_rgba(79,70,229,0.18)]',
        size === 'small'
          ? 'px-2.5 py-1 sm:px-3.5 sm:py-1.5 text-[12px] sm:text-[13px]'
          : 'px-3 py-1.5 sm:px-4 sm:py-2 text-base sm:text-lg',
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
          'flex items-center gap-1.5 rounded-xl sm:rounded-2xl font-black tracking-wide transition-all',
          size === 'small'
            ? 'px-2 py-1 sm:px-2.5 sm:py-1.5 text-[7px] sm:text-[9px]'
            : 'px-2.5 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs',
          audioLocale === loc
            ? 'bg-[#4f46e5] text-white shadow-[0_10px_24px_rgba(79,70,229,0.16)]'
            : 'bg-[#eef2ff] text-[#4f46e5] hover:bg-[#e0e7ff]',
        )}
      >
        {activePronunciationLocale === loc ? (
          <Loader2
            className={cx('animate-spin', size === 'small' ? 'h-2.5 w-2.5 sm:h-3 sm:w-3' : 'h-3 w-3 sm:h-3.5 sm:w-3.5')}
          />
        ) : (
          <Volume2 className={size === 'small' ? 'h-2.5 w-2.5 sm:h-3 sm:w-3' : 'h-3 w-3 sm:h-3.5 sm:w-3.5'} />
        )}
        {loc.toUpperCase()}
      </button>
    ))}
  </div>
);
