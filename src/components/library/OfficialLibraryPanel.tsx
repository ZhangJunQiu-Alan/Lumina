import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowRight, BookOpen, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import {
  createLearningGroupFromVocabularyEntries,
  fetchVocabularyEntriesByWords,
  persistEnrichedVocabularyEntries,
  type PersistedVocabularyEntry,
} from '../../lib/importFlow';
import { invalidateLibraryCache } from '../../lib/libraryCache';
import {
  getOfficialBatchPlan,
  OFFICIAL_LIBRARY_TITLE,
  OFFICIAL_TOTAL_WORDS,
  resolveOfficialLibraryStartMode,
} from '../../lib/officialLibrary';
import { useAuth } from '../../contexts/AuthContext';
import { IELTS_CHAPTERS } from '../../data/ielts-vocab';
import type { EnrichedWord, OfficialLibrarySummary, Word } from '../../types';
import { normalizeWordKey } from '../../../shared/wordBatch';
import { LEARNING_ROUND_LABELS } from '../../lib/learningSession';

type Stage = 'idle' | 'preparing' | 'resuming' | 'error';

interface OfficialLibraryPanelProps {
  summary: OfficialLibrarySummary;
  onStartLearning: (groupId: string, words?: Word[]) => Promise<void> | void;
  onOpenDetail?: () => void | Promise<void>;
  onLibraryMutated?: () => void | Promise<void>;
  showOpenDetailAction?: boolean;
}

const infoCardClassName =
  'flex h-[76px] min-w-0 items-center justify-between rounded-[22px] bg-white/84 px-4 shadow-[0_12px_28px_rgba(0,0,0,0.05)]';

export function OfficialLibraryPanel({
  summary,
  onStartLearning,
  onOpenDetail,
  onLibraryMutated,
  showOpenDetailAction = true,
}: OfficialLibraryPanelProps) {
  const { user } = useAuth();
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const nextBatchPlan = getOfficialBatchPlan(summary.progress);
  const startMode = resolveOfficialLibraryStartMode(summary);
  const actionDisabled = startMode === 'completed';
  const resumeCopy = summary.resumeCandidate
    ? summary.resumeCandidate.round === 'article'
      ? '文章巩固'
      : `${LEARNING_ROUND_LABELS[summary.resumeCandidate.round]} · 第 ${summary.resumeCandidate.currentIndex + 1} 个词`
    : null;

  const handleStartOfficial = async () => {
    if (!user) {
      setErrorMsg('先登录一下，再继续官方词库。');
      setStage('error');
      return;
    }

    setErrorMsg('');

    try {
      if (startMode === 'resume' && summary.resumeCandidate) {
        setStage('resuming');
        await onStartLearning(summary.resumeCandidate.groupId);
        return;
      }

      if (startMode === 'completed' || !nextBatchPlan) return;

      setStage('preparing');
      const { existing, missing } = await fetchVocabularyEntriesByWords(nextBatchPlan.words);
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

        persistedEntries = nextBatchPlan.words.map((word) => {
          const normalizedWord = normalizeWordKey(word);
          return existingByWord.get(normalizedWord) ?? missingByWord.get(normalizedWord);
        }).filter((entry): entry is PersistedVocabularyEntry => Boolean(entry));

        if (persistedEntries.length !== nextBatchPlan.words.length) {
          throw new Error('这批官方词汇补齐后没有全部写回数据库，请再试一次。');
        }
      }

      const result = await createLearningGroupFromVocabularyEntries(user.id, persistedEntries, {
        groupName: nextBatchPlan.groupName,
        groupSourceType: 'system',
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

  return (
    <AnimatePresence mode="wait">
      {(stage === 'idle' || stage === 'error') && (
        <motion.div
          key="official-idle"
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
                    {OFFICIAL_LIBRARY_TITLE}
                  </h3>
                </div>
                {showOpenDetailAction && onOpenDetail && (
                  <button
                    type="button"
                    onClick={() => { void onOpenDetail(); }}
                    className="inline-flex items-center gap-2 rounded-full bg-white/82 px-4 py-2 text-sm font-bold text-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.05)] transition-colors hover:text-text-primary"
                  >
                    查看词库
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-text-secondary">
                {IELTS_CHAPTERS.length} 章 · {OFFICIAL_TOTAL_WORDS} 词 · 按顺序推进。每次直接取接下来的 30
                词，优先复用已经整理好的词条，缺的再补齐后直接开始。
              </p>
              {resumeCopy && (
                <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full bg-white/84 px-4 py-2 text-sm font-bold text-text-primary shadow-[0_10px_24px_rgba(0,0,0,0.05)]">
                  <span className="text-text-secondary">继续位置</span>
                  <span>{resumeCopy}</span>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={infoCardClassName}>
                <p className="text-[11px] font-bold tracking-[0.2em] text-text-secondary">已学进度</p>
                <p className="text-right text-xl font-black text-text-primary">
                  {summary.progress} / {OFFICIAL_TOTAL_WORDS}
                </p>
              </div>
              <div className={infoCardClassName}>
                <p className="text-[11px] font-bold tracking-[0.2em] text-text-secondary">下一批</p>
                <p className="text-right text-xl font-black text-text-primary">
                  {summary.nextBatchSize} 词
                </p>
              </div>
              <div className={infoCardClassName}>
                <p className="text-[11px] font-bold tracking-[0.2em] text-text-secondary">已纳入词库</p>
                <p className="text-right text-xl font-black text-text-primary">{summary.unlockedWordCount} 词</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleStartOfficial();
                }}
                disabled={actionDisabled}
                className="inline-flex h-[76px] w-full items-center justify-center gap-2 rounded-[22px] bg-apple-blue px-5 text-base font-black text-white shadow-[0_18px_34px_rgba(0,122,255,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                {actionDisabled ? '已学完' : '继续学习'}
                {!actionDisabled && <ArrowRight className="h-5 w-5" />}
              </button>
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

      {(stage === 'preparing' || stage === 'resuming') && (
        <motion.div
          key={`official-${stage}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="glass rounded-[34px] p-16 jelly-shadow"
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
            <div>
              <p className="text-xl font-black text-text-primary">
                {stage === 'resuming' ? '正在恢复上次进度…' : '这批官方词汇正在准备中…'}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                {stage === 'resuming'
                  ? '会直接回到上次那一轮、那个词位。'
                  : '先查数据库，缺的再补齐，准备好就直接开始。'}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
