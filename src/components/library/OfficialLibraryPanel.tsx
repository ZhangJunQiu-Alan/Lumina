import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowRight, BookOpen, ListOrdered, Loader2, Shuffle } from 'lucide-react';
import { apiFetch } from '../../lib/api';
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

const infoCardClassName =
  'flex h-[76px] min-w-0 items-center justify-between rounded-[22px] bg-white/84 px-4 shadow-[0_12px_28px_rgba(0,0,0,0.05)]';

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

  const startMode = resolveOfficialLibraryStartMode(summary);
  const actionDisabled = startMode === 'completed';
  const resumeActive = startMode === 'resume';

  const ctaLabel = actionDisabled
    ? '这条路径已走完'
    : resumeActive
      ? '接上上次那组'
      : '开始下一批';

  const resolveLearnedWords = async (userId: string): Promise<Set<string>> => {
    const cached = getCachedOfficialLearnedWords(userId, definition.id);
    if (cached && isLibraryCacheFresh(cached)) {
      return cached.data;
    }
    return refreshOfficialLearnedWords(userId, definition.id, () =>
      fetchOfficialLearnedWords(userId, definition.id),
    );
  };

  const handleStartOfficial = async () => {
    if (!user) {
      setErrorMsg('先登录，再把官方词库接进系统。');
      setStage('error');
      return;
    }

    setErrorMsg('');

    try {
      if (startMode === 'resume' && summary.activeResumeCandidate) {
        setStage('resuming');
        await onStartLearning(summary.activeResumeCandidate.groupId);
        return;
      }

      if (startMode === 'completed') return;

      setStage('preparing');

      const learnedSet = await resolveLearnedWords(user.id);
      const nextBatch = getOfficialNextBatch(
        definition.id,
        learnedSet,
        mode,
        existingGroupCount,
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
          className="relative w-full overflow-hidden rounded-[34px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(240,246,255,0.72))] p-6 md:p-7 jelly-shadow"
        >
          <div className="pointer-events-none absolute -right-12 top-0 h-44 w-44 rounded-full bg-apple-blue/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 rounded-full bg-apple-teal/10 blur-3xl" />
          <div className="relative space-y-5">
            <div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-white text-apple-blue shadow-[0_14px_34px_rgba(0,0,0,0.06)]">
                    <BookOpen className="h-7 w-7" />
                  </div>
                  <h3 className="text-3xl font-black leading-tight text-text-primary">
                    {definition.title}
                  </h3>
                </div>
                {showOpenDetailAction && onOpenDetail && (
                  <button
                    type="button"
                    onClick={() => { void onOpenDetail(); }}
                    className="inline-flex items-center gap-2 rounded-full bg-white/82 px-4 py-2 text-sm font-bold text-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.05)] transition-colors hover:text-text-primary"
                  >
                    看这条路径
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div
              role="tablist"
              aria-label="选择发放顺序"
              className="inline-flex items-center gap-1 rounded-full bg-white/72 p-1 shadow-[0_10px_24px_rgba(0,0,0,0.05)]"
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
                    onClick={() => setMode(option)}
                    disabled={resumeActive || actionDisabled}
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
                      active
                        ? 'bg-apple-blue text-white shadow-[0_8px_18px_rgba(0,122,255,0.22)]'
                        : 'text-text-secondary hover:text-text-primary'
                    } ${(resumeActive || actionDisabled) ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className={infoCardClassName}>
                <p className="text-[11px] font-bold tracking-[0.2em] text-text-secondary">已完成</p>
                <p className="text-right text-xl font-black text-text-primary">
                  {summary.progress} / {definition.words.length}
                </p>
              </div>
              <div className={infoCardClassName}>
                <p className="text-[11px] font-bold tracking-[0.2em] text-text-secondary">下一批</p>
                <p className="text-right text-xl font-black text-text-primary">
                  {summary.nextBatchSize} 词
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleStartOfficial();
                }}
                disabled={actionDisabled}
                className="inline-flex h-[76px] w-full items-center justify-center gap-2 rounded-[22px] bg-apple-blue px-5 text-base font-black text-white shadow-[0_18px_34px_rgba(0,122,255,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                {ctaLabel}
                {!actionDisabled && <ArrowRight className="h-5 w-5" />}
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
