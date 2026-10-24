import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ease } from '../../lib/motion';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Loader2,
  GraduationCap,
  Award,
  Library,
  BookMarked,
  Medal,
  Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { type OfficialLibraryDefinition, resolveOfficialLibraryStartMode } from '../../lib/officialLibrary';
import type { OfficialLibrarySummary, Word } from '../../types';

type Stage = 'idle' | 'resuming' | 'error';

interface OfficialLibraryPanelProps {
  definition: OfficialLibraryDefinition;
  summary: OfficialLibrarySummary;
  onStartLearning: (groupId: string, words?: Word[]) => Promise<void> | void;
  onOpenDetail?: () => void | Promise<void>;
  showOpenDetailAction?: boolean;
}

const ICON_MAP: Record<string, any> = {
  BookOpen,
  Sparkles,
  GraduationCap,
  Award,
  Library,
  BookMarked,
  Medal,
};

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function CompletionProgressRing({
  completedMemoryWordCount,
  totalWordCount,
}: {
  completedMemoryWordCount: number;
  totalWordCount: number;
}) {
  const radius = 53;
  const circumference = 2 * Math.PI * radius;
  const ratio = totalWordCount > 0 ? clampRatio(completedMemoryWordCount / totalWordCount) : 0;
  const strokeDashoffset = circumference * (1 - ratio);
  const percentage = Math.round(ratio * 100);

  return (
    <div
      className="relative h-[118px] w-[118px] shrink-0 sm:h-[124px] sm:w-[124px]"
      aria-label={`完成度 ${percentage}%，${completedMemoryWordCount} / ${totalWordCount} 词`}
    >
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
        <circle cx="66" cy="66" r={radius} fill="none" stroke="rgba(25,200,185,0.13)" strokeWidth="12" />
        <motion.circle
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          stroke="#007AFF"
          strokeWidth="12"
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.8, ease: ease.out }}
          style={{
            strokeDasharray: circumference,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <p className="text-2xl font-black tracking-tight text-text-primary sm:text-3xl">{percentage}%</p>
        <p className="mt-0.5 text-[11px] font-black text-text-secondary sm:text-xs">已完成</p>
        <p className="mt-1 text-[11px] font-bold text-text-secondary sm:text-xs">
          {completedMemoryWordCount} / {totalWordCount} 词
        </p>
      </div>
    </div>
  );
}

export function OfficialLibraryPanel({
  definition,
  summary,
  onStartLearning,
  onOpenDetail,
  showOpenDetailAction = true,
}: OfficialLibraryPanelProps) {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const LibraryIcon = ICON_MAP[definition.icon || 'BookOpen'] || BookOpen;

  const startMode = resolveOfficialLibraryStartMode(summary);
  const actionDisabled = startMode === 'completed';
  const resumeActive = startMode === 'resume';

  const ctaButtonLabel = actionDisabled ? '已完成' : resumeActive ? '继续学习' : '开始学习';

  const handleStartOfficial = async () => {
    if (startMode === 'resume' && summary.activeResumeCandidate) {
      setErrorMsg('');
      setStage('resuming');
      try {
        await onStartLearning(summary.activeResumeCandidate.groupId);
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : String(error));
        setStage('error');
      }
      return;
    }

    if (startMode === 'completed') return;
    navigate(`/app/home?officialLibraryId=${definition.id}`);
  };

  return (
    <AnimatePresence mode="wait">
      {(stage === 'idle' || stage === 'error') && (
        <motion.div
          key={`official-idle-${definition.id}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="relative w-full overflow-hidden rounded-[30px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(240,246,255,0.72))] p-5 sm:p-6 jelly-shadow"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-[linear-gradient(180deg,rgba(255,249,230,0.72),transparent)]" />
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-[linear-gradient(180deg,transparent,rgba(130,213,187,0.12))]" />
          <div className="relative space-y-4 sm:space-y-5">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[24px] bg-white text-apple-blue shadow-[0_14px_30px_rgba(25,200,185,0.10)] sm:h-16 sm:w-16">
                <LibraryIcon className="h-6 w-6 sm:h-8 sm:w-8" />
              </div>
              <h3 className="min-w-0 truncate text-[1.2rem] font-black leading-tight text-text-primary sm:text-2xl">
                {definition.title}
              </h3>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-0">
              <CompletionProgressRing
                completedMemoryWordCount={summary.completedMemoryWordCount}
                totalWordCount={summary.totalWordCount}
              />
              <div className="flex min-w-0 flex-[1_1_8rem] flex-col items-stretch gap-3">
                {showOpenDetailAction && onOpenDetail && (
                  <button
                    type="button"
                    onClick={() => {
                      void onOpenDetail();
                    }}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-white/88 px-3 text-[12px] font-bold text-text-secondary shadow-[0_8px_20px_rgba(0,0,0,0.05)] transition-colors hover:text-text-primary sm:h-11 sm:px-4 sm:text-sm"
                  >
                    查看词库
                    <ArrowRight className="h-3 w-3 sm:h-4 sm:w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void handleStartOfficial();
                  }}
                  disabled={actionDisabled}
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-[18px] bg-apple-blue px-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(25,200,185,0.25)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 sm:h-16 sm:rounded-[22px] sm:text-base"
                >
                  {ctaButtonLabel}
                  {!actionDisabled && <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {stage === 'error' && (
              <div className="max-w-3xl rounded-2xl bg-apple-red/10 p-3 text-sm font-medium text-apple-red">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {stage === 'resuming' && (
        <motion.div
          key={`official-${definition.id}-${stage}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="glass rounded-[34px] p-16 jelly-shadow"
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
            <div>
              <p className="text-xl font-black text-text-primary">正在恢复学习进度…</p>
              <p className="mt-1 text-sm text-text-secondary">将从上次保存的位置继续。</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
