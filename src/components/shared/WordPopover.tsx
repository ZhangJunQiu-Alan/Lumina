import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { useSavedWords } from '../../contexts/SavedWordsContext';
import { type MemoryState, useWordLookup, type WordLookupResult } from '../../lib/wordLookup';
import { cx } from './LearningUI';

interface WordPopoverProps {
  word: string;
  anchor: HTMLElement;
  onClose: () => void;
}

interface PopoverPosition {
  top: number;
  left: number;
}

const POPOVER_WIDTH = 304;
const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 8;
const LARGE_SCROLL_CLOSE_PX = 180;

const SRS_BADGE_CONFIG: Record<MemoryState, { text: string; className: string }> = {
  new: { text: '未学习', className: 'bg-sky-50 text-sky-700' },
  fuzzy: { text: '模糊', className: 'bg-amber-50 text-amber-700' },
  slow_recall: { text: '记忆中', className: 'bg-blue-50 text-blue-700' },
  stable_recall: { text: '已记忆', className: 'bg-emerald-50 text-emerald-700' },
  mastered: { text: '已掌握', className: 'bg-violet-50 text-violet-700' },
};

function calculatePosition(anchor: HTMLElement, popover: HTMLElement | null): PopoverPosition | null {
  const anchorRect = anchor.getBoundingClientRect();
  if (anchorRect.width === 0 && anchorRect.height === 0) return null;
  if (anchorRect.bottom < 0 || anchorRect.top > window.innerHeight) return null;

  const popoverRect = popover?.getBoundingClientRect();
  const popoverWidth = popoverRect?.width ?? POPOVER_WIDTH;
  const popoverHeight = popoverRect?.height ?? 220;
  const anchorCenterX = anchorRect.left + (anchorRect.width / 2);
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - popoverWidth - VIEWPORT_MARGIN);
  const left = Math.min(
    Math.max(anchorCenterX - (popoverWidth / 2), VIEWPORT_MARGIN),
    maxLeft,
  );

  const belowTop = anchorRect.bottom + ANCHOR_GAP;
  const aboveTop = anchorRect.top - popoverHeight - ANCHOR_GAP;
  const hasRoomBelow = belowTop + popoverHeight <= window.innerHeight - VIEWPORT_MARGIN;
  const top = hasRoomBelow
    ? belowTop
    : Math.max(VIEWPORT_MARGIN, aboveTop);

  return { top, left };
}

function groupSenses(data: WordLookupResult | null | undefined) {
  const grouped = new Map<string, string[]>();

  for (const sense of data?.senses ?? []) {
    const pos = sense.pos.trim() || '未标注';
    const meaning = sense.meaning_zh.trim();
    if (!meaning) continue;

    const meanings = grouped.get(pos) ?? [];
    if (!meanings.includes(meaning)) {
      meanings.push(meaning);
    }
    grouped.set(pos, meanings);
  }

  const senses = [...grouped.entries()].map(([pos, meanings]) => ({
    pos,
    meaning: meanings.join('；'),
  }));

  const primaryMeaning = data?.vocabulary_item.primary_meaning_zh?.trim();
  if (senses.length === 0 && primaryMeaning) {
    return [{ pos: '未标注', meaning: primaryMeaning }];
  }

  return senses;
}

function WordPopoverSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-5 w-32 animate-pulse rounded-full bg-black/8" />
      <div className="h-8 w-44 animate-pulse rounded-xl bg-black/8" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded-full bg-black/8" />
        <div className="h-4 w-5/6 animate-pulse rounded-full bg-black/8" />
      </div>
    </div>
  );
}

export function WordPopover({ word, anchor, onClose }: WordPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const initialAnchorTopRef = useRef(anchor.getBoundingClientRect().top);
  const [position, setPosition] = useState<PopoverPosition | null>(() => calculatePosition(anchor, null));
  const [actionError, setActionError] = useState('');
  const [isMutating, setIsMutating] = useState(false);
  const { saveWord, removeWord } = useSavedWords();
  const { data, loading } = useWordLookup(word);
  const senses = groupSenses(data);
  const srsBadge = data?.srs_state ? SRS_BADGE_CONFIG[data.srs_state] : null;
  const canMutateLibrary = Boolean(data && !data.srs_state);

  const refreshPosition = useCallback(() => {
    const nextPosition = calculatePosition(anchor, popoverRef.current);
    if (!nextPosition) {
      onClose();
      return;
    }
    setPosition(nextPosition);
  }, [anchor, onClose]);

  useLayoutEffect(() => {
    initialAnchorTopRef.current = anchor.getBoundingClientRect().top;
    refreshPosition();
  }, [anchor, data, loading, refreshPosition]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchor.contains(target)) return;
      onClose();
    };

    const handleScroll = () => {
      const currentTop = anchor.getBoundingClientRect().top;
      if (Math.abs(currentTop - initialAnchorTopRef.current) > LARGE_SCROLL_CLOSE_PX) {
        onClose();
        return;
      }
      refreshPosition();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', refreshPosition);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', refreshPosition);
    };
  }, [anchor, onClose, refreshPosition]);

  const handleLibraryAction = async () => {
    if (!data || !canMutateLibrary || isMutating) return;

    setIsMutating(true);
    setActionError('');
    try {
      if (data.in_user_library) {
        await removeWord(data.vocabulary_item.id);
      } else {
        await saveWord(data.vocabulary_item.id, 'reading_popup');
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '词库操作失败，请稍后再试。');
    } finally {
      setIsMutating(false);
    }
  };

  if (!position) return null;

  return (
    <motion.div
      ref={popoverRef}
      initial={{ opacity: 0, scale: 0.98, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: 4 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
      className="fixed z-[80] overflow-hidden rounded-[22px] border border-white/80 bg-white/95 p-4 text-left shadow-[0_24px_70px_rgba(14,26,56,0.18)] backdrop-blur-xl"
      role="dialog"
      aria-label={`${word} 释义`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-base font-black text-text-primary">
              {data?.vocabulary_item.word ?? word}
            </p>
            {srsBadge && (
              <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black', srsBadge.className)}>
                {srsBadge.text}
              </span>
            )}
          </div>
          {data?.vocabulary_item.word && data.vocabulary_item.word !== word && (
            <p className="mt-0.5 text-xs font-bold text-text-secondary">来自 {word}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
          aria-label="关闭查词浮窗"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <WordPopoverSkeleton />
      ) : data ? (
        <div className="space-y-4">
          <div className="space-y-2">
            {senses.length > 0 ? senses.map((sense) => (
              <div key={`${sense.pos}-${sense.meaning}`} className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0 whitespace-nowrap rounded-full bg-black/5 px-2.5 py-1 text-center text-[10px] font-black uppercase leading-none tracking-wide text-text-secondary">
                  {sense.pos}
                </span>
                <p className="min-w-0 text-sm font-bold leading-6 text-text-primary">{sense.meaning}</p>
              </div>
            )) : (
              <p className="text-sm font-bold text-text-secondary">暂无词性释义</p>
            )}
          </div>

          {canMutateLibrary && (
            <button
              type="button"
              onClick={handleLibraryAction}
              disabled={isMutating}
              className={cx(
                'flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] px-4 py-2.5 text-sm font-black transition-all active:scale-[0.98] disabled:cursor-wait disabled:opacity-70',
                data.in_user_library
                  ? 'bg-apple-red/8 text-apple-red hover:bg-apple-red/12'
                  : 'bg-apple-blue text-white shadow-[0_12px_30px_rgba(0,122,255,0.22)] hover:bg-apple-blue/90',
              )}
            >
              {isMutating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : data.in_user_library ? (
                <Trash2 className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {data.in_user_library ? '从词库移除' : '加入词库'}
            </button>
          )}

          {actionError && (
            <p className="text-xs font-bold leading-5 text-apple-red">{actionError}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-base font-black text-text-primary">暂时无法查询这个词</p>
          <p className="text-sm leading-6 text-text-secondary">可以稍后再试。</p>
        </div>
      )}
    </motion.div>
  );
}
