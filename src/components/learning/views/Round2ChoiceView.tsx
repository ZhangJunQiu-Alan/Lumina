import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { duration, ease, pulse, shake, spring } from '../../../lib/motion';
import { cx } from '../../shared/LearningUI';
import { formatClozeWordInfo } from '../learningEngineUtils';

export interface Round2ChoiceOption {
  id: string;
  word: string;
  pos: string;
  meaningZh: string;
  isCorrect: boolean;
}

export interface Round2ChoiceSelection {
  wordId: string;
  optionId: string;
  wasCorrect: boolean;
}

export interface Round2ChoiceViewProps {
  options: Round2ChoiceOption[];
  activeSelection: Round2ChoiceSelection | null;
  isRevealed: boolean;
  isViewingHistory: boolean;
  onSelect: (option: Round2ChoiceOption) => void;
}

export const Round2ChoiceView: React.FC<Round2ChoiceViewProps> = ({
  options,
  activeSelection,
  isRevealed,
  isViewingHistory,
  onSelect,
}) => {
  return (
    <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
      {options.map((option, index) => {
        const isSelected = activeSelection?.optionId === option.id;
        const isWrongSelection = isRevealed && isSelected && !option.isCorrect;
        const label = formatClozeWordInfo(option.pos, option.meaningZh) || option.meaningZh || option.word;
        const displayLabel = isRevealed ? `${label}：${option.word}` : label;
        const feedback = isViewingHistory
          ? null
          : isWrongSelection
            ? shake
            : isRevealed && option.isCorrect
              ? pulse
              : null;

        return (
          <motion.button
            key={option.id}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={
              feedback
                ? { opacity: 1, y: 0, ...feedback }
                : { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out, delay: index * 0.04 } }
            }
            onClick={() => onSelect(option)}
            disabled={isViewingHistory || Boolean(activeSelection)}
            aria-label={`Round2 选项 ${displayLabel}`}
            className={cx(
              'flex min-h-[5rem] w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-base font-black leading-7 shadow-[0_14px_34px_rgba(14,26,56,0.06)] transition-[color,background-color,border-color,box-shadow,translate,scale] active:scale-[0.99] disabled:cursor-default sm:px-5',
              !isRevealed && 'border-white/80 bg-white/78 text-text-primary hover:-translate-y-0.5 hover:bg-white',
              isRevealed &&
                option.isCorrect &&
                'border-[#16A34A]/25 bg-[#ECFDF5] text-[#15803D] shadow-[0_14px_34px_rgba(22,163,74,0.12)]',
              isWrongSelection &&
                'border-apple-red/30 bg-apple-red/10 text-apple-red shadow-[0_14px_34px_rgba(224,90,90,0.12)]',
              isRevealed &&
                !option.isCorrect &&
                !isWrongSelection &&
                'border-white/70 bg-white/58 text-text-secondary/70',
            )}
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">{displayLabel}</span>
            {(isRevealed && option.isCorrect) || isWrongSelection ? (
              <motion.span
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={spring.pop}
                className="shrink-0"
              >
                {isWrongSelection ? <XCircle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </motion.span>
            ) : null}
          </motion.button>
        );
      })}
    </div>
  );
};
