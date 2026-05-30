import { Loader2, Volume2 } from 'lucide-react';
import { PronunciationLocale } from '../../types';
import { ClickableText, type WordClickHandler } from './ClickableText';

export interface ExampleSentenceItem {
  key: string;
  sentence: string;
  translation?: string;
}

type ExampleSentenceVariant = 'panel' | 'drawer' | 'inline';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function renderSentenceText(text: string, onWordClick?: WordClickHandler, targetWords?: ReadonlySet<string>) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, index) => {
    if (!part) return null;

    const content = onWordClick ? (
      <ClickableText text={part} targetWords={targetWords} onWordClick={onWordClick} stopPropagation />
    ) : (
      part
    );

    return index % 2 === 1 ? <strong key={index}>{content}</strong> : <span key={index}>{content}</span>;
  });
}

function getAriaLabel(locale: PronunciationLocale, isPlaying: boolean) {
  const localeLabel = locale === 'uk' ? '英音' : '美音';
  return `${isPlaying ? '停止' : '播放'}例句${localeLabel}`;
}

export function ExampleSentenceList({
  items,
  locale,
  activeExampleKey,
  canPlayAudio,
  onPlayExample,
  emptyMessage,
  variant = 'panel',
  targetWords,
  onWordClick,
}: {
  items: ExampleSentenceItem[];
  locale: PronunciationLocale;
  activeExampleKey: string | null;
  canPlayAudio: boolean;
  onPlayExample: (item: ExampleSentenceItem) => void;
  emptyMessage: string;
  variant?: ExampleSentenceVariant;
  targetWords?: ReadonlySet<string>;
  onWordClick?: WordClickHandler;
}) {
  const listClassName = variant === 'drawer' ? 'mt-3 space-y-4' : 'space-y-3';
  const cardClassName =
    variant === 'panel'
      ? 'rounded-[18px] border border-white/85 bg-white/75 px-4 py-3'
      : variant === 'drawer'
        ? 'rounded-2xl bg-black/5 px-4 py-3'
        : 'rounded-[20px] border border-black/6 bg-white/55 px-4 py-3 text-left shadow-[0_12px_30px_rgba(14,26,56,0.04)]';
  const sentenceClassName =
    variant === 'panel'
      ? 'text-[18px] leading-[1.75] text-text-primary'
      : variant === 'drawer'
        ? 'text-sm leading-6 text-text-primary'
        : 'text-base leading-7 text-text-primary';
  const translationClassName =
    variant === 'drawer' ? 'mt-1 text-xs leading-5 text-text-secondary' : 'mt-2 text-sm leading-6 text-text-secondary';
  const buttonClassName =
    variant === 'drawer'
      ? 'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-text-secondary shadow-[0_10px_22px_rgba(0,0,0,0.06)] transition-colors hover:text-text-primary'
      : 'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/88 text-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.08)] transition-colors hover:text-text-primary';
  const emptyClassName =
    variant === 'panel'
      ? 'rounded-[18px] border border-dashed border-black/8 bg-white/45 px-4 py-4 text-[18px] leading-[1.75] text-text-secondary'
      : 'mt-3 text-sm leading-6 text-text-secondary';

  if (items.length === 0) {
    return <p className={emptyClassName}>{emptyMessage}</p>;
  }

  return (
    <div className={listClassName}>
      {items.map((item) => {
        const isPlaying = activeExampleKey === item.key;

        return (
          <div key={item.key} className={cardClassName}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className={sentenceClassName}>{renderSentenceText(item.sentence, onWordClick, targetWords)}</p>
                {item.translation && <p className={translationClassName}>{item.translation}</p>}
              </div>
              <button
                type="button"
                onClick={() => onPlayExample(item)}
                disabled={!canPlayAudio}
                aria-label={getAriaLabel(locale, isPlaying)}
                className={cx(
                  buttonClassName,
                  !canPlayAudio && 'cursor-not-allowed opacity-45 hover:text-text-secondary',
                  isPlaying && 'text-apple-blue',
                )}
              >
                {isPlaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
