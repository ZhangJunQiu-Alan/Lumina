import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { invalidateLibraryCache } from '../../lib/libraryCache';
import { saveToSupabase } from '../../lib/importFlow';
import {
  deriveOfficialProgress,
  formatOfficialGroupName,
  getOfficialBatchWords,
  OFFICIAL_BATCH_SIZE,
  OFFICIAL_LIBRARY_TITLE,
  OFFICIAL_TOTAL_WORDS,
  parseOfficialGroupRange,
  writeOfficialProgress,
} from '../../lib/officialLibrary';
import { useAuth } from '../../contexts/AuthContext';
import { IELTS_CHAPTERS } from '../../data/ielts-vocab';
import type { EnrichedWord, LibraryGroupSummary, Word } from '../../types';

type Stage = 'idle' | 'loading' | 'preview' | 'saving' | 'audio' | 'error';

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
  const [enriched, setEnriched] = useState<EnrichedWord[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [pendingProgressUpdate, setPendingProgressUpdate] = useState<number | null>(null);
  const [pendingGroupName, setPendingGroupName] = useState<string | null>(null);

  const officialProgress = useMemo(() => deriveOfficialProgress(groups), [groups]);
  const officialCompleted = officialProgress >= OFFICIAL_TOTAL_WORDS;
  const nextOfficialBatchSize = Math.min(OFFICIAL_BATCH_SIZE, OFFICIAL_TOTAL_WORDS - officialProgress);
  const savedBatchCount = useMemo(
    () => groups.filter((group) => parseOfficialGroupRange(group.title)).length,
    [groups],
  );

  const startEnrichment = async (
    words: string[],
    options: { nextProgress: number; groupName: string } | null,
  ) => {
    if (words.length === 0) return;

    setPendingProgressUpdate(options?.nextProgress ?? null);
    setPendingGroupName(options?.groupName ?? null);
    setStage('loading');
    setErrorMsg('');
    setEnriched([]);

    try {
      const res = await apiFetch('/api/vocab/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const { data } = await res.json();
      setEnriched(data);
      setStage('preview');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      setStage('error');
    }
  };

  const handleStartOfficial = async () => {
    const words = getOfficialBatchWords(officialProgress);
    if (words.length === 0) return;

    await startEnrichment(words, {
      nextProgress: officialProgress + words.length,
      groupName: formatOfficialGroupName(officialProgress, words.length),
    });
  };

  const handleBackToCard = () => {
    setStage('idle');
    setErrorMsg('');
  };

  const handleStartLearning = async () => {
    if (!user) {
      setErrorMsg('先登录一下，再开始这一组。');
      setStage('error');
      return;
    }

    setStage('saving');
    try {
      const result = await saveToSupabase(enriched, user.id, {
        groupName: pendingGroupName ?? undefined,
        groupSourceType: 'system',
      });
      invalidateLibraryCache(user.id);
      try {
        await onLibraryMutated?.();
      } catch {
        // Stats refresh should never block the learning flow.
      }

      if (pendingProgressUpdate !== null) {
        writeOfficialProgress(pendingProgressUpdate);
      }

      setPendingProgressUpdate(null);
      setPendingGroupName(null);

      setStage('audio');
      let audioMap: Record<string, { uk_url: string; us_url: string }> = {};
      try {
        const res = await apiFetch('/api/audio/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: result.words.map((word) => word.word) }),
          requiresAuth: false,
        });

        if (res.ok) {
          const { data } = await res.json();
          audioMap = data ?? {};
        }
      } catch {
        // Audio generation should not block the learning flow.
      }

      const wordsWithAudio = result.words.map((word) => ({
        ...word,
        audio_uk_url: audioMap[word.word.toLowerCase()]?.uk_url ?? null,
        audio_us_url: audioMap[word.word.toLowerCase()]?.us_url ?? null,
      }));

      await onStartLearning(result.groupId, wordsWithAudio);
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
          <div className="pointer-events-none absolute left-0 bottom-0 h-36 w-36 rounded-full bg-apple-teal/10 blur-3xl" />
          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-apple-blue shadow-[0_14px_34px_rgba(0,0,0,0.06)]">
              <BookOpen className="h-7 w-7" />
            </div>
            <h3 className="mt-5 text-3xl font-black leading-tight text-text-primary">
              {OFFICIAL_LIBRARY_TITLE}
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-text-secondary">
              {IELTS_CHAPTERS.length} 章 · {OFFICIAL_TOTAL_WORDS} 词 · 按顺序推进。每次整理接下来的 30
              词，走完现有预览、保存和学习流程。
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

      {stage === 'loading' && (
        <motion.div
          key="official-loading"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="glass rounded-[34px] p-16 jelly-shadow"
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
            <div>
              <p className="text-xl font-black text-text-primary">这批官方词汇正在整理中…</p>
              <p className="mt-1 text-sm text-text-secondary">音标、释义、例句这些马上就好</p>
            </div>
          </div>
        </motion.div>
      )}

      {stage === 'preview' && (
        <motion.div
          key="official-preview"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between gap-4 px-1">
            <h3 className="text-2xl font-black text-text-primary">这一批官方词汇已经准备好了</h3>
            <button
              type="button"
              onClick={handleBackToCard}
              className="text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              ← 返回系统词库
            </button>
          </div>

          <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
            {enriched.map((entry, index) => (
              <motion.div
                key={`${entry.word}-${index}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.04 }}
                className="glass flex items-start justify-between gap-4 rounded-2xl px-6 py-4 jelly-shadow"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="text-lg font-black">{entry.word}</span>
                    <span className="text-xs font-mono text-apple-blue">{entry.ipa_uk}</span>
                    {entry.senses[0] && (
                      <span className="rounded-full bg-apple-gray px-2 py-0.5 text-xs font-bold uppercase text-text-secondary">
                        {entry.senses[0].pos}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-text-secondary">{entry.primary_meaning_zh}</p>
                </div>
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-apple-green" />
              </motion.div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              void handleStartLearning();
            }}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-apple-blue py-5 text-lg font-black text-white transition-all hover:scale-[1.01] active:scale-[0.99] jelly-shadow"
          >
            <BookOpen className="h-5 w-5" />
            就从这一批开始
            <ArrowRight className="h-5 w-5" />
          </button>
        </motion.div>
      )}

      {stage === 'saving' && (
        <motion.div
          key="official-saving"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-[34px] p-16 jelly-shadow"
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-apple-green" />
            <p className="text-xl font-black text-text-primary">正在放进系统词库…</p>
          </div>
        </motion.div>
      )}

      {stage === 'audio' && (
        <motion.div
          key="official-audio"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-[34px] p-16 jelly-shadow"
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
            <div>
              <p className="text-xl font-black text-text-primary">正在补发音…</p>
              <p className="mt-1 text-sm text-text-secondary">英音和美音会慢一点，没补齐也不耽误你先学</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
