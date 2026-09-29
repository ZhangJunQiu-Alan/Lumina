import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { duration, ease } from '../../../lib/motion';
import { BookMarked, CheckCircle2, Flag, Loader2, MoreHorizontal, X, XCircle } from 'lucide-react';
import { cx } from '../../shared/LearningUI';
import { type ActionFeedback, type SessionActionKind, VOCABULARY_ISSUE_OPTIONS } from '../learningEngineUtils';
import type { VocabularyIssueType } from '../../../lib/vocabReportApi';

export interface ActionFeedbackToastProps {
  feedback: ActionFeedback | null;
}

export const ActionFeedbackToast: React.FC<ActionFeedbackToastProps> = ({ feedback }) => (
  <AnimatePresence>
    {feedback && (
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        className={cx(
          'fixed bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] left-1/2 z-[110] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-[18px] px-4 py-3 text-sm font-black text-white shadow-[0_20px_52px_rgba(0,0,0,0.22)]',
          feedback.tone === 'error' ? 'bg-apple-red' : 'bg-[#222222]',
        )}
      >
        {feedback.tone === 'error' ? (
          <XCircle className="h-4 w-4 shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7ddc8a]" />
        )}
        <span className="min-w-0 truncate">{feedback.text}</span>
      </motion.div>
    )}
  </AnimatePresence>
);

export interface ReportIssueSheetProps {
  isOpen: boolean;
  onClose: () => void;
  targetWordName: string;
  issueType: VocabularyIssueType;
  onSelectIssueType: (type: VocabularyIssueType) => void;
  note: string;
  onChangeNote: (note: string) => void;
  activeActionKind: SessionActionKind | null;
  onSubmit: () => void;
}

export const ReportIssueSheet: React.FC<ReportIssueSheetProps> = ({
  isOpen,
  onClose,
  targetWordName,
  issueType,
  onSelectIssueType,
  note,
  onChangeNote,
  activeActionKind,
  onSubmit,
}) => (
  <AnimatePresence>
    {isOpen && (
      <motion.div
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/18 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => {
          if (activeActionKind !== 'report') {
            onClose();
          }
        }}
      >
        <motion.div
          initial={{ y: 24, scale: 0.98 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ y: 24, scale: 0.98 }}
          transition={{ duration: duration.fast, ease: ease.out }}
          className="w-full max-w-md rounded-[28px] border border-white/85 bg-white/95 p-4 shadow-[0_28px_70px_rgba(61,52,40,0.22)] backdrop-blur-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-text-primary">报告问题</p>
              <p className="mt-0.5 truncate text-xs font-bold text-text-secondary">{targetWordName}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={activeActionKind === 'report'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-text-secondary transition-colors hover:bg-black/8 disabled:opacity-50"
              aria-label="关闭报告问题"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {VOCABULARY_ISSUE_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => onSelectIssueType(option.type)}
                disabled={activeActionKind === 'report'}
                className={cx(
                  'min-h-10 rounded-[15px] px-3 text-sm font-black transition-all disabled:opacity-60',
                  issueType === option.type
                    ? 'bg-[#4f46e5] text-white shadow-[0_12px_26px_rgba(79,70,229,0.18)]'
                    : 'bg-black/5 text-text-primary hover:bg-black/8',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <textarea
            value={note}
            onChange={(event) => onChangeNote(event.target.value.slice(0, 1000))}
            disabled={activeActionKind === 'report'}
            rows={4}
            className="mt-3 w-full resize-none rounded-[18px] border border-black/8 bg-white/75 px-3 py-3 text-sm font-bold leading-6 text-text-primary outline-none transition-colors placeholder:text-text-secondary/50 focus:border-[#4f46e5]/35 disabled:opacity-60"
            placeholder="哪里不对？可选"
          />

          <button
            type="button"
            onClick={onSubmit}
            disabled={activeActionKind === 'report'}
            className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-[#4f46e5] px-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(79,70,229,0.20)] transition-all active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
          >
            {activeActionKind === 'report' && <Loader2 className="h-4 w-4 animate-spin" />}
            提交
          </button>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

export interface WordActionMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onMarkMastered: () => void;
  onSaveWord: () => void;
  onOpenReportSheet: () => void;
  activeActionKind: SessionActionKind | null;
  className?: string;
  menuRef?: React.RefObject<HTMLDivElement | null>;
}

export const WordActionMenu: React.FC<WordActionMenuProps> = ({
  isOpen,
  onToggle,
  onMarkMastered,
  onSaveWord,
  onOpenReportSheet,
  activeActionKind,
  className = '!absolute right-3 top-3 z-30',
  menuRef,
}) => (
  <div
    ref={menuRef}
    className={className}
    style={{ zIndex: 80 }}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
  >
    <button
      type="button"
      aria-label="更多操作"
      aria-expanded={isOpen}
      onClick={onToggle}
      className={cx(
        'flex h-11 w-11 items-center justify-center rounded-[18px] border border-white/85 bg-white/82 text-[#8f826d] shadow-[0_12px_26px_rgba(61,52,40,0.10)] backdrop-blur-xl transition-all active:scale-95 sm:h-12 sm:w-12',
        isOpen && 'text-[#4f46e5] shadow-[0_14px_30px_rgba(79,70,229,0.14)]',
      )}
    >
      <MoreHorizontal className="h-5 w-5" strokeWidth={2.7} />
    </button>

    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: duration.fast, ease: ease.out }}
          className="absolute right-0 top-[3.25rem] z-[90] w-52 overflow-hidden rounded-[22px] border border-white/85 bg-white/92 p-1.5 text-left shadow-[0_22px_56px_rgba(61,52,40,0.18)] backdrop-blur-xl"
        >
          <button
            type="button"
            onClick={onMarkMastered}
            disabled={Boolean(activeActionKind)}
            className="flex min-h-11 w-full items-center gap-3 rounded-[17px] px-3.5 text-sm font-black text-apple-red transition-colors hover:bg-apple-red/8 disabled:cursor-wait disabled:opacity-60"
          >
            {activeActionKind === 'mastered' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            标记已掌握
          </button>
          <button
            type="button"
            onClick={onSaveWord}
            disabled={Boolean(activeActionKind)}
            className="flex min-h-11 w-full items-center gap-3 rounded-[17px] px-3.5 text-sm font-black text-text-primary transition-colors hover:bg-black/5 disabled:cursor-wait disabled:opacity-60"
          >
            {activeActionKind === 'save' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BookMarked className="h-4 w-4" />
            )}
            加入个人词库
          </button>
          <button
            type="button"
            onClick={onOpenReportSheet}
            disabled={Boolean(activeActionKind)}
            className="flex min-h-11 w-full items-center gap-3 rounded-[17px] px-3.5 text-sm font-black text-text-primary transition-colors hover:bg-black/5 disabled:cursor-wait disabled:opacity-60"
          >
            <Flag className="h-4 w-4" />
            报告问题
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);
