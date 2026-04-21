import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, Loader2, PlusCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { invalidateLibraryCache } from '../../lib/libraryCache';
import { fetchVocabularyEntriesByWords, saveToSupabase } from '../../lib/importFlow';
import { useAuth } from '../../contexts/AuthContext';
import { EnrichedWord, Word } from '../../types';
import { analyzeWordBatch, formatDuplicateWordsMessage, normalizeWordKey } from '../../../shared/wordBatch';

interface ImportViewProps {
  onStartLearning: (groupId: string, words?: Word[]) => Promise<void> | void;
}

type Stage = 'input' | 'loading' | 'preview' | 'saving' | 'audio' | 'error';

const MANUAL_BATCH_SIZE = 30;
const MANUAL_DRAFT_KEY = 'manual_vocab_import_draft';

function splitWords(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function readManualDraft() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(MANUAL_DRAFT_KEY) ?? '';
}

function writeManualDraft(value: string) {
  if (typeof window === 'undefined') return;

  if (value.trim()) {
    window.localStorage.setItem(MANUAL_DRAFT_KEY, value);
    return;
  }

  window.localStorage.removeItem(MANUAL_DRAFT_KEY);
}

function formatRelationPreview(items: EnrichedWord['derived_words']) {
  if (items.length === 0) return '暂无';
  return items.slice(0, 2).map((item) => item.word).join('、');
}

function formatSynonymAntonymPreview(entry: EnrichedWord) {
  const synonyms = entry.synonyms.slice(0, 2).map((item) => item.word);
  const antonyms = entry.antonyms.slice(0, 2).map((item) => item.word);
  const parts = [
    synonyms.length > 0 ? `近义：${synonyms.join('、')}` : '',
    antonyms.length > 0 ? `反义：${antonyms.join('、')}` : '',
  ].filter(Boolean);

  return parts.join(' / ') || '暂无';
}

function formatConfusionPreview(entry: EnrichedWord) {
  if (entry.confusions.length === 0) return '暂无';
  return entry.confusions.slice(0, 2).map((item) => item.word).join('、');
}

export const ImportView = ({ onStartLearning }: ImportViewProps) => {
  const { user } = useAuth();
  const [raw, setRaw] = useState(readManualDraft);
  const [stage, setStage] = useState<Stage>('input');
  const [enriched, setEnriched] = useState<EnrichedWord[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    writeManualDraft(raw);
  }, [raw]);

  const parsedWords = splitWords(raw);
  const wordCount = parsedWords.length;

  const startEnrichment = async (words: string[]) => {
    if (words.length === 0) return;

    setStage('loading');
    setErrorMsg('');
    setEnriched([]);

    try {
      // 1. 先从本地词库查找已经整理好的词条
      const { existing, missing } = await fetchVocabularyEntriesByWords(words);
      let newlyEnriched: EnrichedWord[] = [];

      // 2. 只有缺失或者数据不完整的词才发给 AI 整理
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

        const { data } = await res.json();
        newlyEnriched = data;
      }

      // 3. 合并两部分结果，并尽量保持用户的输入顺序
      const wordMap = new Map<string, EnrichedWord>();
      for (const item of existing) {
        wordMap.set(normalizeWordKey(item.word), item);
      }
      for (const item of newlyEnriched) {
        wordMap.set(normalizeWordKey(item.word), item);
      }

      const combined: EnrichedWord[] = [];
      for (const word of words) {
        const item = wordMap.get(normalizeWordKey(word));
        if (item) {
          combined.push(item);
        }
      }

      setEnriched(combined);
      setStage('preview');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      setStage('error');
    }
  };

  const handleGenerate = async () => {
    const batch = analyzeWordBatch(parsedWords, { limit: MANUAL_BATCH_SIZE });

    if (batch.words.length === 0) return;

    if (batch.duplicateWords.length > 0) {
      setErrorMsg(formatDuplicateWordsMessage(batch.duplicateWords));
      setStage('error');
      return;
    }

    await startEnrichment(batch.words);
  };

  const handleBackToInput = () => {
    setStage('input');
    setErrorMsg('');
  };

  const handleStartLearning = async () => {
    if (!user) {
      setErrorMsg('先登录，再把这组词接进系统。');
      setStage('error');
      return;
    }

    setStage('saving');
    try {
      const result = await saveToSupabase(enriched, user.id, { groupSourceType: 'custom' });
      invalidateLibraryCache(user.id);
      writeManualDraft('');
      setRaw('');

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
        // Audio failure must never block learning.
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-2xl"
    >
      <AnimatePresence mode="wait">
        {(stage === 'input' || stage === 'error') && (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass rounded-apple-lg p-12 text-center jelly-shadow"
          >
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-gray-300">
              <PlusCircle className="h-7 w-7 text-gray-400" />
            </div>
            <h2 className="mb-2 text-2xl font-black">把一组外部词汇接进系统</h2>
            <p className="mb-6 text-sm text-text-secondary">
              逗号或换行都可以。先整理成可学状态，再决定要不要开始这一组。
            </p>

            <textarea
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value);
                setStage('input');
              }}
              className="mb-2 h-40 w-full resize-none rounded-2xl bg-apple-gray p-5 text-sm outline-none ring-apple-blue/30 focus:ring-2"
              placeholder="allocate, biodiversity, infrastructure, sustainable…"
            />

            <div className="mb-6 flex items-center justify-between px-1">
              <span className="text-xs text-text-secondary">当前识别到 {wordCount} 个词</span>
              {wordCount > MANUAL_BATCH_SIZE && (
                <span className="text-xs font-bold text-apple-red">这次会先接前 30 个</span>
              )}
            </div>

            {stage === 'error' && (
              <div className="mb-4 flex items-start gap-2 rounded-xl bg-apple-red/10 p-3 text-left text-sm font-medium text-apple-red">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                void handleGenerate();
              }}
              disabled={wordCount === 0}
              className="w-full rounded-2xl bg-apple-blue py-4 font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              先整理成可学状态
            </button>
          </motion.div>
        )}

        {stage === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass flex flex-col items-center gap-6 rounded-apple-lg p-16 jelly-shadow"
          >
            <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
            <div className="text-center">
              <p className="text-xl font-black">正在把这组词整理成可学状态…</p>
              <p className="mt-1 text-sm text-text-secondary">释义、例句、构词和关系会一起补齐。</p>
            </div>
          </motion.div>
        )}

        {stage === 'preview' && (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-2xl font-black">这组词已经可以进入系统了</h2>
              <button
                type="button"
                onClick={handleBackToInput}
                className="text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                ← 回去改一下
              </button>
            </div>

            <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
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
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">构词拆解</p>
                        <p className="mt-1 text-xs leading-5 text-text-primary">
                          {entry.morphology.summary_zh || '暂无'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">派生词</p>
                        <p className="mt-1 text-xs leading-5 text-text-primary">
                          {formatRelationPreview(entry.derived_words)}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">近义 / 反义</p>
                        <p className="mt-1 text-xs leading-5 text-text-primary">
                          {formatSynonymAntonymPreview(entry)}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">易混提示</p>
                        <p className="mt-1 text-xs leading-5 text-text-primary">
                          {formatConfusionPreview(entry)}
                        </p>
                      </div>
                    </div>
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
              把这组词接进去
              <ArrowRight className="h-5 w-5" />
            </button>
          </motion.div>
        )}

        {stage === 'saving' && (
          <motion.div
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass flex flex-col items-center gap-6 rounded-apple-lg p-16 jelly-shadow"
          >
            <Loader2 className="h-10 w-10 animate-spin text-apple-green" />
            <p className="text-xl font-black">正在把这组词接进你的记忆地图…</p>
          </motion.div>
        )}

        {stage === 'audio' && (
          <motion.div
            key="audio"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass flex flex-col items-center gap-6 rounded-apple-lg p-16 jelly-shadow"
          >
            <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
            <div className="text-center">
              <p className="text-xl font-black">正在补齐发音…</p>
              <p className="mt-1 text-sm text-text-secondary">英音和美音会慢一点，但不影响你先开始这一组。</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
