import { useMemo, useState } from 'react';
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
  deriveOfficialProgress,
  getOfficialBatchPlan,
  OFFICIAL_LIBRARY_TITLE,
  OFFICIAL_TOTAL_WORDS,
  parseOfficialGroupRange,
  writeOfficialProgress,
} from '../../lib/officialLibrary';
import { useAuth } from '../../contexts/AuthContext';
import { IELTS_CHAPTERS } from '../../data/ielts-vocab';
import type { EnrichedWord, LibraryGroupSummary, Word } from '../../types';
import { normalizeWordKey } from '../../../shared/wordBatch';

type Stage = 'idle' | 'preparing' | 'error';

interface OfficialLibraryPanelProps {
  groups: LibraryGroupSummary[];
  onStartLearning: (groupId: string, words?: Word[]) => Promise<void> | void;
  onLibraryMutated?: () => void | Promise<void>;
}

const infoCardClassName =
  'flex min-h-[124px] flex-col justify-between rounded-[24px] bg-white/82 px-5 py-4 shadow-[0_12px_28px_rgba(0,0,0,0.05)]';

export function OfficialLibraryPanel({
  groups,
  onStartLearning,
  onLibraryMutated,
}: OfficialLibraryPanelProps) {
  const { user } = useAuth();
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const officialProgress = useMemo(() => deriveOfficialProgress(groups), [groups]);
  const nextBatchPlan = useMemo(() => getOfficialBatchPlan(officialProgress), [officialProgress]);
  const officialCompleted = !nextBatchPlan;
  const nextOfficialBatchSize = nextBatchPlan?.words.length ?? 0;
  const savedBatchCount = useMemo(
    () => groups.filter((group) => parseOfficialGroupRange(group.title)).length,
    [groups],
  );

  const handleStartOfficial = async () => {
    if (!user) {
      setErrorMsg('先登录一下，再开始这一组。');
      setStage('error');
      return;
    }

    if (!nextBatchPlan) return;

    setStage('preparing');
    setErrorMsg('');

    try {
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
      writeOfficialProgress(nextBatchPlan.nextProgress);

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
          className="relative w-full overflow-hidden rounded-[34px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(240,246,255,0.72))] p-7 jelly-shadow"
        >
          <div className="pointer-events-none absolute -right-12 top-0 h-44 w-44 rounded-full bg-apple-blue/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 rounded-full bg-apple-teal/10 blur-3xl" />
          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-apple-blue shadow-[0_14px_34px_rgba(0,0,0,0.06)]">
              <BookOpen className="h-7 w-7" />
            </div>
            <h3 className="mt-5 text-3xl font-black leading-tight text-text-primary">
              {OFFICIAL_LIBRARY_TITLE}
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-text-secondary">
              {IELTS_CHAPTERS.length} 章 · {OFFICIAL_TOTAL_WORDS} 词 · 按顺序推进。每次直接取接下来的 30
              词，优先复用已经整理好的词条，缺的再补齐后直接开始。
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3 xl:max-w-[56%]">
              <div className={infoCardClassName}>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">
                  已学进度
                </p>
                <p className="mt-2 text-2xl font-black text-text-primary">
                  {officialProgress} / {OFFICIAL_TOTAL_WORDS}
                </p>
              </div>
              <div className={infoCardClassName}>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">
                  下一批
                </p>
                <p className="mt-2 text-2xl font-black text-text-primary">
                  {officialCompleted ? 0 : nextOfficialBatchSize} 词
                </p>
              </div>
              <div className={infoCardClassName}>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">
                  已保存批次
                </p>
                <p className="mt-2 text-2xl font-black text-text-primary">{savedBatchCount}</p>
              </div>
              <div className={infoCardClassName}>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">
                    现在这边
                  </p>
                  <p className="mt-2 text-lg font-black text-text-primary">
                    {officialCompleted ? '整本词库已经学完' : `开始下一批 ${nextOfficialBatchSize} 词`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleStartOfficial();
                  }}
                  disabled={officialCompleted}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[20px] bg-apple-blue px-5 py-4 text-base font-black text-white shadow-[0_18px_34px_rgba(0,122,255,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                >
                  {officialCompleted ? '已学完' : '开始下一批'}
                  {!officialCompleted && <ArrowRight className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {stage === 'error' && (
              <div className="mt-5 max-w-3xl rounded-2xl bg-apple-red/10 p-3 text-sm font-medium text-apple-red">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {stage === 'preparing' && (
        <motion.div
          key="official-preparing"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="glass rounded-[34px] p-16 jelly-shadow"
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
            <div>
              <p className="text-xl font-black text-text-primary">这批官方词汇正在准备中…</p>
              <p className="mt-1 text-sm text-text-secondary">先查数据库，缺的再补齐，准备好就直接开始</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
