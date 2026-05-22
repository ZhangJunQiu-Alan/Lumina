import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { WordPopover } from '../components/shared/WordPopover';

interface WordPopoverState {
  word: string;
  anchor: HTMLElement;
  key: number;
}

interface WordPopoverContextValue {
  openPopover: (word: string, anchor: HTMLElement) => void;
  closePopover: () => void;
}

const WordPopoverContext = createContext<WordPopoverContextValue | null>(null);

export function WordPopoverProvider({ children }: { children: ReactNode }) {
  const [popover, setPopover] = useState<WordPopoverState | null>(null);

  const closePopover = useCallback(() => {
    setPopover(null);
  }, []);

  const openPopover = useCallback((word: string, anchor: HTMLElement) => {
    const normalizedWord = word.trim().toLowerCase();
    if (!normalizedWord) return;

    setPopover((current) => {
      if (current?.word === normalizedWord && current.anchor === anchor) {
        return null;
      }

      return {
        word: normalizedWord,
        anchor,
        key: (current?.key ?? 0) + 1,
      };
    });
  }, []);

  const value = useMemo(() => ({
    openPopover,
    closePopover,
  }), [closePopover, openPopover]);

  return (
    <WordPopoverContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {popover && (
            <WordPopover
              key={popover.key}
              word={popover.word}
              anchor={popover.anchor}
              onClose={closePopover}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </WordPopoverContext.Provider>
  );
}

export function useWordPopover() {
  const context = useContext(WordPopoverContext);
  if (!context) {
    throw new Error('useWordPopover must be used within WordPopoverProvider');
  }

  return context;
}
