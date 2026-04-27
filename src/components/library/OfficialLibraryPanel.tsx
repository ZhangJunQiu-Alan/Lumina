import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ListOrdered,
  Loader2,
  Shuffle,
  GraduationCap,
  Award,
  Library,
  BookMarked,
  Medal,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { attemptBuffer } from '../../lib/attemptBuffer';
import { resolveBrowserTimeZone } from '../../lib/homeApi';
import {
  createLearningGroupFromVocabularyEntries,
  fetchVocabularyEntriesByWords,
  persistEnrichedVocabularyEntries,
  type PersistedVocabularyEntry,
} from '../../lib/importFlow';
import {
  getCachedOfficialLearnedWords,
  invalidateLibraryCache,
  isLibraryCacheFresh,
  refreshOfficialLearnedWords,
} from '../../lib/libraryCache';
import { fetchOfficialLearnedWords } from '../../lib/libraryApi';
import {
  getOfficialNextBatch,
  type OfficialLibraryDefinition,
  type OfficialStudyMode,
  resolveOfficialLibraryStartMode,
  resolveOfficialStudyModeFromGroupName,
} from '../../lib/officialLibrary';
import { useAuth } from '../../contexts/AuthContext';
import type { EnrichedWord, OfficialLibrarySummary, Word } from '../../types';
import { normalizeWordKey } from '../../../shared/wordBatch';

type Stage = 'idle' | 'preparing' | 'resuming' | 'error';

interface OfficialLibraryPanelProps {
  definition: OfficialLibraryDefinition;
  summary: OfficialLibrarySummary;
  existingGroupCount: number;
  onStartLearning: (groupId: string, words?: Word[]) => Promise<void> | void;
  onOpenDetail?: () => void | Promise<void>;
  onLibraryMutated?: () => void | Promise<void>;
  showOpenDetailAction?: boolean;
}

const officialStudyModeLabel: Record<OfficialStudyMode, string> = {
  sequential: '顺序',
  shuffle: '随机',
};

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
      className="relative h-[132px] w-[132px] shrink-0"
      aria-label={`完成度 ${percentage}%，${completedMemoryWordCount} / ${totalWordCount} 词`}
    >
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
        <circle
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          stroke="rgba(0,122,255,0.13)"
          strokeWidth="12"
        />
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
          transition={{ duration: 0.8, ease: 'easeOut' }}
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

function SwitchOfficialModeDialog({
  currentMode,
  nextMode,
  groupTitle,
  isConfirming,
  onCancel,
  onConfirm,
}: {
  currentMode: OfficialStudyMode;
  nextMode: OfficialStudyMode;
  groupTitle: string;
  isConfirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <motion.button
        type="button"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={isConfirming ? undefined : onCancel}
        className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="fixed inset-x-6 top-1/2 z-[70] mx-auto w-full max-w-xl -translate-y-1/2 rounded-[32px] border border-white/70 bg-white/90 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.16)] backdrop-blur-2xl"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-apple-red/10 text-apple-red">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">切换官方路径模式</p>
            <h3 className="mt-3 text-2xl font-black text-text-primary">要放弃上一组并切换吗？</h3>
            <p className="mt-3 text-sm leading-7 text-text-secondary">
              当前是{officialStudyModeLabel[currentMode]}学习，切到{officialStudyModeLabel[nextMode]}后，
              上一组未完成进度会被丢掉。已经实际学过的词会保留为模糊状态进入复习计划，没学过的词会回到官方词池。
            </p>
            <p className="mt-4 rounded-2xl bg-black/5 px-4 py-3 text-sm font-bold text-text-primary">
              {groupTitle}
            </p>
          </div>
        </div>

        <div className="mt-7 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-[22px] bg-black/5 px-5 py-3 text-sm font-bold text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            继续上一组
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="inline-flex items-center gap-2 rounded-[22px] bg-apple-red px-5 py-3 text-sm font-black text-white shadow-[0_18px_34px_rgba(255,59,48,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
          >
            {isConfirming && <Loader2 className="h-4 w-4 animate-spin" />}
            确认切换到{officialStudyModeLabel[nextMode]}
          </button>
        </div>
      </motion.div>
    </>
  );
}

export function OfficialLibraryPanel({
  definition,
  summary,
  existingGroupCount,
  onStartLearning,
  onOpenDetail,
  onLibraryMutated,
  showOpenDetailAction = true,
}: OfficialLibraryPanelProps) {
  const { user } = useAuth();
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [mode, setMode] = useState<OfficialStudyMode>('sequential');
  const [pendingSwitchMode, setPendingSwitchMode] = useState<OfficialStudyMode | null>(null);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);

  const LibraryIcon = ICON_MAP[definition.icon || 'BookOpen'] || BookOpen;

  const startMode = resolveOfficialLibraryStartMode(summary);
  const actionDisabled = startMode === 'completed';
  const resumeActive = startMode === 'resume';
  const activeResumeMode = summary.activeResumeCandidate
    ? resolveOfficialStudyModeFromGroupName(definition.id, summary.activeResumeCandidate.groupTitle)
    : null;

  useEffect(() => {
    if (!summary.activeResumeCandidate || !activeResumeMode) return;
    setMode(activeResumeMode);
  }, [activeResumeMode, summary.activeResumeCandidate?.groupId]);

  const ctaButtonLabel = actionDisabled
    ? '已完结'
    : resumeActive
      ? '继续学习'
      : '开始学习';

  const resolveLearnedWords = async (userId: string): Promise<Set<string>> => {
    const cached = getCachedOfficialLearnedWords(userId, definition.id);
    if (cached && isLibraryCacheFresh(cached)) {
      return cached.data;
    }
    return refreshOfficialLearnedWords(userId, definition.id, () =>
      fetchOfficialLearnedWords(userId, definition.id),
    );
  };

  const startNextOfficialBatch = async (
    selectedMode: OfficialStudyMode,
    groupCountForNaming = existingGroupCount,
  ) => {
    if (!user) {
      setErrorMsg('先登录，再把官方词库接进系统。');
      setStage('error');
      return;
    }

    setErrorMsg('');
    try {
      setStage('preparing');

      const learnedSet = await resolveLearnedWords(user.id);
      const nextBatch = getOfficialNextBatch(
        definition.id,
        learnedSet,
        selectedMode,
        groupCountForNaming,
        summary.progress,
      );
      if (!nextBatch) {
        setStage('idle');
        return;
      }

      const { existing, missing } = await fetchVocabularyEntriesByWords(nextBatch.words);
      const existingByWord = new Map(
        existing.map((entry) => [normalizeWordKey(entry.word), entry]),
      );

      let persistedEntries = existing;

      if (missing.length > 0) {
        const res = await apiFetch('/api/vocab/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: missing }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const { data } = await res.json() as { data: EnrichedWord[] };
        const persistedMissingEntries = await persistEnrichedVocabularyEntries(data, {
          sourceType: 'system',
        });
        const missingByWord = new Map(
          persistedMissingEntries.map((entry) => [normalizeWordKey(entry.word), entry]),
        );

        persistedEntries = nextBatch.words.map((word) => {
          const normalizedWord = normalizeWordKey(word);
          return existingByWord.get(normalizedWord) ?? missingByWord.get(normalizedWord);
        }).filter((entry): entry is PersistedVocabularyEntry => Boolean(entry));

        if (persistedEntries.length !== nextBatch.words.length) {
          throw new Error('这批官方词暂时没整理完整，再试一次。');
        }
      }

      const result = await createLearningGroupFromVocabularyEntries(user.id, persistedEntries, {
        groupName: nextBatch.groupName,
        groupSourceType: 'system',
        libraryId: definition.id,
      });

      invalidateLibraryCache(user.id);

      try {
        await onLibraryMutated?.();
      } catch {
        // Stats refresh should never block the learning flow.
      }

      await onStartLearning(result.groupId, result.words);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      setStage('error');
    }
  };

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
    await startNextOfficialBatch(mode);
  };

  const handleModeOptionClick = (option: OfficialStudyMode) => {
    if (actionDisabled || option === mode) return;

    if (resumeActive && summary.activeResumeCandidate) {
      setErrorMsg('');
      setPendingSwitchMode(option);
      return;
    }

    setMode(option);
  };

  const parseApiError = async (response: Response) => {
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    return (payload as { error?: string }).error ?? `HTTP ${response.status}`;
  };

  const handleConfirmSwitchMode = async () => {
    if (!user || !summary.activeResumeCandidate || !pendingSwitchMode) return;

    const selectedMode = pendingSwitchMode;
    setIsSwitchingMode(true);
    setErrorMsg('');

    try {
      await attemptBuffer.flush();
      const response = await apiFetch(`/api/library/official/${definition.id}/discard-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: summary.activeResumeCandidate.groupId,
          timeZone: resolveBrowserTimeZone(),
        }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      invalidateLibraryCache(user.id);

      try {
        await onLibraryMutated?.();
      } catch {
        // Stats refresh should never block the learning flow.
      }

      setPendingSwitchMode(null);
      setMode(selectedMode);
      await startNextOfficialBatch(selectedMode, Math.max(existingGroupCount - 1, 0));
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      setStage('error');
    } finally {
      setIsSwitchingMode(false);
    }
  };

  const handleStartReinforcement = async () => {
    if (!summary.reinforcementCandidate) return;

    setErrorMsg('');
    setStage('resuming');
    try {
      await onStartLearning(summary.reinforcementCandidate.groupId);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      setStage('error');
    }
  };

  return (
    <AnimatePresence mode="wait">
      {(stage === 'idle' || stage === 'error') && (
        <motion.div
          key={`official-idle-${definition.id}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="relative w-full overflow-hidden rounded-[30px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(240,246,255,0.72))] p-5 sm:p-7 jelly-shadow"
        >
          <div className="pointer-events-none absolute -right-12 top-0 h-44 w-44 rounded-full bg-apple-blue/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 rounded-full bg-apple-teal/10 blur-3xl" />
          <div className="relative space-y-5 sm:space-y-6">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[24px] bg-white text-apple-blue shadow-[0_14px_30px_rgba(0,122,255,0.10)] sm:h-16 sm:w-16">
                <LibraryIcon className="h-6 w-6 sm:h-8 sm:w-8" />
              </div>
              <h3 className="min-w-0 truncate text-2xl font-black leading-tight text-text-primary sm:text-3xl">
                {definition.title}
              </h3>
            </div>

            <div className="flex items-center gap-2">
              {showOpenDetailAction && onOpenDetail && (
                <button
                  type="button"
                  onClick={() => { void onOpenDetail(); }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/88 px-3 py-1.5 text-[11px] font-bold text-text-secondary shadow-[0_8px_20px_rgba(0,0,0,0.05)] transition-colors hover:text-text-primary sm:px-4 sm:py-2 sm:text-sm"
                >
                  看这条路径
                  <ArrowRight className="h-3 w-3 sm:h-4 sm:w-4" />
                </button>
              )}

              <div
                role="tablist"
                aria-label="选择发放顺序"
                className="inline-flex min-w-0 items-center gap-0.5 rounded-full bg-white/78 p-0.5 shadow-[0_8px_18px_rgba(0,0,0,0.05)] sm:p-1"
              >
                {(['sequential', 'shuffle'] as OfficialStudyMode[]).map((option) => {
                  const active = mode === option;
                  const label = option === 'shuffle' ? '随机' : '顺序';
                  const Icon = option === 'shuffle' ? Shuffle : ListOrdered;
                  const hint = option === 'shuffle' ? '从没学过的词里抽下一批' : '按官方顺序取下一批';
                  return (
                    <button
                      key={option}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={hint}
                      onClick={() => handleModeOptionClick(option)}
                      disabled={actionDisabled}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-bold transition-colors sm:px-4 sm:text-sm ${
                        active
                          ? 'bg-apple-blue text-white shadow-[0_8px_16px_rgba(0,122,255,0.24)]'
                          : 'text-text-secondary hover:text-text-primary'
                      } ${actionDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 pt-1">
              <CompletionProgressRing
                completedMemoryWordCount={summary.completedMemoryWordCount}
                totalWordCount={summary.totalWordCount}
              />
              <button
                type="button"
                onClick={() => {
                  void handleStartOfficial();
                }}
                disabled={actionDisabled}
                className="inline-flex h-14 min-w-[118px] flex-1 items-center justify-center gap-2 rounded-[18px] bg-apple-blue px-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(0,122,255,0.25)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 sm:h-16 sm:min-w-[146px] sm:flex-none sm:rounded-[22px] sm:text-base"
              >
                {ctaButtonLabel}
                {!actionDisabled && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>

            {summary.reinforcementCandidate && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/70 bg-white/72 px-4 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.05)]">
                <div>
                  <p className="text-sm font-black text-text-primary">上一组主线已完成，还可以继续做加固</p>
                  <p className="mt-1 text-sm text-text-secondary">
                    会直接回到 {summary.reinforcementCandidate.groupTitle} 的
                    {summary.reinforcementCandidate.round === 'round3' ? ' Round 3' : ' 文章巩固'}。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleStartReinforcement();
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-apple-blue shadow-[0_10px_24px_rgba(0,0,0,0.05)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
                >
                  继续加固上一组
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {stage === 'error' && (
              <div className="max-w-3xl rounded-2xl bg-apple-red/10 p-3 text-sm font-medium text-apple-red">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              </div>
            )}
          </div>

          {pendingSwitchMode && summary.activeResumeCandidate && typeof document !== 'undefined' && createPortal(
            <SwitchOfficialModeDialog
              currentMode={activeResumeMode ?? mode}
              nextMode={pendingSwitchMode}
              groupTitle={summary.activeResumeCandidate.groupTitle}
              isConfirming={isSwitchingMode}
              onCancel={() => {
                if (isSwitchingMode) return;
                setPendingSwitchMode(null);
              }}
              onConfirm={() => { void handleConfirmSwitchMode(); }}
            />,
            document.body,
          )}
        </motion.div>
      )}

      {(stage === 'preparing' || stage === 'resuming') && (
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
              <p className="text-xl font-black text-text-primary">
                {stage === 'resuming' ? '正在把你接回上次那一组…' : '这批官方词正在整理中…'}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                {stage === 'resuming'
                  ? '会直接回到上次那一轮、那个词位。'
                  : '先看系统里有没有，缺的再补齐；准备好就直接开始。'}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
